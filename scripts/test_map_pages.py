"""Synthetic-only checks for map privacy gates, dates, rendering and local routes."""
from copy import deepcopy
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import re
import struct
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch

from map_pages import (FIELDS, OPTIONAL_FIELDS, ASSETS, read_document, public_from_document,
                       validate_catalog, load_map, build_map, table_dates, read_timeline_table)
import preview_site

ROOT = Path(__file__).resolve().parent.parent


def record():
    return dict(id="synthetic-one", start="2024-02", end="", city="示例城", region="示例区",
                country="示例国", lat=20, lon=100, title="一段经历", description="纯文本\n下一行",
                album="", certainty="confirmed")


def catalog():
    return dict(version=1, title="合成测试足迹", records=[record()])


class MapDataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="footprints-test-")
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.source = self.folder / "local.md"

    def write(self, data):
        self.source.write_text("Private source index must not appear on the web.\n```footprints\n"
                               + json.dumps(data, ensure_ascii=False) + "\n```\nPrivate note.", encoding="utf-8")

    def test_approval_is_explicit_and_preview_does_not_approve(self):
        data = catalog(); data["records"][0]["approved"] = False
        self.write(data)
        self.assertEqual(public_from_document(self.source)["records"], [])
        self.assertEqual(len(public_from_document(self.source, preview=True)["records"]), 1)
        self.assertIs(read_document(self.source)["records"][0]["approved"], False)
        data["records"][0]["approved"] = True; self.write(data)
        self.assertEqual(len(public_from_document(self.source)["records"]), 1)

    def test_approval_strings_cannot_publish_and_missing_approval_is_private(self):
        self.write(catalog())
        self.assertEqual(public_from_document(self.source)["records"], [])
        for value in ("true", 1, None):
            data = catalog(); data["records"][0]["approved"] = value; self.write(data)
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "boolean"):
                public_from_document(self.source)

    def test_sources_and_notes_are_allowlisted_outside_public_data(self):
        data = catalog(); data["private_path"] = "Z:/Private/person.md"
        data["records"][0].update(approved=True, source_path="Z:/Private/file.md", notes="private secret")
        self.write(data)
        public = public_from_document(self.source)
        self.assertEqual(set(public), {"version", "title", "records"})
        self.assertEqual(set(public["records"][0]), set(FIELDS))
        self.assertNotIn("private", json.dumps(public))

    def test_pending_never_enters_preview_or_public(self):
        data = catalog(); data["records"][0].update(certainty="pending", approved=False, lat=None)
        self.write(data)
        for preview in (True, False):
            self.assertEqual(public_from_document(self.source, preview=preview)["records"], [])
        data["records"][0]["approved"] = True; self.write(data)
        with self.assertRaisesRegex(ValueError, "pending"):
            public_from_document(self.source)

    def test_exact_and_partial_dates_keep_precision_and_unknown_end(self):
        for start, end in (("2024", ""), ("2024-02", "2024"), ("2024-02-29", "2024-03"), ("", "")):
            data = catalog(); data["records"][0].update(start=start, end=end)
            self.assertEqual(validate_catalog(data)["records"][0]["end"], end)

    def test_invalid_dates_ranges_coordinates_ids_and_extra_public_fields_rejected(self):
        for field, value in (("start", "2023-02-29"), ("start", "2024-13"), ("start", "0000"),
                             ("end", "2023"), ("lat", float("nan")), ("lat", True), ("lon", 181),
                             ("id", "../file"), ("source_path", "private"), ("certainty", "pending")):
            data = catalog(); data["records"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_catalog(data)

    def test_repeat_city_is_retained_but_duplicate_identifier_rejected(self):
        data = catalog(); second = record(); second.update(id="synthetic-two", start="2025-02")
        data["records"].append(second)
        self.assertEqual(len(validate_catalog(data)["records"]), 2)
        second["id"] = data["records"][0]["id"]
        with self.assertRaisesRegex(ValueError, "unique"):
            validate_catalog(data)

    def test_absolute_paths_and_unsafe_album_links_cannot_enter_catalog(self):
        for value in (r"D:\Private\draft.md", "/Users/a/secret", "C:/Users/person/item", r"\\server\share\file"):
            data = catalog(); data["records"][0]["description"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_catalog(data)
        for value in ("https://external.test/", "javascript:alert(1)", "/photos/../private/", "/photos/album/?token=x"):
            data = catalog(); data["records"][0]["album"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_catalog(data)

    def test_markdown_needs_one_fence_and_duplicate_json_fields_rejected(self):
        for content in ('{}', '```footprints\n{}\n```\n```footprints\n{}\n```',
                        '```footprints\n{"version":1,"version":2}\n```'):
            self.source.write_text(content, encoding="utf-8")
            with self.assertRaises(ValueError):
                read_document(self.source)

    def test_oversized_source_rejected(self):
        self.source.write_text(" " * (1024 * 1024 + 1), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "1 MiB"):
            read_document(self.source)


class TimelineTableTests(unittest.TestCase):
    def table(self, rows, extra=""):
        return "# 我的示例足迹\n\n| 时间 | 城市层级地点 | 描述 | 备注 |\n| --- | --- | --- | --- |\n" + rows + "\n\n" + extra

    def test_latest_table_is_authoritative_over_old_or_invalid_fence(self):
        text = self.table("| 2024-01 | 北京 | 本人现在写的描述 | 长期 |", "```footprints\n{old invalid data}\n```")
        with TemporaryDirectory() as folder:
            source = Path(folder) / "source.md"; source.write_text(text, encoding="utf-8")
            self.assertEqual(read_document(source)["records"][0]["description"], "本人现在写的描述")
            preview = public_from_document(source, preview=True)
            self.assertEqual(len(preview["records"]), 1)
            self.assertEqual(public_from_document(source)["records"], [])
            self.assertNotIn("_table", preview)
            self.assertNotIn("approved", preview["records"][0])

    def test_multi_city_rows_preserve_sequence_group_and_exact_description(self):
        text = self.table("| 2024-01—2024-03 | 北京、天津 、成都 | 我和家人旅行，原文。 | 短期 |\n"
                          "| 2024-04 | 北京 | 又一段原文 | 长期 |")
        data = read_timeline_table(text); first, second, third, repeat = data["records"]
        self.assertEqual([r["city"] for r in data["records"]], ["北京", "天津", "成都", "北京"])
        self.assertEqual([r["sequence"] for r in data["records"]], [0, 1, 2, 3])
        self.assertEqual(first["groupId"], third["groupId"])
        self.assertNotEqual(first["groupId"], repeat["groupId"])
        self.assertEqual(first["description"], "我和家人旅行，原文。")
        self.assertEqual(first["title"], first["description"])
        self.assertEqual(first["stayType"], "visit")
        self.assertEqual(repeat["stayType"], "base")
        self.assertEqual(len({r["id"] for r in data["records"]}), 4)

    def test_base_group_cities_share_interval_without_derived_returns_or_dates(self):
        data = read_timeline_table(self.table("| 2025-10-21—2026-04-29 | 东莞、深圳、广州 | 在大湾区长住 | 长期 |"))
        self.assertEqual(len(data["records"]), 3)
        self.assertEqual(len({r["groupId"] for r in data["records"]}), 1)
        for item in data["records"]:
            self.assertEqual((item["start"], item["end"], item["stayType"]), ("2025-10-21", "2026-04-29", "base"))
            self.assertEqual(item["description"], "在大湾区长住")
            self.assertIs(item["approved"], False)

    def test_table_dates_normalize_punctuation_and_keep_precision(self):
        for text, expected in (("2000.10", ("2000-10", "2000-10", False)),
                               ("2001—2013-06", ("2001", "2013-06", False)),
                               ("2026-02-11-2026-02-12", ("2026-02-11", "2026-02-12", False)),
                               ("2026-04-29至今", ("2026-04-29", "", True)),
                               ("2024", ("2024", "2024", False)),
                               ("2024-02-29", ("2024-02-29", "2024-02-29", False))):
            with self.subTest(text=text): self.assertEqual(table_dates(text), expected)

    def test_invalid_table_dates_and_reversed_intervals_fail(self):
        for text in ("2023-02-29", "2026-13", "2025—2024", "明年", "2026-04-29至今未知"):
            with self.subTest(text=text), self.assertRaises(ValueError): table_dates(text)

    def test_explicit_ongoing_differs_from_legacy_unknown_end(self):
        data = read_timeline_table(self.table("| 2026-04-29至今 | 吉隆坡 | 读研 | 长期 |"))
        item = {k: v for k, v in data["records"][0].items() if k != "approved"}
        self.assertTrue(validate_catalog(dict(version=1, title="示例", records=[item]))["records"][0]["ongoing"])
        self.assertNotIn("ongoing", validate_catalog(catalog())["records"][0])

    def test_unlisted_city_fails_without_silent_guess(self):
        with self.assertRaisesRegex(ValueError, "dictionary confirmation"):
            read_timeline_table(self.table("| 2024 | 无法确定的同名城 | 原文 | 短期 |"))

    def test_malaysia_visits_keep_original_labels_dates_text_and_approximate_points(self):
        text = self.table("| 2026-04-29至今 | 吉隆坡 | 读研 | 长期 |\n"
                          "| 2026-08-27—2026-08-28 | 槟城 | 旅游 | 短期 |\n"
                          "| 2026-08-29 | 马六甲 | 旅游 | 短期 |")
        with TemporaryDirectory() as folder:
            source = Path(folder) / "source.md"; source.write_text(text, encoding="utf-8")
            public = public_from_document(source, preview=True)
            kl, penang, melaka = public["records"]
            self.assertEqual((kl["city"], kl["end"], kl["ongoing"], kl["stayType"]), ("吉隆坡", "", True, "base"))
            for item, city, start, end, coordinates in (
                    (penang, "槟城", "2026-08-27", "2026-08-28", (5.4141, 100.3288)),
                    (melaka, "马六甲", "2026-08-29", "2026-08-29", (2.1896, 102.2501))):
                self.assertEqual((item["city"], item["start"], item["end"]), (city, start, end))
                self.assertEqual((item["lat"], item["lon"]), coordinates)
                self.assertEqual((item["title"], item["description"], item["stayType"], item["certainty"]),
                                 ("旅游", "旅游", "visit", "approximate"))
                self.assertNotIn("returnAfter", item)
            self.assertNotEqual(penang["groupId"], melaka["groupId"])
            self.assertEqual(public_from_document(source)["records"], [])
            self.assertEqual(source.read_text(encoding="utf-8"), text)

    def test_unconfirmed_town_to_county_proxy_stays_private(self):
        text = self.table("| 2017-07—2017-08 | 武汉、里耶 | 和家人旅游 | 短期 |")
        with TemporaryDirectory() as folder:
            source = Path(folder) / "source.md"; source.write_text(text, encoding="utf-8")
            candidates = read_document(source)["records"]
            self.assertEqual(len(candidates), 2)
            self.assertEqual(candidates[1]["certainty"], "pending")
            self.assertEqual(candidates[1]["description"], "和家人旅游")
            self.assertEqual([r["city"] for r in public_from_document(source, preview=True)["records"]], ["武汉"])
            self.assertEqual(public_from_document(source)["records"], [])

    def test_incomplete_or_duplicate_authoritative_tables_fail_without_fence_fallback(self):
        for text in (self.table("| 2024 | 北京 | 不足列 |"), self.table("") , self.table("| 2024 | 北京 | 原文 | |") * 2):
            with self.subTest(text=text), self.assertRaises(ValueError): read_timeline_table(text)

    def test_markdown_pipe_escaping_does_not_inject_more_columns(self):
        data = read_timeline_table(self.table(r"| 2024 | 北京 | 一段\|原文 | 短期 |"))
        self.assertEqual(data["records"][0]["description"], "一段|原文")

    def test_private_source_notes_never_become_description_or_public_metadata(self):
        text = self.table("| 2024 | 北京 | 用户原文 | 长期 |", "Private source Z:/private.md\n助手旧说明不进入地图")
        with TemporaryDirectory() as folder:
            source = Path(folder) / "source.md"; source.write_text(text, encoding="utf-8")
            item = public_from_document(source, preview=True)["records"][0]
            self.assertEqual(set(item), set(FIELDS) | {"stayType", "groupId", "sequence", "ongoing"})
            self.assertEqual(item["description"], "用户原文")
            self.assertNotIn("private", json.dumps(item))
            self.assertNotIn("助手", json.dumps(item, ensure_ascii=False))

    def test_optional_metadata_is_strict_and_legacy_records_remain_valid(self):
        for key, value in (("stayType", "home"), ("stayType", []), ("sequence", True), ("sequence", 500),
                           ("sequence", -1), ("groupId", "../bad"), ("ongoing", "true"), ("ongoing", 1)):
            data = catalog(); data["records"][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError): validate_catalog(data)
        data = catalog(); data["records"][0].update(ongoing=True, end="2024-03")
        with self.assertRaises(ValueError): validate_catalog(data)
        data["records"][0].update(end="", start="")
        with self.assertRaises(ValueError): validate_catalog(data)
        self.assertEqual(validate_catalog(catalog()), catalog())


class TimelineConfirmationTests(unittest.TestCase):
    ROWS = ("| 2025-10-21—2026-04-29 | 东莞、深圳、广州 | 原文基地描述 | 长期 |\n"
            "| 2026-01-04—2026-01-09 | 西充、绵阳、成都 | 原文外出一 | 短暂 |\n"
            "| 2026-01-10—2026-01-16 | 北京 | 原文外出二 | 短暂 |\n"
            "| 2026-02-11-2026-02-12 | 武汉 | 原文外出三 | 短暂 |\n"
            "| 2026-02-13—2026-02-25 | 西充、绵阳、成都 | 原文外出四 | 短暂 |\n"
            "| 2026-02-27—2026-03-03 | 重庆 | 原文外出五 | 短暂 |\n"
            "| 2017-07—2017-08 | 里耶 | 原文旅游 | 短期 |")

    def setUp(self):
        temporary = TemporaryDirectory(prefix="footprints-confirmations-"); self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name); self.source = self.folder / "timeline.md"
        self.sidecar = self.source.with_suffix(".confirmations.json")
        self.text = "# 测试地图\n\n| 时间 | 城市层级地点 | 描述 | 备注 |\n| --- | --- | --- | --- |\n" + self.ROWS
        self.source.write_text(self.text, encoding="utf-8")

    def selector(self, start="2025-10-21", end="2026-04-29", cities=None):
        return dict(start=start, end=end, cities=cities if cities is not None else ["东莞", "深圳", "广州"])

    def config(self):
        return dict(version=1,
                    baseSelections=[dict(selector=self.selector(), returnCity="东莞")],
                    returnAfter=[self.selector("2026-01-04", "2026-01-09", ["西充", "绵阳", "成都"]),
                                 self.selector("2026-02-11", "2026-02-12", ["武汉"]),
                                 self.selector("2026-02-13", "2026-02-25", ["西充", "绵阳", "成都"])],
                    placeOverrides={"里耶": dict(city="里耶（湘西）", region="湖南省湘西土家族苗族自治州龙山县",
                                              country="中国", lat=28.79, lon=109.29, certainty="confirmed",
                                              sourceURL="https://example.test/verified-public-geography",
                                              userConfirmation="本人确认此处为湘西里耶", notes="Private town-point provenance")},
                    userConfirmation="本人确认路线节点", notes="Z:/private/local-only.md",
                    sources=["Private source and geographical verification metadata"])

    def write(self, config=None):
        self.sidecar.write_text(json.dumps(self.config() if config is None else config, ensure_ascii=False), encoding="utf-8")

    def test_confirmed_base_return_breaks_and_place_override_persist_without_source_edit(self):
        original = self.source.read_bytes(); self.write(); original_sidecar = self.sidecar.read_bytes()
        for _ in range(2):
            data = public_from_document(self.source, preview=True)
            bases = [r for r in data["records"] if r["stayType"] == "base"]
            self.assertEqual([(r["city"], r["baseReturn"]) for r in bases], [("东莞", True), ("深圳", False), ("广州", False)])
            for start, count in (("2026-01-04", 3), ("2026-02-11", 1), ("2026-02-13", 3)):
                selected = [r for r in data["records"] if r["start"] == start]
                self.assertEqual(len(selected), count); self.assertTrue(all(r["returnAfter"] is True for r in selected))
            self.assertTrue(all("returnAfter" not in r for r in data["records"] if r["start"] in ("2026-01-10", "2026-02-27")))
            town = data["records"][-1]
            self.assertEqual((town["city"], town["lat"], town["lon"], town["certainty"]), ("里耶", 28.79, 109.29, "confirmed"))
            self.assertEqual(town["region"], "湖南省湘西土家族苗族自治州龙山县")
            self.assertEqual(town["description"], "原文旅游")
            self.assertEqual(public_from_document(self.source)["records"], [])
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(self.sidecar.read_bytes(), original_sidecar)

    def test_liye_display_alias_is_limited_to_confirmed_table_not_generic_documents(self):
        data = catalog(); data["records"][0]["city"] = "里耶（湘西）"
        self.source.write_text("```footprints\n" + json.dumps(data, ensure_ascii=False) + "\n```", encoding="utf-8")
        self.assertEqual(public_from_document(self.source, preview=True)["records"][0]["city"], "里耶（湘西）")

    def test_description_and_table_spacing_changes_do_not_invalidate_selectors(self):
        self.write(); self.source.write_text(self.text.replace("原文基地描述", "用户修改后的原文").replace("东莞、深圳、广州", "东莞 、 深圳 、广州"), encoding="utf-8")
        bases = [r for r in public_from_document(self.source, preview=True)["records"] if r["stayType"] == "base"]
        self.assertEqual([r["city"] for r in bases if r["baseReturn"]], ["东莞"])
        self.assertTrue(all(r["description"] == "用户修改后的原文" for r in bases))

    def test_private_confirmation_fields_never_enter_public_json(self):
        self.write(); data = public_from_document(self.source, preview=True); encoded = json.dumps(data, ensure_ascii=False)
        for forbidden in ("sourceURL", "userConfirmation", "notes", "sources", "private", "provenance", "example.test", "本人确认"):
            self.assertNotIn(forbidden, encoded)
        self.assertTrue(all(set(r).issubset(set(FIELDS) | set(OPTIONAL_FIELDS)) for r in data["records"]))

    def test_missing_sidecar_keeps_unconfirmed_town_private_and_no_route_confirmations(self):
        data = public_from_document(self.source, preview=True)
        self.assertFalse(any(r["city"].startswith("里耶") for r in data["records"]))
        self.assertTrue(all("baseReturn" not in r and "returnAfter" not in r for r in data["records"]))

    def test_unmatched_or_ambiguous_selectors_fail_loudly(self):
        config = self.config(); config["baseSelections"][0]["selector"]["end"] = "2027-04-29"; self.write(config)
        with self.assertRaisesRegex(ValueError, "unmatched"): read_document(self.source)
        self.write(); self.source.write_text(self.text + "\n" + self.ROWS.splitlines()[0] + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "ambiguous"): read_document(self.source)

    def test_selector_and_confirmation_schema_is_strict(self):
        mutations = [lambda c: c.update(version=True), lambda c: c.update(approved=True),
                     lambda c: c["baseSelections"][0].update(returnCity="广州以外"),
                     lambda c: c["baseSelections"][0]["selector"].update(cities=["东莞", "东莞"]),
                     lambda c: c["baseSelections"][0]["selector"].update(description="new text"),
                     lambda c: c["baseSelections"].append(deepcopy(c["baseSelections"][0])),
                     lambda c: c["returnAfter"].append(deepcopy(c["returnAfter"][0])),
                     lambda c: c["placeOverrides"]["里耶"].update(lat=True),
                     lambda c: c["placeOverrides"]["里耶"].update(approved=True),
                     lambda c: c["placeOverrides"].update({"未知地点": deepcopy(c["placeOverrides"]["里耶"])})]
        for mutate in mutations:
            config = self.config(); mutate(config); self.write(config)
            with self.subTest(config=config), self.assertRaises(ValueError): read_document(self.source)

    def test_base_selection_and_return_break_require_correct_row_kind(self):
        config = self.config(); config["baseSelections"][0]["selector"] = config["returnAfter"][0]; config["baseSelections"][0]["returnCity"] = "西充"; self.write(config)
        with self.assertRaisesRegex(ValueError, "base row"): read_document(self.source)
        config = self.config(); config["returnAfter"] = [config["baseSelections"][0]["selector"]]; self.write(config)
        with self.assertRaisesRegex(ValueError, "visit row"): read_document(self.source)

    def test_public_catalog_and_fence_only_source_never_read_sidecar(self):
        public = self.folder / "catalog.json"; public.write_text(json.dumps(catalog()), encoding="utf-8")
        public.with_suffix(".confirmations.json").write_text("{broken private file", encoding="utf-8")
        self.assertEqual(read_document(public), catalog())
        self.source.write_text("```footprints\n" + json.dumps(catalog()) + "\n```", encoding="utf-8")
        self.sidecar.write_text("{broken private file", encoding="utf-8")
        self.assertEqual(read_document(self.source), catalog())

    def test_optional_route_booleans_validate_mode_and_type(self):
        for field, kind in (("baseReturn", "base"), ("returnAfter", "visit")):
            for value in (True, False):
                data = catalog(); data["records"][0].update(stayType=kind, **{field: value}); validate_catalog(data)
            for value in ("true", 1, None):
                data = catalog(); data["records"][0].update(stayType=kind, **{field: value})
                with self.subTest(field=field, value=value), self.assertRaises(ValueError): validate_catalog(data)
            data = catalog(); data["records"][0].update(stayType="visit" if kind == "base" else "base", **{field: True})
            with self.assertRaises(ValueError): validate_catalog(data)


class MapRenderingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="footprints-render-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "home/assets").mkdir(parents=True)
        (self.root / "home/map.template.html").write_text(
            '<head><link href="{{site_url}}/map/"></head><script id="footprints-data" type="application/json">{{map_data}}</script>', encoding="utf-8")
        for name in ASSETS:
            (self.root / "home/assets" / name).write_text("{}", encoding="utf-8")

    def test_no_implicit_private_discovery_when_public_catalog_is_absent(self):
        (self.root / ".map-local.json").write_text('{"source":"Z:/must-not-be-opened.md"}', encoding="utf-8")
        self.assertEqual(load_map(self.root)["records"], [])

    def test_json_script_breakout_is_escaped_and_preview_banner_flag_survives(self):
        data = catalog(); attack = '</script><img src=x onerror="window.hacked=1">&{{literal}}'
        data["records"][0]["description"] = attack
        output = self.root / "output"
        report = build_map(self.root, output, "https://example.test", data, preview=True)
        html = (output / "map/index.html").read_text(encoding="utf-8")
        self.assertNotIn(attack, html)
        self.assertIn('name="robots" content="noindex,nofollow"', html)
        embedded = json.loads(re.search(r'application/json">(.*?)</script>', html, re.S)[1])
        self.assertEqual(embedded["records"][0]["description"], attack)
        self.assertTrue(embedded["preview"])
        self.assertEqual(report["records"], 1)
        for name in ASSETS:
            self.assertTrue((output / "assets" / name).is_file())

    def test_missing_album_is_rejected_before_rendering(self):
        (self.root / "map").mkdir()
        data = catalog(); data["records"][0]["album"] = "/photos/absent/"
        (self.root / "map/catalog.json").write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "unavailable"):
            load_map(self.root)

    def test_land_asset_matches_recorded_upstream_hash(self):
        metadata = json.loads((ROOT / "map/map-land.metadata.json").read_text(encoding="utf-8"))
        actual = hashlib.sha256((ROOT / "home/assets/map-land.json").read_bytes()).hexdigest()
        self.assertIn(actual, json.dumps(metadata))

    def test_default_avatar_is_a_small_png_without_private_metadata(self):
        data = (ROOT / "home/assets/map-avatar-default.png").read_bytes()
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        width, height = struct.unpack(">II", data[16:24])
        self.assertTrue(0 < width <= 384 and 0 < height <= 384)
        chunks = []
        offset = 8
        while offset < len(data):
            length = struct.unpack(">I", data[offset:offset + 4])[0]
            chunks.append(data[offset + 4:offset + 8])
            offset += length + 12
        self.assertEqual(offset, len(data))
        self.assertTrue(set(chunks).issubset({b"IHDR", b"IDAT", b"IEND"}))
        self.assertNotIn(b"Exif", data)

    def test_map_route_and_private_files_not_served(self):
        output = self.root / "output"; (output / "map").mkdir(parents=True)
        (output / "map/index.html").write_text("Synthetic map", encoding="utf-8")
        (output / ".map-local.json").write_text("private", encoding="utf-8")
        class QuietHandler(preview_site.Handler):
            def log_message(self, *args):
                pass
        with patch.object(preview_site, "OUTPUT", output.resolve()):
            server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
            worker = Thread(target=server.serve_forever, daemon=True); worker.start()
            try:
                def request(path):
                    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                    try:
                        connection.request("GET", path); response = connection.getresponse()
                        return response.status, response.getheader("Location"), response.read().decode()
                    finally:
                        connection.close()
                self.assertEqual(request("/map")[:2], (301, "/map/"))
                self.assertEqual(request("/map/")[0], 200)
                self.assertEqual(request("/.map-local.json")[0], 404)
                self.assertEqual(request("/map/../../README.md")[0], 404)
            finally:
                server.shutdown(); server.server_close(); worker.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
