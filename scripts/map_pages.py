"""Footprints: private Markdown -> allowlisted public data -> static page.

The ordinary build reads only map/catalog.json. Private Vault files are read only
by an explicit local export/preview operation, never discovered by the builder.
"""
from datetime import date
import hashlib
from html import escape
import json
import math
from pathlib import Path
import re
import shutil

FIELDS = ("id", "start", "end", "city", "region", "country", "lat", "lon",
          "title", "description", "album", "certainty")
OPTIONAL_FIELDS = ("stayType", "groupId", "sequence", "ongoing", "baseReturn", "returnAfter")
# Curated offline city/county-centre display points, not inferred addresses or GPS.
# A label missing from this dictionary is an error; no network geocoder is used.
TABLE_PLACES = {
    "绵阳安县": ("绵阳", "四川", "中国", 31.47, 104.75),
    "绵阳": ("绵阳", "四川", "中国", 31.47, 104.75),
    "海盐": ("海盐", "浙江", "中国", 30.53, 120.95),
    "西充": ("西充", "四川", "中国", 31.00, 105.90),
    "铜仁": ("铜仁", "贵州", "中国", 27.72, 109.19),
    "长沙": ("长沙", "湖南", "中国", 28.2282, 112.9388),
    "湘潭": ("湘潭", "湖南", "中国", 27.83, 112.94),
    "岳阳": ("岳阳", "湖南", "中国", 29.36, 113.13),
    "武汉": ("武汉", "湖北", "中国", 30.5928, 114.3055),
    "里耶": ("里耶", "湖南", "中国", 29.46, 109.44),
    "楚雄": ("楚雄", "云南", "中国", 25.03, 101.55),
    "北京": ("北京", "北京", "中国", 39.9042, 116.4074),
    "江阴": ("江阴", "江苏", "中国", 31.92, 120.29),
    "南昌": ("南昌", "江西", "中国", 28.68, 115.86),
    "衡阳": ("衡阳", "湖南", "中国", 26.89, 112.57),
    "忻州": ("忻州", "山西", "中国", 38.42, 112.73),
    "太原": ("太原", "山西", "中国", 37.87, 112.55),
    "天津": ("天津", "天津", "中国", 39.0842, 117.2009),
    "成都": ("成都", "四川", "中国", 30.5728, 104.0668),
    "乐山": ("乐山", "四川", "中国", 29.55, 103.77),
    "大同": ("大同", "山西", "中国", 40.08, 113.30),
    "沈阳": ("沈阳", "辽宁", "中国", 41.81, 123.43),
    "柳州": ("柳州", "广西", "中国", 24.33, 109.42),
    "北海": ("北海", "广西", "中国", 21.48, 109.12),
    "温岭": ("温岭", "浙江", "中国", 28.37, 121.38),
    "青岛": ("青岛", "山东", "中国", 36.0671, 120.3826),
    "涿州": ("涿州", "河北", "中国", 39.48, 115.97),
    "雄安": ("雄安", "河北", "中国", 39.05, 115.86),
    "高碑店": ("高碑店", "河北", "中国", 39.33, 115.87),
    "保定": ("保定", "河北", "中国", 38.87, 115.46),
    "东莞": ("东莞", "广东", "中国", 23.02, 113.75),
    "深圳": ("深圳", "广东", "中国", 22.5431, 114.0579),
    "广州": ("广州", "广东", "中国", 23.1291, 113.2644),
    "重庆": ("重庆", "重庆", "中国", 29.5630, 106.5516),
    "吉隆坡": ("吉隆坡", "吉隆坡联邦直辖区", "马来西亚", 3.1390, 101.6869),
    # Preserve the traveller's place labels. These offline display points reuse
    # the visitor city dictionary (George Town and Melaka city respectively),
    # not evidence of a particular neighbourhood, address or GPS position.
    "槟城": ("槟城", "槟城", "马来西亚", 5.4141, 100.3288),
    "马六甲": ("马六甲", "马六甲", "马来西亚", 2.1896, 102.2501),
}
PRIVATE_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\s\\]+[\\/]|/(?:Users|home|mnt)/", re.I)
ASSETS = ("map.css", "map-model.js", "map-playback.js", "map-avatar.js", "map-journey.js", "map-view.js", "map-labels.js", "map-terrain.jpg",
          "map-video.js", "map-video-ui.js", "map.js",
          "map-land.json", "map-avatar-default.png")
LIMIT = 1024 * 1024


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field: " + key)
        result[key] = value
    return result


def read_document(path):
    path = Path(path)
    if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
        raise ValueError("Footprints source must be a regular local file.")
    if path.stat().st_size > LIMIT:
        raise ValueError("Footprints document must be at most 1 MiB.")
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() != ".json":
        table = read_timeline_table(text)
        if table is not None:
            return _table_confirmations(path, table)
        blocks = re.findall(r"^```footprints\s*\n([\s\S]*?)^```\s*$", text, re.M)
        if len(blocks) != 1:
            raise ValueError("Markdown needs exactly one fenced footprints JSON block.")
        text = blocks[0]
    try:
        return json.loads(text, object_pairs_hook=_unique_pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Invalid JSON number.")))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid footprints JSON at line {exc.lineno}.") from exc


def _table_cells(line):
    """Only table syntax is stripped; descriptions are not rewritten or enriched."""
    return [cell.strip().replace(r"\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]


def table_dates(value):
    """Normalize punctuation while retaining the precision expressly supplied."""
    value = value.strip()
    token = r"\d{4}(?:[-.]\d{2}(?:[-.]\d{2})?)?"
    ongoing = value.endswith("至今")
    if ongoing:
        start, end = value[:-2].strip(), ""
    elif re.fullmatch(token, value):
        start = end = value
    else:
        match = re.fullmatch(rf"({token})\s*(?:[—–~～至]+|-(?=\d{{4}}(?:[-.]|$)))\s*({token})", value)
        if not match:
            raise ValueError("Unrecognized timeline date: " + value)
        start, end = match.groups()
    start, end = start.replace(".", "-"), end.replace(".", "-")
    _date(start); _date(end)
    if end and end < start[:len(end)]:
        raise ValueError("Timeline end precedes start: " + value)
    return start, end, ongoing


def read_timeline_table(text):
    """The user's four-column timeline wins over any older fenced JSON below it.

    Table rows are explicitly unapproved. Derived route returns never enter this
    source data, and annotations/sources elsewhere in the Markdown stay private.
    """
    lines = text.splitlines()
    header = [index for index, line in enumerate(lines)
              if line.lstrip().startswith("|") and _table_cells(line) == ["时间", "城市层级地点", "描述", "备注"]]
    if not header:
        return None
    if len(header) != 1:
        raise ValueError("Markdown needs exactly one authoritative timeline table.")
    offset = header[0]
    separator = _table_cells(lines[offset + 1]) if offset + 1 < len(lines) else []
    if len(separator) != 4 or not all(re.fullmatch(r":?-{3,}:?", cell) for cell in separator):
        raise ValueError("Timeline table needs a Markdown separator row.")
    records, rows, sequence = [], [], 0
    for number in range(offset + 2, len(lines)):
        line = lines[number]
        if not line.lstrip().startswith("|"):
            break
        cells = _table_cells(line)
        if len(cells) != 4:
            raise ValueError(f"Timeline row {number + 1} needs four columns.")
        period, places, description, note = cells
        start, end, ongoing = table_dates(period)
        labels = [place.strip() for place in re.split(r"[、，,]", places) if place.strip()]
        if not labels:
            raise ValueError(f"Timeline row {number + 1} needs a city.")
        group_id = "table-" + hashlib.sha256((period + "\n" + places).encode("utf-8")).hexdigest()[:16]
        rows.append({"groupId": group_id, "sourceLine": number + 1, "period": period, "places": places,
                     "description": description, "note": note})
        for city_index, label in enumerate(labels):
            if label not in TABLE_PLACES:
                raise ValueError("Timeline city needs explicit offline dictionary confirmation: " + label)
            city, region, country, lat, lon = TABLE_PLACES[label]
            # The table names a town here but the map promises only city/county
            # precision. Its county-centre proxy is not user-confirmed, so keep
            # the candidate private until the user resolves that mapping.
            certainty = ("pending" if label == "里耶" else
                         "approximate" if label in {"槟城", "马六甲"} else "confirmed")
            record = dict(zip(FIELDS, (f"{group_id}-{city_index + 1}", start, end, city, region, country,
                                      lat, lon, description or city, description, "", certainty)))
            record.update(stayType="base" if note == "长期" else "visit", groupId=group_id,
                          sequence=sequence, ongoing=ongoing, approved=False)
            records.append(record); sequence += 1
    if not rows:
        raise ValueError("Authoritative timeline table cannot be empty.")
    title = next((line[2:].strip() for line in lines if line.startswith("# ")), "我的足迹")
    return {"version": 1, "title": title, "records": records,
            "_table": {"rows": rows, "rowCount": len(rows), "recordCount": len(records)}}


def _confirmation_selector(table, selector):
    """Match original date/city values, independent of description and row IDs."""
    if not isinstance(selector, dict) or set(selector) != {"start", "end", "cities"}:
        raise ValueError("Confirmation selector needs start, end and cities only.")
    _date(selector["start"]); _date(selector["end"])
    cities = selector["cities"]
    if (not isinstance(cities, list) or not cities or len(cities) > 500
            or any(not isinstance(city, str) or not city.strip() or len(city) > 160 for city in cities)
            or len(set(cities)) != len(cities)):
        raise ValueError("Confirmation selector cities must be unique nonempty labels.")
    matches = []
    for row in table["_table"]["rows"]:
        row_cities = [city.strip() for city in re.split(r"[、，,]", row["places"]) if city.strip()]
        if (table_dates(row["period"])[:2] == (selector["start"], selector["end"])
                and len(row_cities) == len(cities) and set(row_cities) == set(cities)):
            matches.append(row)
    if len(matches) != 1:
        raise ValueError("Confirmation selector is " + ("unmatched" if not matches else "ambiguous")
                         + ": " + json.dumps(selector, ensure_ascii=False))
    row = matches[0]
    return row, [record for record in table["records"] if record["groupId"] == row["groupId"]]


def _private_confirmation_metadata(value, allowed):
    """Validate local notes without ever adding them to public record fields."""
    for key in allowed:
        if key in value and (not isinstance(value[key], str) or len(value[key]) > 12000):
            raise ValueError("Private confirmation metadata must be text: " + key)


def _table_confirmations(source, table):
    """Read an adjacent private sidecar only for an explicitly opened table.

    Ordinary builds read a .json public catalog and never enter this function.
    This file confirms route semantics and locality identity, not publication.
    """
    sidecar = source.with_suffix(".confirmations.json")
    if sidecar.is_symlink() or (hasattr(sidecar, "is_junction") and sidecar.is_junction()):
        raise ValueError("Private timeline confirmations must be a regular local file.")
    if not sidecar.exists():
        return table
    if not sidecar.is_file() or sidecar.stat().st_size > LIMIT:
        raise ValueError("Private timeline confirmations must be a regular file at most 1 MiB.")
    try:
        config = json.loads(sidecar.read_text(encoding="utf-8-sig"), object_pairs_hook=_unique_pairs,
                            parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Invalid JSON number.")))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid timeline confirmations JSON at line {exc.lineno}.") from exc
    keys = {"version", "baseSelections", "returnAfter", "placeOverrides", "userConfirmation", "notes", "sources"}
    if (not isinstance(config, dict) or set(config) - keys or type(config.get("version")) is not int
            or config["version"] != 1):
        raise ValueError("Private timeline confirmations need version 1 and supported fields only.")
    _private_confirmation_metadata(config, ("userConfirmation", "notes"))
    if "sources" in config and (not isinstance(config["sources"], list) or len(config["sources"]) > 50
                                or any(not isinstance(item, str) or len(item) > 2000 for item in config["sources"])):
        raise ValueError("Private confirmation sources must be a list of text references.")
    selections, returns, overrides = (config.get("baseSelections", []), config.get("returnAfter", []),
                                     config.get("placeOverrides", {}))
    if (not isinstance(selections, list) or len(selections) > 500 or not isinstance(returns, list)
            or len(returns) > 500 or not isinstance(overrides, dict) or len(overrides) > 500):
        raise ValueError("Invalid private confirmation collection.")
    seen = set()
    for selection in selections:
        if not isinstance(selection, dict) or set(selection) != {"selector", "returnCity"}:
            raise ValueError("Base selection needs selector and returnCity only.")
        row, records = _confirmation_selector(table, selection["selector"])
        if row["groupId"] in seen:
            raise ValueError("Duplicate base confirmation selector.")
        seen.add(row["groupId"])
        if any(record["stayType"] != "base" for record in records):
            raise ValueError("Base selection must match a long-term base row.")
        labels = [city.strip() for city in re.split(r"[、，,]", row["places"]) if city.strip()]
        if not isinstance(selection["returnCity"], str) or labels.count(selection["returnCity"]) != 1:
            raise ValueError("Base returnCity must uniquely name one city in its source row.")
        for index, record in enumerate(records):
            record["baseReturn"] = labels[index] == selection["returnCity"]
    seen = set()
    for selector in returns:
        row, records = _confirmation_selector(table, selector)
        if row["groupId"] in seen:
            raise ValueError("Duplicate returnAfter confirmation selector.")
        seen.add(row["groupId"])
        if any(record["stayType"] != "visit" for record in records):
            raise ValueError("returnAfter must match a visit row.")
        for record in records:
            record["returnAfter"] = True
    for label, override in overrides.items():
        public_keys = {"city", "region", "country", "lat", "lon", "certainty"}
        if (not isinstance(label, str) or not label or not isinstance(override, dict)
                or not public_keys.issubset(override)
                or set(override) - public_keys - {"sourceURL", "userConfirmation", "notes"}):
            raise ValueError("Place override needs supported display/coordinate fields only.")
        _private_confirmation_metadata(override, ("sourceURL", "userConfirmation", "notes"))
        for key in ("city", "region", "country"):
            _text(override[key], key, 200 if key == "region" else 160, key != "region")
        if override["certainty"] not in ("confirmed", "approximate"):
            raise ValueError("A confirmed place override needs confirmed or approximate certainty.")
        for key, low, high in (("lat", -90, 90), ("lon", -180, 180)):
            if (type(override[key]) not in {int, float} or not math.isfinite(override[key])
                    or not low <= override[key] <= high):
                raise ValueError("Invalid confirmed place coordinate: " + key)
        matched = []
        for row in table["_table"]["rows"]:
            labels = [city.strip() for city in re.split(r"[、，,]", row["places"]) if city.strip()]
            records = [record for record in table["records"] if record["groupId"] == row["groupId"]]
            matched.extend(record for original, record in zip(labels, records) if original == label)
        if not matched:
            raise ValueError("Place confirmation label is unmatched: " + label)
        public_override = {key: override[key] for key in public_keys}
        # The private confirmation may retain its old disambiguation label;
        # the author's requested display name is the source-table label.
        # This narrow compatibility alias leaves source/sidecar bytes and
        # arbitrary visitor documents untouched, including all descriptions.
        if label == "里耶" and public_override["city"] == "里耶（湘西）":
            public_override["city"] = "里耶"
        for record in matched:
            record.update(public_override)
    return table


def _text(value, label, maximum, required=False):
    if (not isinstance(value, str) or len(value) > maximum or (required and not value.strip())
            or PRIVATE_PATH.search(value) or any(ord(c) < 32 and c not in "\n\t" for c in value)):
        raise ValueError("Invalid public footprints text: " + label)
    return value


def _date(value):
    if not isinstance(value, str) or (value and not re.fullmatch(r"\d{4}(?:-\d{2}(?:-\d{2})?)?", value)):
        raise ValueError("Use YYYY, YYYY-MM, YYYY-MM-DD or an empty date.")
    if not value:
        return None
    parts = [int(x) for x in value.split("-")]
    try:
        return date(parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1)
    except ValueError as exc:
        raise ValueError("Invalid footprints calendar date.") from exc


def validate_catalog(data):
    if (not isinstance(data, dict) or set(data) != {"version", "title", "records"}
            or type(data["version"]) is not int or data["version"] != 1
            or not isinstance(data["records"], list) or len(data["records"]) > 500):
        raise ValueError("Footprints catalog needs version 1, title and at most 500 records.")
    _text(data["title"], "title", 120, True)
    ids = set()
    for record in data["records"]:
        if (not isinstance(record, dict) or not set(FIELDS).issubset(record)
                or set(record) - set(FIELDS) - set(OPTIONAL_FIELDS)):
            raise ValueError("Public footprints records must contain only the supported fields.")
        for field in ("id", "city", "country", "title"):
            _text(record[field], field, 160, True)
        for field in ("region", "album"):
            _text(record[field], field, 200)
        _text(record["description"], "description", 12000)
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}", record["id"]) or record["id"] in ids:
            raise ValueError("Footprints IDs must be unique safe identifiers.")
        ids.add(record["id"])
        start, end = _date(record["start"]), _date(record["end"])
        # Compare possible interval bounds: a year end may legitimately follow a
        # month start within that same year, without inventing day precision.
        if start and end and record["end"] < record["start"][:len(record["end"])]:
            raise ValueError("Footprints end precedes start.")
        for field, low, high in (("lat", -90, 90), ("lon", -180, 180)):
            coordinate = record[field]
            if type(coordinate) not in {int, float} or not math.isfinite(coordinate) or not low <= coordinate <= high:
                raise ValueError("Invalid city coordinate: " + field)
        if not isinstance(record["certainty"], str) or record["certainty"] not in {"confirmed", "approximate"}:
            raise ValueError("Unconfirmed interpretations cannot enter the public map.")
        if record["album"] and not re.fullmatch(r"/photos/[a-z][a-z0-9]*(?:-[a-z0-9]+)*/", record["album"]):
            raise ValueError("Albums must be local /photos/album-slug/ links.")
        if "stayType" in record and (not isinstance(record["stayType"], str) or record["stayType"] not in {"base", "visit"}):
            raise ValueError("stayType must be base or visit.")
        if "groupId" in record and (not isinstance(record["groupId"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", record["groupId"])):
            raise ValueError("groupId must be a safe row identifier.")
        if "sequence" in record and (type(record["sequence"]) is not int or not 0 <= record["sequence"] < 500):
            raise ValueError("sequence must be an integer from 0 through 499.")
        if "ongoing" in record and (type(record["ongoing"]) is not bool or (record["ongoing"] and (not record["start"] or record["end"]))):
            raise ValueError("ongoing must be a boolean; an ongoing record needs a start and no end.")
        for field, kind in (("baseReturn", "base"), ("returnAfter", "visit")):
            if field in record and (type(record[field]) is not bool or record.get("stayType") != kind):
                raise ValueError(field + " must be a boolean on a " + kind + " record.")
    return data


def public_from_document(source, preview=False):
    data = read_document(source)
    if (not isinstance(data, dict) or type(data.get("version")) is not int or data.get("version") != 1
            or not isinstance(data.get("records"), list) or len(data["records"]) > 500):
        raise ValueError("Private document needs version 1 and at most 500 records.")
    records = []
    for record in data["records"]:
        if not isinstance(record, dict):
            raise ValueError("Each footprints record must be an object.")
        if "approved" in record and type(record["approved"]) is not bool:
            raise ValueError("approved must be the explicit JSON boolean true or false.")
        if record.get("certainty") == "pending":
            if record.get("approved") is True:
                raise ValueError("Resolve pending evidence before approving it.")
            continue
        if not preview and record.get("approved") is not True:
            continue
        if any(field not in record for field in FIELDS):
            raise ValueError("An included footprints record lacks required public fields.")
        records.append({field: record[field] for field in (*FIELDS, *OPTIONAL_FIELDS) if field in record})
    # All other top-level or per-record metadata (source paths, notes, approval)
    # is discarded before validation or serialization.
    return validate_catalog({"version": 1, "title": data.get("title", "我的足迹"), "records": records})


def safe_file(root, source):
    source = Path(source)
    for part in (source, *source.parents):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError("Map assets cannot traverse symlinks or junctions.")
        if part == root:
            break


def load_map(root, preview_source=None):
    root = Path(root)
    if preview_source:
        data = public_from_document(preview_source, preview=True)
    else:
        source = root / "map/catalog.json"
        if source.exists():
            safe_file(root, source)
            data = validate_catalog(read_document(source))
        else:
            data = {"version": 1, "title": "我的足迹", "records": []}
    for record in data["records"]:
        if record["album"]:
            catalog = root / "photos/catalog.json"
            if not catalog.exists():
                raise ValueError("An associated photo album is unavailable.")
            albums = json.loads(catalog.read_text(encoding="utf-8"))["albums"]
            if record["album"].split("/")[2] not in {album["id"] for album in albums}:
                raise ValueError("An associated photo album is unavailable.")
    for name in ASSETS:
        source = root / "home/assets" / name
        safe_file(root, source)
        if not source.is_file():
            raise ValueError("Missing map asset: " + name)
    template = root / "home/map.template.html"
    safe_file(root, template)
    if not template.is_file():
        raise ValueError("Missing map template.")
    return data


def build_map(root, output, address, data, preview=False):
    root, output = Path(root), Path(output)
    public = dict(validate_catalog(data))
    public["preview"] = bool(preview)
    public["notice"] = ("本地待核对预览：这些经历尚未批准公开，来源与私人备注不包含在网页中。"
                        if preview else "")
    serialized = json.dumps(public, ensure_ascii=False).replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    page = (root / "home/map.template.html").read_text(encoding="utf-8")
    if "{{" in page.replace("{{site_url}}", "").replace("{{map_data}}", ""):
        raise ValueError("Unresolved map template placeholder.")
    page = page.replace("{{site_url}}", escape(address, quote=True)).replace("{{map_data}}", serialized)
    if preview:
        page = page.replace("</head>", '<meta name="robots" content="noindex,nofollow">\n</head>')
    for folder in (output / "map", output / "assets"):
        safe_file(output, folder)
        folder.mkdir(parents=True, exist_ok=True)
    target = output / "map/index.html"
    safe_file(output, target)
    target.write_text(page, encoding="utf-8")
    for name in ASSETS:
        target = output / "assets" / name
        safe_file(output, target)
        shutil.copy2(root / "home/assets" / name, target)
    example = root / "map/example.md"
    if example.is_file():
        safe_file(root, example)
        target = output / "assets/map-example.md"
        safe_file(output, target)
        shutil.copy2(example, target)
    return {"records": len(public["records"]), "preview": bool(preview), "route": "map"}
