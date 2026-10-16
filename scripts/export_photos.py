"""Export selected local Obsidian albums as metadata-free, public WebP assets.

This command prepares local files only. It never changes originals, commits or
publishes. Source paths and stable-ID history live only in .photo-cache/.
"""
from __future__ import annotations

import argparse
from datetime import date as calendar_date
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from urllib.parse import unquote, urlsplit

_LOCAL_DEPS = Path(__file__).resolve().parents[1] / ".blog-deps"
if _LOCAL_DEPS.is_dir():
    sys.path.insert(0, str(_LOCAL_DEPS))

from markdown_it import MarkdownIt
from markdown_it.rules_inline import image as standard_image
from PIL import Image, ImageOps, features
from image_assets import _srgb_pixels
from photo_pages import validate_catalog

WIDTHS = (640, 1920)
POLICY = {"version": 1, "long_edges": list(WIDTHS), "quality": 86, "method": 6,
          "resample": "LANCZOS", "orientation": "exif_transpose",
          "color": "ICC-to-sRGB", "metadata": "removed"}
MARKER = ".generated-by-photos"
MARKER_TEXT = "PhotoExporter owned images, version 1.\n"
CACHE_MARKER = ".private-photo-cache"
CACHE_TEXT = "PhotoExporter private source and stable-ID cache, version 1.\n"
NAME = re.compile(r"p-[a-f0-9]{24}-[a-f0-9]{16}-(?:[1-9][0-9]*)\.webp\Z")
PHOTO_ID = re.compile(r"p-[a-f0-9]{24}\Z")
ALBUM_ID = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")
PRIVATE_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\s\\]+[\\/]|/(?:Users|home|mnt)/|file://", re.I)
COMMENT = re.compile(r"^\s*<!--\s*photo:\s*(.*?)\s*-->\s*$", re.I)
PHOTO_FIELDS = ("id", "title", "caption", "date", "date_text", "time", "location",
                "width", "height", "src", "thumbnail", "thumbnail_width", "thumbnail_height")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".avif"}


def _is_link(path: Path) -> bool:
    try:
        attributes = path.lstat()
    except (FileNotFoundError, NotADirectoryError):
        return False
    return stat.S_ISLNK(attributes.st_mode) or bool(
        getattr(attributes, "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))


def _contained(path: Path, boundary: Path):
    try:
        path.resolve().relative_to(boundary.resolve())
    except ValueError as error:
        raise ValueError(f"Path escapes its permitted directory: {path}") from error
    current = path.absolute()
    boundary = boundary.absolute()
    while True:
        if _is_link(current):
            raise ValueError(f"Refusing a link/junction: {current}")
        if current == boundary:
            return
        if current.parent == current:
            raise ValueError(f"Path is outside its permitted directory: {path}")
        current = current.parent


def _digest(path: Path) -> str:
    value = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def _json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _write_changed(path: Path, data: bytes):
    if path.is_file() and path.read_bytes() == data:
        return
    # A failed/interrupted write cannot truncate the previous catalog/cache.
    descriptor, temporary = tempfile.mkstemp(prefix=".photo-write-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _scalar(value: str, label: str):
    value = value.strip()
    if not value:
        return ""
    if value[0] in "\"'":
        if len(value) < 2 or value[-1] != value[0]:
            raise ValueError(f"Unclosed quoted metadata field: {label}")
        return json.loads(value) if value[0] == '"' else value[1:-1].replace("''", "'")
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    if value.startswith(("[", "{", "|", ">", "&", "*")):
        raise ValueError(f"Use a simple scalar for metadata field: {label}")
    return re.split(r"\s+#", value, maxsplit=1)[0].strip()


def _frontmatter(text: str):
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, lines
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ValueError("Album frontmatter has no closing ---.")
    known = {"title", "description", "date", "location", "draft", "public", "publish",
             "private", "status", "tags"}
    values = {}
    key = None
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        tag = re.fullmatch(r"\s*-\s+(.+?)\s*", line)
        if tag and key == "tags":
            values.setdefault("tags", []).append(str(_scalar(tag[1], "tags")))
            continue
        match = re.fullmatch(r"([A-Za-z_][\w-]*):\s*(.*?)\s*", line)
        if not match:
            raise ValueError("Unsupported album frontmatter; use simple key: value fields.")
        key, raw = match.groups()
        if key not in known:
            continue  # Unrelated private fields never reach the public catalog.
        if key in values:
            raise ValueError(f"Duplicate metadata field: {key}")
        if key == "tags":
            if raw.startswith("[") and raw.endswith("]"):
                values[key] = [str(_scalar(item, key)) for item in raw[1:-1].split(",") if item.strip()]
            else:
                values[key] = [] if not raw else [str(_scalar(raw, key))]
        else:
            values[key] = _scalar(raw, key)
    return values, lines[end + 1:]


def _hidden(metadata: dict) -> bool:
    for field in ("draft", "private", "public", "publish"):
        if field in metadata and not isinstance(metadata[field], bool):
            raise ValueError(f"{field} must be true or false.")
    status = str(metadata.get("status", "")).strip().lower()
    tags = metadata.get("tags", [])
    return (metadata.get("draft") is True or metadata.get("private") is True
            or metadata.get("public") is False or metadata.get("publish") is False
            or status in {"draft", "private", "草稿", "不公开"}
            or any(str(tag).lstrip("#").lower() in {"draft", "private", "草稿", "不公开"} for tag in tags))


def _wiki_image(state, silent):
    start = state.pos
    if not state.src.startswith("![[", start):
        return False
    end = state.src.find("]]", start + 3)
    if end == -1:
        return False
    raw = state.src[start + 3:end]
    parts = raw.split("|", 1)
    if not parts[0].strip():
        return False
    if not silent:
        token = state.push("image", "img", 0)
        token.attrs = {"src": parts[0].strip(), "alt": ""}
        alias = parts[1].strip() if len(parts) == 2 else ""
        token.content = "" if re.fullmatch(r"\d+(?:x\d+)?", alias) else alias
        token.children = []
        token.meta = {"wiki": True, "start": start}
    state.pos = end + 2
    return True


def _markdown():
    parser = MarkdownIt("commonmark", {"html": True})
    parser.inline.ruler.before("image", "obsidian_image", _wiki_image)
    def recorded_image(state, silent):
        start = state.pos
        if not standard_image(state, silent):
            return False
        if not silent:
            state.tokens[-1].meta["start"] = start
        return True
    parser.inline.ruler.before("image", "recorded_image", recorded_image)
    return parser


def _comment_metadata(line: str) -> dict:
    match = COMMENT.fullmatch(line)
    if not match:
        return {}
    result = {}
    allowed = {"title", "caption", "date", "date_text", "time", "location", "draft",
               "private", "public", "publish", "status"}
    for field in match[1].split(";"):
        if not field.strip():
            continue
        if "=" not in field:
            raise ValueError("photo comments use key=value; key=value.")
        key, value = (piece.strip() for piece in field.split("=", 1))
        if key not in allowed or key in result:
            raise ValueError(f"Unknown or duplicate photo metadata field: {key}")
        result[key] = _scalar(value, key)
    return result


def _without_private_comments(text: str, stories: list | None = None,
                              protected_lines: set | None = None) -> str:
    """Remove internal comments, optionally collecting explicitly public stories.

    Only standalone, labelled story comments in album body are eligible. Album
    metadata calls this without a collector, so comments cannot become metadata.
    The replacement preserves line numbers for AST/reference/caption association.
    """
    def comment(match):
        value = match[0]
        if value.startswith("<!--") and re.match(r"<!--\s*photo:", value, re.I):
            if not COMMENT.fullmatch(value):
                raise ValueError("Photo metadata comments must be complete and on their own line.")
            return value
        html = value.startswith("<!--")
        closed = value.endswith("-->" if html else "%%")
        content = value[4:-3] if html and closed else value[2:-2] if closed else ""
        label = re.fullmatch(r"\s*(?:story|照片故事)\s*[:：][ \t]*(.*)", content, re.I | re.S)
        line = text.count("\n", 0, match.start())
        before = text[text.rfind("\n", 0, match.start()) + 1:match.start()]
        after = text[match.end():text.find("\n", match.end()) if "\n" in text[match.end():] else len(text)]
        if (stories is not None and label and closed and not before.strip() and not after.strip()
                and line not in (protected_lines or set())):
            story = _without_private_comments(label[1]).strip()
            stories.append((line, line + value.count("\n"), story))
        return "\n" * value.count("\n")
    return re.sub(r"<!--.*?(?:-->|\Z)|%%.*?(?:%%|\Z)", comment, text, flags=re.S)


def _validate_public(catalog: dict):
    for album in catalog["albums"]:
        for item in (album, *album["photos"]):
            for key, value in item.items():
                if isinstance(value, str):
                    if PRIVATE_PATH.search(value):
                        raise ValueError(f"Public {key} contains a local machine path; remove it before export.")


def _date(value: str) -> str:
    value = str(value).strip()
    if not value:
        return ""
    match = re.fullmatch(r"(\d{4})(?:-|年)(\d{1,2})(?:-|月)(\d{1,2})日?", value)
    if not match:
        raise ValueError(f"Use an explicit YYYY-MM-DD or YYYY年M月D日 date: {value}")
    return calendar_date(*(int(v) for v in match.groups())).isoformat()


def _photo_text(lines: list[str], metadata: dict, title: str):
    result = {field: "" for field in ("title", "caption", "date", "date_text", "time", "location")}
    result["title"] = title
    content = [line for line in lines if not COMMENT.fullmatch(line)]
    while content and not content[0].strip():
        content.pop(0)
    # The existing albums use one explicit date, time, location line.
    if content:
        match = re.fullmatch(r"\s*(\d{4}(?:年\d{1,2}月\d{1,2}日|-\d{1,2}-\d{1,2}))"
                             r"(?:[，,、\s]+(\d{1,2}:\d{2})(?:[，,、\s]+(.*?))?)?\s*", content[0])
        if match:
            result["date_text"] = match[1]
            result["date"] = _date(match[1])
            result["time"] = match[2] or ""
            result["location"] = match[3] or ""
            content.pop(0)
    # HTML/code are excluded by the caller; captions remain literal plain text.
    result["caption"] = "\n".join(content).strip()
    for field in result:
        if field in metadata:
            if not isinstance(metadata[field], str):
                raise ValueError(f"Photo {field} must be text.")
            result[field] = metadata[field]
    if "date" in metadata:
        result["date"] = _date(metadata["date"])
        if "date_text" not in metadata:
            result["date_text"] = metadata["date"]
    return result


class PhotoExporter:
    def __init__(self, root: Path, config: dict):
        self.root = Path(root).absolute()
        self.vault = Path(config["vault_root"]).absolute()
        self.albums_root = Path(config.get("album_root", self.vault)).absolute()
        _contained(self.albums_root, self.vault)
        if not self.albums_root.is_dir():
            raise ValueError("album_root must be an existing local directory.")
        self.config = config
        self.output = self.root / "photos"
        self.images = self.output / "images"
        self.cache = self.root / ".photo-cache"
        self.catalog_path = self.output / "catalog.json"
        self.cache_path = self.cache / "cache.json"
        self._basename_index = None
        self.parser = _markdown()

    def _source(self, reference: str, note: Path) -> Path:
        reference = unquote(reference).replace("\\", "/")
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or reference.startswith("/"):
            raise ValueError(f"Only local, vault-contained image references are supported: {reference}")
        candidates = []
        roots = (note.parent,) if reference.startswith(("../", "./")) else (note.parent, self.vault)
        for parent in roots:
            candidate = parent / reference
            # A traversal outside the vault is rejected even if the file is missing.
            _contained(candidate, self.vault)
            if candidate.is_file() and candidate.resolve() not in candidates:
                candidates.append(candidate.resolve())
        if not candidates and "/" not in reference:
            if self._basename_index is None:
                self._basename_index = {}
                # Do not follow junctions/symlinks while finding attachments.
                for directory, folders, files in os.walk(self.vault, followlinks=False):
                    parent = Path(directory)
                    folders[:] = [name for name in folders if not name.startswith(".")
                                  and not _is_link(parent / name)
                                  and (parent / name).resolve() != self.root.resolve()]
                    for filename in files:
                        path = parent / filename
                        if path.suffix.lower() in IMAGE_SUFFIXES and not _is_link(path):
                            self._basename_index.setdefault(filename.casefold(), []).append(path)
            candidates = self._basename_index.get(reference.casefold(), [])
        if len(candidates) != 1:
            reason = "Ambiguous" if candidates else "Missing"
            raise ValueError(f"{reason} local image reference in {note.name}: {reference}")
        source = candidates[0]
        _contained(source, self.vault)
        if source.suffix.lower() not in IMAGE_SUFFIXES:
            raise ValueError(f"Unsupported still-image type: {source.name}")
        return source

    def _album(self, entry: dict):
        if not isinstance(entry, dict) or set(entry) - {"note", "id"}:
            raise ValueError("Each configured album requires only note and id.")
        identifier = entry.get("id", "")
        if not isinstance(identifier, str) or not ALBUM_ID.fullmatch(identifier) or identifier == "images":
            raise ValueError("Album id must be a lowercase URL slug.")
        note = self.albums_root / entry["note"]
        _contained(note, self.albums_root)
        if not note.is_file() or note.suffix.lower() != ".md":
            raise ValueError(f"Missing configured album note: {entry['note']}")
        metadata, lines = _frontmatter(note.read_text(encoding="utf-8-sig"))
        if _hidden(metadata):
            return None
        raw_body = "\n".join(lines)
        protected_lines = set()
        for token in self.parser.parse(raw_body):
            if token.map and (token.type in {"fence", "code_block"}
                              or any(child.type == "code_inline" and ("<!--" in child.content or "%%" in child.content)
                                     for child in token.children or [])):
                protected_lines.update(range(*token.map))
        stories = []
        body = _without_private_comments(raw_body, stories, protected_lines)
        lines = body.split("\n")
        tokens = self.parser.parse(body)
        h1 = ""
        heading = ""
        events = []
        caption_lines = set()
        comment_lines = set()
        for index, token in enumerate(tokens):
            if token.type == "heading_open":
                text = tokens[index + 1].content
                if token.tag == "h1" and not h1:
                    h1 = text
                heading = text if token.tag != "h1" else ""
                events.append((token.map[0], "heading", heading))
            if token.type == "html_block":
                for line_index in range(*token.map):
                    if COMMENT.fullmatch(lines[line_index]):
                        comment_lines.add(line_index)
            if token.type != "inline" or token.map is None or index == 0 or tokens[index - 1].type != "paragraph_open":
                continue
            by_line = {}
            for child in token.children or []:
                if child.type == "image":
                    line_index = token.map[0] + token.content[:child.meta["start"]].count("\n")
                    by_line.setdefault(line_index, []).append(child)
            for line_index in range(*token.map):
                images = by_line.get(line_index, [])
                if len(images) > 1:
                    raise ValueError("Put each album image on its own line so its caption is unambiguous.")
                if images:
                    image = images[0]
                    events.append((line_index, "image", image))
                else:
                    caption_lines.add(line_index)
        events.sort(key=lambda event: event[0])
        photos = []
        current_heading = ""
        for event_index, (start, kind, value) in enumerate(events):
            if kind == "heading":
                current_heading = value
                continue
            end = events[event_index + 1][0] if event_index + 1 < len(events) else len(lines)
            per_photo = {}
            first_text = next((line_index for line_index in range(start + 1, end)
                               if lines[line_index].strip() and line_index not in comment_lines), end)
            for line_index in range(start + 1, first_text):
                if line_index in comment_lines:
                    added = _comment_metadata(lines[line_index])
                    if per_photo.keys() & added.keys():
                        raise ValueError("Duplicate photo comment metadata.")
                    per_photo.update(added)
            if _hidden(per_photo):
                current_heading = ""
                continue
            source = self._source(value.attrGet("src"), note)
            title = value.attrGet("title") or value.content or current_heading
            story_blocks = {first: (last, text) for first, last, text in stories if start < first and last < end}
            permitted = []
            skip_through = -1
            for line_index in range(start + 1, end):
                if line_index <= skip_through:
                    continue
                if line_index in story_blocks:
                    skip_through, story = story_blocks[line_index]
                    permitted.extend(story.splitlines())
                else:
                    permitted.append(lines[line_index] if line_index in caption_lines else "")
            photos.append({"source": source, **_photo_text(permitted, per_photo, title)})
            current_heading = ""
        title = metadata.get("title") or h1 or note.stem
        album = {"id": identifier, "title": _without_private_comments(str(title)),
                 "description": _without_private_comments(str(metadata.get("description", ""))),
                 "date": _date(metadata.get("date", "")), "location": _without_private_comments(str(metadata.get("location", ""))),
                 "photos": photos}
        return album

    def _owned(self):
        for path in (self.root, self.output, self.images, self.cache, self.catalog_path,
                     self.cache_path, self.images / MARKER, self.cache / CACHE_MARKER):
            _contained(path, self.root)
        empty = {"version": 1, "generator": "PhotoExporter", "policy": POLICY,
                 "owned_files": [], "sources": {}, "registry": {}}
        if self.cache.exists():
            if not self.cache.is_dir() or not (self.cache / CACHE_MARKER).is_file() or (self.cache / CACHE_MARKER).read_text(encoding="utf-8") != CACHE_TEXT:
                raise ValueError("Refusing an unowned private photo cache.")
            for path in self.cache.iterdir():
                _contained(path, self.root)
                if path.name not in {CACHE_MARKER, "cache.json"} or not path.is_file():
                    raise ValueError(f"Protecting an unknown file in private photo cache: {path.name}")
        if self.cache_path.exists():
            try:
                old = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except (ValueError, OSError) as error:
                raise ValueError("Private photo cache is unreadable; preserve it for inspection.") from error
            if (not isinstance(old, dict) or old.get("version") != 1 or old.get("generator") != "PhotoExporter"
                    or not isinstance(old.get("owned_files"), list)
                    or not all(isinstance(name, str) and NAME.fullmatch(name) for name in old["owned_files"])
                    or len(set(old["owned_files"])) != len(old["owned_files"])
                    or not isinstance(old.get("sources"), dict) or not isinstance(old.get("registry"), dict)
                    or not all(isinstance(key, str) and re.fullmatch(r"[a-f0-9]{64}", key)
                               and isinstance(value, str) and PHOTO_ID.fullmatch(value) for key, value in old["registry"].items())):
                raise ValueError("Private photo cache has invalid ownership records.")
            for key, record in old["sources"].items():
                if (not isinstance(key, str) or not isinstance(record, dict)
                        or not PHOTO_ID.fullmatch(str(record.get("id", "")))
                        or not re.fullmatch(r"[a-f0-9]{64}", str(record.get("sha256", "")))):
                    raise ValueError("Private photo cache has invalid source records.")
        else:
            old = empty
            if self.catalog_path.exists():
                raise ValueError("Refusing an existing photo catalog without its ownership cache.")
        if self.images.exists():
            if not self.images.is_dir() or not (self.images / MARKER).is_file() or (self.images / MARKER).read_text(encoding="utf-8") != MARKER_TEXT:
                raise ValueError("Refusing an unowned photo images directory.")
            for path in self.images.iterdir():
                _contained(path, self.root)
                if path.name not in {MARKER, *old["owned_files"]} or not path.is_file():
                    raise ValueError(f"Protecting an unknown file in photo images: {path.name}")
        elif old["owned_files"]:
            pass  # Missing generated files can be reconstructed from originals.
        if self.catalog_path.exists() and not self.catalog_path.is_file():
            raise ValueError("Photo catalog must be a regular file.")
        return old

    def prepare(self):
        if not features.check("webp"):
            raise RuntimeError("Pillow must include WebP encoder support.")
        entries = self.config.get("albums")
        if not isinstance(entries, list):
            raise ValueError("Local config albums must be an explicit array.")
        ids = [entry.get("id") for entry in entries if isinstance(entry, dict)]
        if len(set(ids)) != len(ids):
            raise ValueError("Album ids must be unique.")
        # Resolve every allowed reference before creating or changing any output.
        albums = [album for entry in entries if (album := self._album(entry)) is not None]
        _validate_public({"albums": albums})
        old = self._owned()
        working = {**old, "policy": POLICY, "sources": dict(old["sources"]), "registry": dict(old["registry"])}
        pending = {}
        desired = set()
        records = {}
        reused = set()
        policy_bytes = json.dumps(POLICY, sort_keys=True, separators=(",", ":")).encode()
        for album in albums:
            for photo in album["photos"]:
                source = photo.pop("source")
                source_key = source.relative_to(self.vault).as_posix()
                if source_key not in records:
                    source_stat = source.stat()
                    signature = [source_stat.st_size, source_stat.st_mtime_ns, source_stat.st_ctime_ns]
                    prior = old["sources"].get(source_key, {})
                    digest = prior.get("sha256") if signature == prior.get("stat") else _digest(source)
                    identifier = prior.get("id") or old["registry"].get(digest) or "p-" + sha256(("photo:" + digest).encode()).hexdigest()[:24]
                    if not prior:
                        prior = next((item for item in old["sources"].values()
                                      if item["sha256"] == digest and item["id"] == identifier), {})
                    fingerprint = sha256(digest.encode() + policy_bytes).hexdigest()[:16]
                    usable = prior if prior.get("sha256") == digest and old.get("policy") == POLICY else {}
                    variants = {}
                    corrected = None
                    dimensions = None
                    for target in WIDTHS:
                        variant = usable.get("variants", {}).get(str(target), {})
                        name = variant.get("file", "")
                        cached = (bool(NAME.fullmatch(name)) and name.startswith(f"{identifier}-{fingerprint}-")
                                  and name in old["owned_files"] and (self.images / name).is_file()
                                  and (self.images / name).stat().st_size == variant.get("bytes")
                                  and _digest(self.images / name) == variant.get("sha256"))
                        if cached:
                            reused.add(name)
                            dimensions = (usable["width"], usable["height"])
                        else:
                            if corrected is None:
                                with Image.open(source) as original:
                                    if getattr(original, "is_animated", False):
                                        raise ValueError(f"Animated images are not supported: {source.name}")
                                    corrected = _srgb_pixels(ImageOps.exif_transpose(original))
                                    corrected.load()
                                dimensions = corrected.size
                            resized = corrected.copy()
                            resized.thumbnail((target, target), Image.Resampling.LANCZOS)
                            width, height = resized.size
                            name = f"{identifier}-{fingerprint}-{width}.webp"
                            stream = BytesIO()
                            resized.save(stream, format="WEBP", quality=POLICY["quality"], method=POLICY["method"])
                            data = stream.getvalue()
                            pending[name] = data
                            variant = {"file": name, "width": width, "height": height,
                                       "bytes": len(data), "sha256": sha256(data).hexdigest()}
                        variants[str(target)] = variant
                        desired.add(name)
                    record = {"id": identifier, "sha256": digest, "stat": signature,
                              "width": dimensions[0], "height": dimensions[1], "variants": variants}
                    records[source_key] = record
                    working["sources"][source_key] = record
                    working["registry"][digest] = identifier
                record = records[source_key]
                large = record["variants"][str(WIDTHS[-1])]
                small = record["variants"][str(WIDTHS[0])]
                photo.update({"id": record["id"], "width": large["width"], "height": large["height"],
                              "src": "/photos/images/" + large["file"],
                              "thumbnail": "/photos/images/" + small["file"],
                              "thumbnail_width": small["width"], "thumbnail_height": small["height"]})
                assert set(photo) == set(PHOTO_FIELDS)
        catalog = {"version": 1, "albums": albums}
        validate_catalog(catalog)
        # At this point source parsing, reference checks, color conversion and
        # ownership checks have all succeeded. No originals are ever written.
        self.images.mkdir(parents=True, exist_ok=True)
        self.cache.mkdir(parents=True, exist_ok=True)
        _write_changed(self.images / MARKER, MARKER_TEXT.encode())
        _write_changed(self.cache / CACHE_MARKER, CACHE_TEXT.encode())
        working["owned_files"] = sorted(set(old["owned_files"]) | desired)
        _write_changed(self.cache_path, _json_bytes(working))  # Reserve before creating images.
        for name, data in pending.items():
            _write_changed(self.images / name, data)
        _write_changed(self.catalog_path, _json_bytes(catalog))
        removed = set(old["owned_files"]) - desired
        for name in removed:
            path = self.images / name
            _contained(path, self.root)
            if path.exists():
                path.unlink()
        working["owned_files"] = sorted(desired)
        _write_changed(self.cache_path, _json_bytes(working))
        return {"albums": len(albums), "photos": sum(len(album["photos"]) for album in albums),
                "encoded_files": len(pending), "reused_files": len(reused), "removed_files": len(removed)}


def export(root: Path, config_path: Path):
    config_path = Path(config_path).absolute()
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict) or set(config) - {"vault_root", "album_root", "albums", "runtime"}:
        raise ValueError("Local config accepts only vault_root, album_root, albums and runtime.")
    if not isinstance(config.get("vault_root"), str):
        raise ValueError("Local config needs vault_root.")
    for field in ("vault_root", "album_root"):
        if field in config:
            path = Path(config[field])
            config[field] = os.path.abspath(path if path.is_absolute() else config_path.parent / path)
    return PhotoExporter(root, config).prepare()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="Canonical website repository root")
    parser.add_argument("--config", type=Path, help="Private local config; default: <root>/.photos-local.json")
    args = parser.parse_args()
    try:
        report = export(args.root, args.config or args.root / ".photos-local.json")
    except (KeyError, OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Photo export stopped safely: {error}\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
