"""Render a strictly public photo catalog; never read the private photo vault."""
from html import escape
from pathlib import Path
from urllib.parse import urlsplit
import json
import re
import shutil

from image_assets import _is_link

ALBUM_FIELDS = {"id", "title", "description", "date", "location", "photos"}
PHOTO_FIELDS = {"id", "title", "caption", "date", "date_text", "time", "location", "width", "height",
                "src", "thumbnail", "thumbnail_width", "thumbnail_height"}
TEXT_FIELDS = {"title", "caption", "date", "date_text", "time", "location", "description"}
IMAGE_URL = re.compile(r"/photos/images/(p-[0-9a-f]{24})-([0-9a-f]{12,64})-([1-9][0-9]{0,4})\.webp\Z")
SLUG = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")
PRIVATE_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\s\\]+[\\/]|/(?:Users|home|mnt)/", re.I)
OWNED_FILE = re.compile(r"(?:index\.html|[a-z][a-z0-9]*(?:-[a-z0-9]+)*/index\.html|images/p-[0-9a-f]{24}-[0-9a-f]{12,64}-[1-9][0-9]{0,4}\.webp)\Z")
MARKER = ".generated-by-photo-pages"
MANIFEST = ".photo-files.json"
MARKER_TEXT = "PhotoPages generated public pages, ownership version 1.\n"


def _text(value, field):
    if (not isinstance(value, str) or len(value) > (12000 if field in {"caption", "description"} else 1000)
            or PRIVATE_PATH.search(value) or any(ord(c) < 32 and c != "\n" for c in value)
            or "\r" in value or "\x7f" in value):
        raise ValueError(f"Invalid public photo text: {field}.")


def validate_catalog(data):
    """Return the same catalog after checking its public field and URL allowlists."""
    if not isinstance(data, dict) or set(data) != {"version", "albums"} or type(data["version"]) is not int or data["version"] != 1:
        raise ValueError("Photo catalog must contain only version 1 and albums.")
    if not isinstance(data["albums"], list) or len(data["albums"]) > 1000:
        raise ValueError("Photo catalog albums must be a list of at most 1000 entries.")
    album_ids = set()
    for album in data["albums"]:
        if not isinstance(album, dict) or set(album) != ALBUM_FIELDS:
            raise ValueError("Album fields are incomplete or contain private metadata.")
        slug = album["id"]
        if not isinstance(slug, str) or len(slug) > 64 or not SLUG.fullmatch(slug) or slug in album_ids or slug == "images":
            raise ValueError("Photo album IDs must be unique lowercase slugs outside reserved routes.")
        album_ids.add(slug)
        for field in ("title", "description", "date", "location"):
            _text(album[field], field)
        if not album["title"].strip():
            raise ValueError("Albums require their original title.")
        if not isinstance(album["photos"], list) or len(album["photos"]) > 10000:
            raise ValueError("Album photos must be a list of at most 10000 entries.")
        photo_ids = set()
        for photo in album["photos"]:
            if not isinstance(photo, dict) or set(photo) != PHOTO_FIELDS:
                raise ValueError("Photo fields are incomplete or contain private metadata.")
            if not isinstance(photo["id"], str) or not re.fullmatch(r"p-[0-9a-f]{24}", photo["id"]) or photo["id"] in photo_ids:
                raise ValueError("Photo IDs must be stable unique p- identifiers within each album.")
            photo_ids.add(photo["id"])
            for field in PHOTO_FIELDS & TEXT_FIELDS:
                _text(photo[field], field)
            for field in ("width", "height", "thumbnail_width", "thumbnail_height"):
                if type(photo[field]) is not int or not 1 <= photo[field] <= 30000:
                    raise ValueError("Photo dimensions must be positive bounded integers.")
            for field, width in (("src", "width"), ("thumbnail", "thumbnail_width")):
                match = IMAGE_URL.fullmatch(photo[field]) if isinstance(photo[field], str) else None
                if not match or match[1] != photo["id"] or int(match[3]) != photo[width]:
                    raise ValueError("Photo URLs must reference their own compressed public WebP derivatives.")
            if photo["thumbnail_width"] > photo["width"] or photo["thumbnail_height"] > photo["height"]:
                raise ValueError("Photo thumbnail dimensions cannot exceed the large derivative.")
            if abs(photo["thumbnail_width"] / photo["thumbnail_height"] - photo["width"] / photo["height"]) > .03:
                raise ValueError("Photo thumbnail and large image must share their orientation and aspect ratio.")
    return data


def _facts(date="", time="", location=""):
    fields = [date, time if time and time not in date else "", location]
    items = "".join(f"<li>{escape(value)}</li>" for value in fields if value)
    return f'<ul class="photo-facts">{items}</ul>' if items else ""


def render_index(albums):
    cards = []
    for album in albums:
        photos = album["photos"]
        if photos:
            photo = photos[0]
            cover = (f'<img src="{escape(photo["thumbnail"])}" width="{photo["thumbnail_width"]}" '
                     f'height="{photo["thumbnail_height"]}" alt="{escape(photo["title"], quote=True)}" loading="lazy" decoding="async">')
        else:
            cover = '<span>暂无公开照片</span>'
        description = f'<p class="album-description">{escape(album["description"])}</p>' if album["description"] else ""
        cards.append(f'''<article class="album-card"><a href="/photos/{album["id"]}/"><div class="album-cover">{cover}</div>
<h2>{escape(album["title"])} <span aria-hidden="true">↗</span></h2></a>{description}
{_facts(album["date"], location=album["location"])}<p class="photo-help">{len(photos)} 张照片</p></article>''')
    body = '<div class="album-grid">' + "\n".join(cards) + "</div>" if cards else '<p class="photos-empty">相册正在整理中。</p>'
    return '''<section class="photos-intro" aria-labelledby="photos-title"><p class="eyebrow"><span aria-hidden="true"></span> PHOTOGRAPHY · 摄影</p>
<h1 id="photos-title">摄影 <span lang="en">Photos</span></h1></section>''' + body


def render_album(album):
    rows = []
    for index, photo in enumerate(album["photos"]):
        heading = f'<h2>{escape(photo["title"])}</h2>' if photo["title"] else ""
        caption = (f'<div class="photo-story"><p class="photo-story-label">照片故事</p><p class="photo-caption">{escape(photo["caption"])}</p></div>'
                   if photo["caption"] else "")
        facts = _facts(photo["date_text"] or photo["date"], photo["time"], photo["location"])
        copy = f'<figcaption>{heading}{caption}{facts}</figcaption>' if heading or caption or facts else ""
        rows.append(f'''<figure class="photo-item"><a class="photo-open" data-photo-open data-photo-index="{index}" href="{escape(photo["src"])}" aria-label="查看第 {index + 1} 张照片{('：' + escape(photo['title'], quote=True)) if photo['title'] else ''}"><img src="{escape(photo["thumbnail"])}" width="{photo["thumbnail_width"]}" height="{photo["thumbnail_height"]}" alt="{escape(photo["title"], quote=True)}" loading="lazy" decoding="async"></a>{copy}</figure>''')
    photos = '<div class="photo-grid">' + "\n".join(rows) + "</div>" if rows else '<p class="photos-empty">此相册暂无公开照片。</p>'
    description = f'<p class="album-description">{escape(album["description"])}</p>' if album["description"] else ""
    header = f'''<a class="photo-back" href="/photos/">← 全部相册</a><section class="photos-intro" aria-labelledby="album-title"><p class="eyebrow"><span aria-hidden="true"></span> PHOTOGRAPHY · 摄影</p>
<h1 id="album-title">{escape(album["title"])}</h1>{description}{_facts(album["date"], location=album["location"])}<p class="photo-help">{len(rows)} 张照片</p></section>'''
    if not rows:
        return header + photos
    encoded = json.dumps(album["photos"], ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    viewer = '''<dialog class="photo-viewer" id="photo-viewer" aria-label="照片查看器" aria-describedby="photo-viewer-caption photo-viewer-facts">
<div class="photo-viewer-head"><p class="photo-position" aria-live="polite"></p><button class="photo-close" type="button">关闭 <span aria-hidden="true">×</span></button></div>
<div class="photo-stage"><img class="photo-large" alt=""><button class="photo-previous" type="button" aria-label="上一张照片">←</button><button class="photo-next" type="button" aria-label="下一张照片">→</button></div>
<div class="photo-viewer-copy"><h2 id="photo-viewer-title"></h2><p class="photo-story-label" id="photo-viewer-story-label">照片故事</p><p class="photo-caption" id="photo-viewer-caption"></p><ul class="photo-facts" id="photo-viewer-facts"></ul><p class="photo-viewer-hint">← → 切换 · Esc 关闭 · 手机可左右滑动，双指放大</p></div></dialog>'''
    return header + photos + '<p class="photo-help">点击照片查看大图</p>' + viewer + f'<script type="application/json" id="photo-data">{encoded}</script>'


def _safe_path(base, path):
    base, path = Path(base).absolute(), Path(path).absolute()
    if not path.resolve().is_relative_to(base.resolve()):
        raise ValueError("Photo path escapes its owned directory.")
    current = path
    while True:
        if _is_link(current):
            raise ValueError("Photo paths cannot contain symlinks or junctions.")
        if current == base:
            break
        if current.parent == current:
            raise ValueError("Photo path is outside its owned directory.")
        current = current.parent


def _render_page(template, address, route, title, description, content):
    values = {"site_url": address, "photo_path": route, "photo_title": title,
              "photo_description": description, "photo_content": content}
    # Substitute once: literal braces in the user's text are not template syntax.
    result = re.sub(r"\{\{([a-z_]+)\}\}", lambda match: values[match[1]] if match[1] == "photo_content" else escape(values[match[1]], quote=True), template)
    return result


def build_photos(root, output, address, *, allow_local_map_preview=False):
    """Copy only validated public derivatives and render all photography routes."""
    root, output = Path(root).absolute(), Path(output).absolute()
    parts = urlsplit(address)
    if parts.scheme != "https" or not parts.netloc or parts.path or parts.query or parts.fragment or parts.username or parts.password:
        raise ValueError("Photo pages need the root HTTPS site origin.")
    allowed_output = "_site_map_preview" if allow_local_map_preview else "_site_unified"
    if output.resolve() != root.resolve() / allowed_output:
        raise ValueError("Photo output must be the existing unified site directory.")
    catalog_path = root / "photos/catalog.json"
    _safe_path(root, catalog_path)
    catalog = validate_catalog(json.loads(catalog_path.read_text(encoding="utf-8"))) if catalog_path.exists() else {"version": 1, "albums": []}
    template_path = root / "home/photos.template.html"
    _safe_path(root, template_path)
    template = template_path.read_text(encoding="utf-8")
    if set(re.findall(r"\{\{([a-z_]+)\}\}", template)) != {"site_url", "photo_path", "photo_title", "photo_description", "photo_content"}:
        raise ValueError("Photo template placeholders are incomplete or unsupported.")
    assets = {}
    for album in catalog["albums"]:
        for photo in album["photos"]:
            for field, width, height in (("src", "width", "height"), ("thumbnail", "thumbnail_width", "thumbnail_height")):
                relative = photo[field].removeprefix("/photos/")
                source = root / "photos" / relative
                _safe_path(root, source)
                if not source.is_file():
                    raise ValueError("A referenced public photo derivative is missing.")
                dimensions = (photo[width], photo[height])
                if relative in assets and assets[relative][1] != dimensions:
                    raise ValueError("A photo derivative has conflicting dimensions.")
                assets[relative] = (source, dimensions)
    # Check actual encoding and metadata before creating any public output.
    if assets:
        from PIL import Image
        for source, dimensions in assets.values():
            with Image.open(source) as image:
                if image.format != "WEBP" or image.size != dimensions or image.getexif() or any(image.info.get(field) for field in ("exif", "xmp", "icc_profile")) or getattr(image, "is_animated", False):
                    raise ValueError("Public photos must be normalized static WebP images without private metadata.")
                image.verify()
    ui_assets = []
    for name in ("photos.css", "photos.js"):
        source = root / "home/assets" / name
        _safe_path(root, source)
        if not source.is_file():
            raise ValueError("Photography UI assets are missing.")
        destination = output / "assets" / name
        _safe_path(output, destination)
        ui_assets.append((source, destination))
    destination_root = output / "photos"
    _safe_path(output, destination_root)
    marker = destination_root / MARKER
    manifest_path = destination_root / MANIFEST
    for path in (marker, manifest_path):
        _safe_path(output, path)
    old_files = []
    if destination_root.exists() and any(destination_root.iterdir()):
        if not marker.is_file() or marker.read_text(encoding="utf-8") != MARKER_TEXT or not manifest_path.is_file():
            raise ValueError("Preserve the unrecognized photography output directory.")
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(previous, dict) or set(previous) != {"version", "files"} or previous["version"] != 1 or not isinstance(previous["files"], list):
            raise ValueError("Photo output ownership manifest is invalid.")
        old_files = previous["files"]
        if any(not isinstance(value, str) or not OWNED_FILE.fullmatch(value) for value in old_files) or len(set(old_files)) != len(old_files):
            raise ValueError("Photo output ownership contains unsafe or duplicate paths.")
    routes = ["photos"] + ["photos/" + album["id"] for album in catalog["albums"]]
    files = {"index.html": _render_page(template, address, "photos", "摄影 / Photos", "谢雨卿的摄影相册。", render_index(catalog["albums"]))}
    for album in catalog["albums"]:
        files[album["id"] + "/index.html"] = _render_page(template, address, "photos/" + album["id"], album["title"], album["description"] or album["title"], render_album(album))
    desired = sorted(set(files) | set(assets))
    allowed_files = {MARKER, MANIFEST, *old_files}
    allowed_directories = set()
    for relative in set(old_files) | set(desired):
        allowed_directories.update(parent.as_posix() for parent in Path(relative).parents if parent != Path("."))
    if destination_root.exists():
        pending = [destination_root]
        while pending:
            directory = pending.pop()
            for entry in directory.iterdir():
                _safe_path(output, entry)
                relative = entry.relative_to(destination_root).as_posix()
                if entry.is_dir() and relative in allowed_directories:
                    pending.append(entry)
                elif not entry.is_file() or relative not in allowed_files:
                    raise ValueError("Preserve an unknown file or directory in photography output.")
    for relative in set(old_files) | set(desired):
        path = destination_root / relative
        _safe_path(output, path)
        if path.exists() and not path.is_file():
            raise ValueError("A generated photo destination is not a regular file.")
    destination_root.mkdir(parents=True, exist_ok=True)
    marker.write_text(MARKER_TEXT, encoding="utf-8")
    manifest_path.write_text(json.dumps({"version": 1, "files": sorted(set(old_files) | set(desired))}) + "\n", encoding="utf-8")
    for source, destination in ui_assets:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    for relative, content in files.items():
        destination = destination_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")
    for relative, (source, _) in assets.items():
        destination = destination_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or destination.read_bytes() != source.read_bytes():
            shutil.copy2(source, destination)
    for relative in set(old_files) - set(desired):
        obsolete = destination_root / relative
        if obsolete.is_file():
            obsolete.unlink()
    for relative in sorted(allowed_directories, key=lambda value: len(Path(value).parts), reverse=True):
        directory = destination_root / relative
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()
    manifest_path.write_text(json.dumps({"version": 1, "files": desired}) + "\n", encoding="utf-8")
    return {"routes": routes, "albums": len(catalog["albums"]), "photos": sum(len(album["photos"]) for album in catalog["albums"])}
