"""Generate a small, owned WebP cache without changing published originals."""

from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
import stat
from urllib.parse import unquote, urlsplit

try:
    from PIL import Image, ImageOps, features
except ImportError:  # Keep the installation error clear when invoking the builder.
    Image = ImageOps = features = None

try:
    from PIL import ImageCms
except ImportError:
    ImageCms = None


ASSET_FOLDERS = ("images", "附属资料")
MIN_SOURCE_BYTES = 5 * 1024 * 1024
WIDTHS = (960, 1920)
POLICY = {"version": 2, "widths": list(WIDTHS), "quality": 90, "method": 6,
          "resample": "LANCZOS", "exif_transpose": True, "color": "ICC-to-sRGB",
          "metadata": "removed"}
MARKER = ".generated-by-responsive-images"
MARKER_TEXT = "ResponsiveImages generated assets, ownership version 1.\n"
MANIFEST = "manifest.json"
GENERATED_NAME = re.compile(r"[0-9a-f]{64}-([1-9][0-9]{0,3})\.webp\Z")


def _is_link(path: Path) -> bool:
    try:
        attributes = path.lstat()
    except (FileNotFoundError, NotADirectoryError):
        return False
    # Python 3.11 lacks Path.is_junction(). Windows junctions, symlinks and
    # other reparse points all carry this flag; stat follows no link here.
    return (stat.S_ISLNK(attributes.st_mode)
            or bool(getattr(attributes, "st_file_attributes", 0)
                    & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)))


def _srgb_pixels(image):
    """Respect a tagged image's color space before removing private metadata."""
    # LAB's "A" band is a color coordinate, not an alpha channel.
    has_alpha = image.mode in {"RGBA", "RGBa", "LA", "La", "PA"} or "transparency" in image.info
    profile = image.info.get("icc_profile")
    if profile:
        if ImageCms is None or not features.check("littlecms2"):
            raise RuntimeError("ICC-tagged images require Pillow with littlecms2/ImageCms support; refusing to discard their color profile.")
        alpha = image.convert("RGBA").getchannel("A") if has_alpha else None
        colors = image
        if colors.mode not in {"RGB", "CMYK", "LAB", "L"}:
            colors = colors.convert("RGB")
        try:
            source_profile = ImageCms.ImageCmsProfile(BytesIO(profile))
            converted = ImageCms.profileToProfile(colors, source_profile,
                                                 ImageCms.createProfile("sRGB"), outputMode="RGB")
        except (ImageCms.PyCMSError, OSError, TypeError, ValueError) as error:
            raise ValueError(f"Cannot transform this ICC profile to sRGB: {error}") from error
        if alpha is not None:
            converted.putalpha(alpha)
    else:
        converted = image.convert("RGBA" if has_alpha else "RGB")
    converted.info.clear()
    return converted


def _digest(path: Path) -> str:
    value = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


class ResponsiveImages:
    """Prepare derivatives for large local JPG/PNG assets under the blog prefix.

    Originals remain at their old URLs. Only files registered in this cache's
    manifest can be replaced or removed. Unknown files and links are protected.
    """

    def __init__(self, root: Path, output: Path, base_path: str):
        self.root = Path(root).absolute()
        self.output = Path(output).absolute()
        parsed = urlsplit(base_path)
        decoded = unquote(parsed.path)
        if (parsed.scheme or parsed.netloc or parsed.query or parsed.fragment
                or not base_path.startswith("/") or "\\" in decoded
                or "//" in decoded or any(part in {".", ".."} for part in decoded.split("/"))):
            raise ValueError("Responsive image base_path must be a local absolute URL prefix.")
        self.base_path = base_path.rstrip("/") + "/"
        self.directory = self.output / "assets" / "responsive-images"
        self.mapping: dict[str, dict] = {}
        self.stats: dict = {}

    def _safe_output(self, path: Path):
        """Check real containment and every output component before a mutation."""
        output_real = self.output.resolve()
        root_real = self.root.resolve()
        if output_real == root_real or output_real in root_real.parents:
            raise ValueError("Responsive image output must not replace the source directory.")
        if output_real == Path(output_real.anchor):
            raise ValueError("Responsive image output cannot be a filesystem root.")
        try:
            path.resolve().relative_to(output_real)
        except ValueError as error:
            raise ValueError("Responsive image output path escapes its output directory.") from error
        current = path
        while True:
            if _is_link(current):
                raise ValueError(f"Responsive image output cannot contain a link/junction: {current}")
            if current == self.output:
                break
            if current.parent == current:
                raise ValueError("Responsive image output path is not within its output directory.")
            current = current.parent

    def _safe_source(self, source: Path):
        if _is_link(self.root):
            raise ValueError(f"Responsive image source root cannot be a link/junction: {self.root}")
        try:
            source.resolve().relative_to(self.root.resolve())
        except ValueError as error:
            raise ValueError(f"Responsive image source escapes the source directory: {source}") from error
        current = source
        while current != self.root:
            if _is_link(current):
                raise ValueError(f"Responsive image sources cannot be links/junctions: {current}")
            if current.parent == current:
                raise ValueError("Responsive image source is not within its source directory.")
            current = current.parent

    @staticmethod
    def _valid_name(name: str) -> bool:
        match = GENERATED_NAME.fullmatch(name) if isinstance(name, str) else None
        return match is not None and int(match[1]) <= max(WIDTHS)

    def _read_owned_cache(self) -> dict:
        self._safe_output(self.directory)
        if not self.directory.exists():
            self.directory.mkdir(parents=True)
            (self.directory / MARKER).write_text(MARKER_TEXT, encoding="utf-8")
        if not self.directory.is_dir():
            raise ValueError("Responsive image cache must be a directory.")
        marker = self.directory / MARKER
        self._safe_output(marker)
        if not marker.is_file() or marker.read_text(encoding="utf-8") != MARKER_TEXT:
            raise ValueError("Refusing an unowned responsive image output directory.")
        manifest_path = self.directory / MANIFEST
        self._safe_output(manifest_path)
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as error:
                raise ValueError("Responsive image manifest is unreadable; preserve it for inspection.") from error
            if (not isinstance(manifest, dict) or manifest.get("schema") != 1
                    or manifest.get("generator") != "ResponsiveImages"
                    or not isinstance(manifest.get("items"), dict)
                    or not isinstance(manifest.get("owned_files"), list)
                    or not all(self._valid_name(name) for name in manifest["owned_files"])
                    or len(set(manifest["owned_files"])) != len(manifest["owned_files"])):
                raise ValueError("Responsive image manifest has invalid ownership records.")
        else:
            manifest = {"schema": 1, "generator": "ResponsiveImages", "policy": POLICY,
                        "owned_files": [], "items": {}}
        allowed = {MARKER, MANIFEST, *manifest["owned_files"]}
        for path in self.directory.iterdir():
            self._safe_output(path)
            if path.name not in allowed or not path.is_file():
                raise ValueError(f"Protecting an unknown file in responsive image cache: {path.name}")
        return manifest

    def _write_manifest(self, manifest: dict):
        path = self.directory / MANIFEST
        self._safe_output(path)
        # Reserve filenames before writing them so an interrupted build can retry.
        # The manifest contains only generated names, never arbitrary deletion paths.
        path.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2)
                        + "\n", encoding="utf-8")

    def _cached(self, record: dict, name: str, size: tuple[int, int]) -> bool:
        if not isinstance(record, dict) or record.get("file") != name:
            return False
        path = self.directory / name
        self._safe_output(path)
        if (not path.is_file() or path.stat().st_size != record.get("bytes")
                or _digest(path) != record.get("sha256")):
            return False
        try:
            with Image.open(path) as cached:
                if cached.format != "WEBP" or cached.size != size:
                    return False
                cached.verify()
        except (OSError, ValueError):
            return False
        return True

    def prepare(self) -> dict:
        if Image is None:
            raise RuntimeError("Responsive images require Pillow. Run: python -m pip install -r blog/requirements.txt")
        if not features.check("webp"):
            raise RuntimeError("Pillow needs WebP encoder support for responsive images.")
        old = self._read_owned_cache()
        old_owned = set(old["owned_files"])
        working = {"schema": 1, "generator": "ResponsiveImages", "policy": POLICY,
                   "owned_files": sorted(old_owned), "items": {}}
        desired: set[str] = set()
        files: dict[str, int] = {}
        reused: set[str] = set()
        self.mapping = {}
        rows = []
        totals = {str(width): 0 for width in WIDTHS}
        source_bytes = 0
        largest_bytes = 0
        policy_bytes = json.dumps(POLICY, sort_keys=True, separators=(",", ":")).encode()
        for folder in ASSET_FOLDERS:
            directory = self.root / folder
            if not directory.exists():
                continue
            self._safe_source(directory)
            for source in sorted(directory.rglob("*")):
                relative = source.relative_to(self.root)
                if any(part.startswith(".") for part in relative.parts):
                    continue
                self._safe_source(source)
                if (not source.is_file() or source.suffix.lower() not in {".jpg", ".jpeg", ".png"}
                        or source.stat().st_size <= MIN_SOURCE_BYTES):
                    continue
                relative_name = relative.as_posix()
                try:
                    with Image.open(source) as original:
                        if original.format not in {"JPEG", "PNG"} or getattr(original, "is_animated", False):
                            continue
                        original_size = original.size
                        if original.getexif().get(274) in {5, 6, 7, 8}:
                            original_size = original_size[::-1]
                        corrected = None
                        source_hash = _digest(source)
                        key = sha256(source_hash.encode("ascii") + policy_bytes).hexdigest()
                        prior = old["items"].get(relative_name, {})
                        prior_variants = (prior.get("variants", {}) if isinstance(prior, dict)
                                          and prior.get("source_sha256") == source_hash
                                          and old.get("policy") == POLICY else {})
                        if not isinstance(prior_variants, dict):
                            prior_variants = {}
                        variants = []
                        records = {}
                        for target in WIDTHS:
                            width = min(target, original_size[0])
                            height = max(1, round(original_size[1] * width / original_size[0]))
                            size = (width, height)
                            name = f"{key}-{width}.webp"
                            path = self.directory / name
                            self._safe_output(path)
                            cached = False
                            if name in files:
                                record = records.get(str(width))
                                if record is None:
                                    record = {"file": name, "bytes": path.stat().st_size,
                                              "sha256": _digest(path), "width": width, "height": height}
                                cached = name in reused
                            else:
                                cached = self._cached(prior_variants.get(str(width)), name, size)
                                if cached:
                                    record = prior_variants[str(width)]
                                    reused.add(name)
                                else:
                                    if corrected is None:
                                        corrected = ImageOps.exif_transpose(original)
                                        corrected.load()
                                        # Tagged CMYK/RGB needs an ICC transform
                                        # before EXIF, ICC and XMP are removed.
                                        corrected = _srgb_pixels(corrected)
                                    if name not in working["owned_files"]:
                                        working["owned_files"].append(name)
                                        working["owned_files"].sort()
                                        self._write_manifest(working)
                                    resized = corrected if corrected.size == size else corrected.resize(size, Image.Resampling.LANCZOS)
                                    encoded = BytesIO()
                                    resized.save(encoded, format="WEBP", quality=POLICY["quality"], method=POLICY["method"])
                                    data = encoded.getvalue()
                                    self._safe_output(path)
                                    path.write_bytes(data)
                                    record = {"file": name, "bytes": len(data), "sha256": sha256(data).hexdigest(),
                                              "width": width, "height": height}
                                files[name] = record["bytes"]
                            records[str(width)] = record
                            desired.add(name)
                            url = self.base_path + "assets/responsive-images/" + name
                            variants.append({"target_width": target, "width": width, "height": height,
                                             "bytes": record["bytes"], "url": url, "cache_reused": cached})
                            totals[str(target)] += record["bytes"]
                except (OSError, ValueError) as error:
                    raise ValueError(f"Cannot generate responsive image for {relative_name}: {error}") from error
                count_bytes = source.stat().st_size
                source_bytes += count_bytes
                largest_bytes += variants[-1]["bytes"]
                self.mapping[relative_name] = {
                    "src": variants[0]["url"],
                    "srcset": ", ".join(f'{item["url"]} {item["width"]}w'
                                        for index, item in enumerate(variants)
                                        if index == 0 or item["width"] != variants[index - 1]["width"]),
                    "sizes": "(max-width: 760px) calc(100vw - 40px), 760px",
                    "width": str(variants[0]["width"]), "height": str(variants[0]["height"]),
                }
                working["items"][relative_name] = {"source_sha256": source_hash, "source_bytes": count_bytes,
                                                       "original_width": original_size[0], "original_height": original_size[1],
                                                       "variants": records}
                self._write_manifest(working)
                rows.append({"source": relative_name, "source_bytes": count_bytes,
                             "original_width": original_size[0], "original_height": original_size[1], "variants": variants})
        # Never remove a directory, source, or unregistered cache entry.
        for name in sorted(old_owned - desired):
            path = self.directory / name
            self._safe_output(path)
            if path.exists():
                if not path.is_file():
                    raise ValueError(f"Protecting a non-file responsive cache entry: {name}")
                path.unlink()
        working["owned_files"] = sorted(desired)
        self._write_manifest(working)
        self.stats = {"policy": dict(POLICY), "source_count": len(rows), "source_bytes": source_bytes,
                      "variant_bytes_by_width": totals, "largest_variant_bytes": largest_bytes,
                      "derivative_bytes": sum(files.values()), "derivative_files": len(files),
                      "cache_reused_files": len(reused), "items": rows}
        return self.report()

    def attributes(self, url: str) -> dict[str, str]:
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or not parsed.path.startswith(self.base_path):
            return {}
        relative = unquote(parsed.path[len(self.base_path):])
        if ("\\" in relative or any(part in {".", "..", ""} for part in relative.split("/"))
                or relative.split("/", 1)[0] not in ASSET_FOLDERS):
            return {}
        result = self.mapping.get(relative)
        if not result:
            return {}
        return dict(result)

    def report(self) -> dict:
        """Return JSON-safe measured bytes; these are not browser timings."""
        return json.loads(json.dumps(self.stats))
