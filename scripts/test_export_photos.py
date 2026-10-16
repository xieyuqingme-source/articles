"""Safety, parsing, privacy and repeatability checks for the local photo export."""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageCms
import export_photos
from export_photos import PhotoExporter, export, MARKER, CACHE_MARKER, PHOTO_FIELDS


class PhotoExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1])
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.vault = self.base / "private-vault"
        self.albums = self.vault / "摄影集"
        self.attachments = self.vault / "附件"
        self.root = self.base / "public-site"
        self.root.mkdir()
        self.albums.mkdir(parents=True)
        self.attachments.mkdir()
        self.note = self.albums / "北京记忆.md"
        self.config = {"vault_root": str(self.vault), "album_root": str(self.albums),
                       "albums": [{"note": self.note.name, "id": "beijing-memory"}]}

    def image(self, name="photo.jpg", size=(1600, 900), **options):
        path = self.attachments / name
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, (65, 110, 175)).save(path, **options)
        return path

    def write(self, value="![[photo.jpg]]\n\n2023年5月12日，17:09，北京市房山区\n这是原始说明。\n"):
        self.note.write_text(value, encoding="utf-8")

    def prepare(self):
        return PhotoExporter(self.root, self.config).prepare()

    def catalog(self):
        return json.loads((self.root / "photos/catalog.json").read_text(encoding="utf-8"))

    def photo(self):
        return self.catalog()["albums"][0]["photos"][0]

    def snapshot(self, root=None):
        return {str(path.relative_to(root or self.root)): (path.read_bytes(), path.stat().st_mtime_ns)
                for path in (root or self.root).rglob("*") if path.is_file()}

    def test_actual_note_shape_only_whitelisted_fields_and_unchanged_sources(self):
        source = self.image()
        self.write()
        (self.albums / "0000_我的摄影理念.md").write_text("secret unrelated philosophy", encoding="utf-8")
        original = self.snapshot(self.vault)
        report = self.prepare()
        self.assertEqual((report["albums"], report["photos"]), (1, 1))
        album = self.catalog()["albums"][0]
        self.assertEqual(set(album), {"id", "title", "description", "date", "location", "photos"})
        self.assertEqual(album["title"], "北京记忆")
        photo = self.photo()
        self.assertEqual(set(photo), set(PHOTO_FIELDS))
        self.assertEqual((photo["title"], photo["date"], photo["date_text"], photo["time"], photo["location"]),
                         ("", "2023-05-12", "2023年5月12日", "17:09", "北京市房山区"))
        self.assertEqual(photo["caption"], "这是原始说明。")
        text = (self.root / "photos/catalog.json").read_text(encoding="utf-8")
        for private in (str(source), "private-vault", "photo.jpg", "source_sha256", "secret", "0000_"):
            self.assertNotIn(private, text)
        self.assertEqual(original, self.snapshot(self.vault))

    def test_orientation_icc_conversion_and_all_metadata_removed(self):
        exif = Image.Exif()
        exif[274] = 6
        exif[315] = "private author"
        exif[34853] = {1: "N", 2: (1.0, 2.0, 3.0), 3: "E", 4: (4.0, 5.0, 6.0)}
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        source = self.image(size=(2000, 1000), exif=exif, icc_profile=profile,
                            xmp=b'<x:xmpmeta>private GPS metadata</x:xmpmeta>')
        original = source.read_bytes()
        self.write()
        with patch.object(export_photos, "_srgb_pixels", wraps=export_photos._srgb_pixels) as convert:
            self.prepare()
            self.assertTrue(convert.called)
        photo = self.photo()
        self.assertEqual((photo["width"], photo["height"]), (960, 1920))
        self.assertEqual((photo["thumbnail_width"], photo["thumbnail_height"]), (320, 640))
        for path in (self.root / "photos/images").glob("*.webp"):
            with Image.open(path) as image:
                self.assertEqual(dict(image.getexif()), {})
                self.assertFalse(any(field in image.info for field in ("icc_profile", "exif", "xmp")))
                self.assertNotIn(b"private", path.read_bytes())
        self.assertEqual(original, source.read_bytes())

    def test_small_images_are_never_upscaled(self):
        self.image(size=(100, 50))
        self.write()
        self.prepare()
        photo = self.photo()
        self.assertEqual((photo["width"], photo["height"]), (100, 50))
        self.assertEqual(photo["src"], photo["thumbnail"])
        self.assertEqual(len(list((self.root / "photos/images").glob("*.webp"))), 1)

    def test_repeat_is_noop_and_caption_edit_never_reencodes(self):
        self.image()
        self.write()
        self.prepare()
        before = self.snapshot()
        with patch.object(export_photos, "_srgb_pixels", side_effect=AssertionError("Do not decode unchanged source")):
            report = self.prepare()
        self.assertEqual(report["encoded_files"], 0)
        self.assertEqual(report["reused_files"], 2)
        self.assertEqual(before, self.snapshot())
        self.write("![[photo.jpg]]\n\n改过的说明。\n")
        with patch.object(export_photos, "_srgb_pixels", side_effect=AssertionError("A caption edit must reuse images")):
            self.prepare()
        after = self.snapshot()
        self.assertEqual(self.photo()["caption"], "改过的说明。")
        self.assertEqual({key: value for key, value in before.items() if key.endswith(".webp")},
                         {key: value for key, value in after.items() if key.endswith(".webp")})

    def test_stable_ids_survive_order_note_rename_attachment_rename_and_edit(self):
        source = self.image()
        self.image("two.jpg", size=(1100, 700))
        self.write("![[photo.jpg]]\n\nfirst\n\n![[two.jpg]]\n\nsecond\n")
        self.prepare()
        ids = {photo["caption"]: photo["id"] for photo in self.catalog()["albums"][0]["photos"]}
        self.write("![[two.jpg]]\n\nsecond\n\n![[photo.jpg]]\n\nfirst\n")
        renamed_note = self.note.with_name("新相册名.md")
        self.note.rename(renamed_note)
        self.note = renamed_note
        self.config["albums"][0]["note"] = self.note.name
        self.prepare()
        self.assertEqual(ids, {photo["caption"]: photo["id"] for photo in self.catalog()["albums"][0]["photos"]})
        source.rename(source.with_name("renamed.jpg"))
        self.write("![[two.jpg]]\n\nsecond\n\n![[renamed.jpg]]\n\nfirst\n")
        with patch.object(export_photos, "_srgb_pixels", side_effect=AssertionError("Renamed unchanged source must reuse")):
            self.prepare()
        self.assertEqual(ids, {photo["caption"]: photo["id"] for photo in self.catalog()["albums"][0]["photos"]})
        Image.new("RGB", (1600, 900), (180, 20, 80)).save(source.with_name("renamed.jpg"))
        self.prepare()
        self.assertEqual(ids, {photo["caption"]: photo["id"] for photo in self.catalog()["albums"][0]["photos"]})

    def test_relative_markdown_percent_paths_and_explicit_titles(self):
        self.image("space image.jpg")
        self.image("other.jpg", size=(1100, 700))
        self.write('---\ntitle: 显式相册名\ndescription: 相册说明\ndate: 2024-01-02\nlocation: 北京\nprivate_field: secret\n---\n'
                   '# Album heading\n\n![照片的alt](../附件/space%20image.jpg "显式标题")\n\n说明一\n\n'
                   '## 明确的小标题\n\n![[附件/other.jpg|640]]\n\n说明二\n')
        self.prepare()
        album = self.catalog()["albums"][0]
        self.assertEqual((album["title"], album["description"], album["date"], album["location"]),
                         ("显式相册名", "相册说明", "2024-01-02", "北京"))
        self.assertEqual([photo["title"] for photo in album["photos"]], ["显式标题", "明确的小标题"])
        self.assertNotIn("secret", json.dumps(album))

    def test_alias_is_explicit_title_and_empty_fields_stay_empty(self):
        self.image()
        self.write("![[photo.jpg|显示标题]]\n")
        self.prepare()
        photo = self.photo()
        self.assertEqual(photo["title"], "显示标题")
        for field in ("date", "date_text", "time", "location", "caption"):
            self.assertEqual(photo[field], "")

    def test_missing_ambiguous_remote_and_escape_fail_before_mutation(self):
        self.image()
        self.write()
        self.prepare()
        original = self.snapshot()
        self.image("sub/photo.jpg")
        for reference, message in (("missing.jpg", "Missing"), ("photo.jpg", "Ambiguous"),
                                   ("https://example.com/photo.jpg", "Only local"),
                                   ("../../outside.jpg", "escapes")):
            with self.subTest(reference=reference):
                self.write(f"![[{reference}]]\n")
                with self.assertRaisesRegex(ValueError, message):
                    self.prepare()
                self.assertEqual(original, self.snapshot())

    def test_relative_resolution_wins_over_unrelated_basename(self):
        self.image()
        local = self.albums / "photo.jpg"
        Image.new("RGB", (100, 75)).save(local)
        self.write()
        self.prepare()
        self.assertEqual(self.photo()["width"], 100)

    def test_all_documented_album_draft_markers_skip_even_broken_refs(self):
        for marker in ("draft: true", "public: false", "publish: false", "private: true", "status: draft",
                       "status: private", "status: 草稿", "status: 不公开", "tags: [摄影, 草稿]",
                       "tags:\n  - 摄影\n  - 不公开"):
            with self.subTest(marker=marker):
                self.write(f"---\n{marker}\n---\n![[private-missing.jpg]]\n")
                report = self.prepare()
                self.assertEqual(report["photos"], 0)
                self.assertEqual(self.catalog()["albums"], [])

    def test_photo_comments_override_and_draft_photos_never_resolve(self):
        self.image()
        self.write("![[missing.jpg]]\n<!-- photo: public=false -->\n\nprivate caption\n\n"
                   "![[photo.jpg]]\n\n<!-- photo: title=照片标题; date=2024年9月1日; time=8:06; location=明确地点 -->\n\n公开说明\n")
        self.prepare()
        photo = self.photo()
        self.assertEqual((photo["title"], photo["date"], photo["date_text"], photo["time"], photo["location"]),
                         ("照片标题", "2024-09-01", "2024年9月1日", "8:06", "明确地点"))
        self.assertEqual(photo["caption"], "公开说明")
        self.assertEqual(len(self.catalog()["albums"][0]["photos"]), 1)

    def test_code_comments_and_fences_are_not_image_references(self):
        self.image()
        self.write('```markdown\n![[fenced-missing.jpg]]\n```\n\n'
                   '<!-- ![[comment-missing.jpg]] -->\n\n'
                   '`![[inline-missing.jpg]]`\n\n'
                   '`multiline\n![[multiline-missing.jpg]]`\n\n![[photo.jpg]]\n\nreal caption\n')
        self.prepare()
        self.assertEqual(self.photo()["caption"], "real caption")
        self.assertEqual(len(self.catalog()["albums"][0]["photos"]), 1)

    def test_private_inline_and_multiline_comments_never_reach_public_text(self):
        self.image()
        self.write('---\ntitle: 北京<!-- secret title -->记忆\ndescription: 公开%% secret description %%介绍\n---\n'
                   '![[photo.jpg]]\n\n公开说明<!-- secret inline -->。\n'
                   '<!-- secret\n![[missing-hidden.jpg]]\nmore private -->\n'
                   '%% secret obsidian\n![[missing-obsidian.jpg]]\n%%\n继续公开说明。\n')
        self.prepare()
        catalog = self.catalog()
        text = json.dumps(catalog, ensure_ascii=False)
        self.assertNotIn('secret', text)
        self.assertNotIn('missing-', text)
        self.assertEqual(catalog['albums'][0]['title'], '北京记忆')
        self.assertIn('继续公开说明', self.photo()['caption'])

    def test_private_machine_paths_fail_before_output(self):
        self.image()
        self.write('![[photo.jpg]]\n\n说明 C:\\Users\\private\\secret.txt\n')
        with self.assertRaisesRegex(ValueError, 'local machine path'):
            self.prepare()
        self.assertFalse((self.root / 'photos').exists())

    def test_labelled_story_comments_keep_full_unicode_paragraphs_and_order(self):
        expected = []
        blocks = ['<!-- story:\n注释第一段，完整保留。\n\n注释第二段：北京 / KL。\n-->',
                  '<!-- 照片故事：\n注释第一段，完整保留。\n\n注释第二段：北京 / KL。\n-->',
                  '%% story:\n注释第一段，完整保留。\n\n注释第二段：北京 / KL。\n%%',
                  '%% 照片故事：\n注释第一段，完整保留。\n\n注释第二段：北京 / KL。\n%%']
        note = '<!-- story: 相册之前的注释不是照片故事 -->\n\n'
        for index, block in enumerate(blocks):
            self.image(f'story-{index}.jpg', size=(1200 + index, 800))
            before = f'普通前段 {index}：不概括、不截断。'
            after = f'普通后段 {index}，顺序也不变。'
            note += (f'![[story-{index}.jpg]]\n\n2024年9月1日，8:06，明确地点\n{before}\n\n'
                     f'{block}\n\n{after}\n\n<!-- 私人内部备注不能公开 -->\n\n')
            expected.append(before + '\n\n注释第一段，完整保留。\n\n注释第二段：北京 / KL。\n\n' + after)
        self.write(note)
        self.prepare()
        photos = self.catalog()['albums'][0]['photos']
        self.assertEqual([photo['caption'] for photo in photos], expected)
        self.assertTrue(all(photo['date'] == '2024-09-01' for photo in photos))
        self.assertNotIn('私人内部', json.dumps(self.catalog(), ensure_ascii=False))
        self.assertNotIn('相册之前', json.dumps(self.catalog(), ensure_ascii=False))

    def test_story_comments_do_not_become_album_metadata_or_cross_headings(self):
        self.image()
        self.write('---\ndescription: "<!-- story: 私人相册元数据 -->"\n---\n'
                   '![[photo.jpg]]\n\n完整故事。\n\n## 下一部分\n\n<!-- story: 不属于前一张照片 -->\n')
        self.prepare()
        self.assertEqual(self.photo()['caption'], '完整故事。')
        self.assertEqual(self.catalog()['albums'][0]['description'], '')
        self.assertNotIn('不属于', json.dumps(self.catalog(), ensure_ascii=False))

    def test_labelled_comment_examples_inside_code_are_not_stories(self):
        self.image()
        self.write('![[photo.jpg]]\n\n公开故事。\n\n```markdown\n<!-- story: 代码示例不是故事 -->\n```\n')
        self.prepare()
        self.assertEqual(self.photo()['caption'], '公开故事。')

    def test_single_line_story_comment_at_end_of_note_is_retained(self):
        self.image()
        for block in ('<!-- story: 最后一则完整故事。 -->', '<!-- 照片故事：最后一则完整故事。 -->',
                      '%% story: 最后一则完整故事。 %%', '%% 照片故事：最后一则完整故事。 %%'):
            with self.subTest(block=block):
                self.write('![[photo.jpg]]\n\n' + block)
                self.prepare()
                self.assertEqual(self.photo()['caption'], '最后一则完整故事。')

    def test_story_markdown_punctuation_is_preserved_as_literal_text(self):
        self.image()
        self.write('![[photo.jpg]]\n\n%% story: 走过 `街道`，记下 **原话** 与 ![[故事中的字面引用]]。 %%')
        self.prepare()
        self.assertEqual(self.photo()['caption'], '走过 `街道`，记下 **原话** 与 ![[故事中的字面引用]]。')

    def test_wiki_note_relative_parent_reference(self):
        self.image()
        self.write('![[../附件/photo.jpg]]\n\n相对路径说明\n')
        self.prepare()
        self.assertEqual(self.photo()['caption'], '相对路径说明')

    def test_duplicate_same_album_photo_and_reserved_ids_fail_before_output(self):
        self.image()
        self.write('![[photo.jpg]]\n\n![[photo.jpg]]\n')
        with self.assertRaisesRegex(ValueError, 'unique p-'):
            self.prepare()
        self.assertFalse((self.root / 'photos').exists())
        self.write()
        for identifier in ('images', '123album'):
            self.config['albums'][0]['id'] = identifier
            with self.assertRaisesRegex(ValueError, 'URL slug'):
                self.prepare()
        self.assertFalse((self.root / 'photos').exists())

    def test_invalid_icc_fails_without_public_mutation_or_source_change(self):
        source = self.image(icc_profile=b'invalid ICC private profile')
        self.write()
        original = source.read_bytes()
        with self.assertRaisesRegex(ValueError, 'ICC profile'):
            self.prepare()
        self.assertEqual(original, source.read_bytes())
        self.assertFalse((self.root / 'photos').exists())

    def test_output_link_safety_branch_without_symlink_privilege(self):
        self.image()
        self.write()
        is_link = export_photos._is_link
        with patch.object(export_photos, '_is_link', side_effect=lambda path: Path(path) == self.root / 'photos' or is_link(path)):
            with self.assertRaisesRegex(ValueError, 'link/junction'):
                self.prepare()
        self.assertFalse((self.root / 'photos').exists())

    def test_withdrawal_removes_only_registered_variants_and_keeps_id_history(self):
        self.image()
        self.write()
        self.prepare()
        identifier = self.photo()["id"]
        old_files = list((self.root / "photos/images").glob("*.webp"))
        self.write("No photo yet.\n")
        report = self.prepare()
        self.assertEqual(report["removed_files"], len(old_files))
        self.assertTrue(all(not path.exists() for path in old_files))
        self.assertTrue((self.root / "photos/images" / MARKER).is_file())
        self.write()
        self.prepare()
        self.assertEqual(self.photo()["id"], identifier)

    def test_unknown_file_is_protected_before_mutation(self):
        self.image()
        self.write()
        self.prepare()
        unknown = self.root / "photos/images/keep-my-photo.jpg"
        unknown.write_bytes(b"private untouched file")
        original = self.snapshot()
        self.write("No photos.\n")
        with self.assertRaisesRegex(ValueError, "unknown file"):
            self.prepare()
        self.assertEqual(original, self.snapshot())

    def test_unowned_cache_and_image_directories_are_rejected(self):
        self.image()
        self.write()
        (self.root / "photos/images").mkdir(parents=True)
        original = self.snapshot()
        with self.assertRaisesRegex(ValueError, "unowned"):
            self.prepare()
        self.assertEqual(original, self.snapshot())

    def test_corrupted_cache_ownership_cannot_delete_outside(self):
        self.image()
        self.write()
        self.prepare()
        outside = self.root / "keep.webp"
        outside.write_bytes(b"keep")
        cache = self.root / ".photo-cache/cache.json"
        value = json.loads(cache.read_text(encoding="utf-8"))
        value["owned_files"] = ["../../keep.webp"]
        cache.write_text(json.dumps(value), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "ownership"):
            self.prepare()
        self.assertEqual(outside.read_bytes(), b"keep")

    def test_symlink_source_and_output_are_rejected(self):
        source = self.image()
        self.write("![[alias.jpg]]\n")
        try:
            (self.albums / "alias.jpg").symlink_to(source)
        except (OSError, NotImplementedError):
            self.skipTest("Windows user lacks symlink permission")
        with self.assertRaisesRegex(ValueError, "link/junction"):
            self.prepare()
        self.assertFalse((self.root / "photos").exists())

    def test_config_paths_are_relative_to_config_not_cwd_and_runtime_stays_private(self):
        self.image()
        self.write()
        config = self.root / ".photos-local.json"
        value = {**self.config, "vault_root": "../private-vault", "album_root": "../private-vault/摄影集",
                 "runtime": {"python": "secret-local-python"}}
        config.write_text(json.dumps(value), encoding="utf-8")
        report = export(self.root, config)
        self.assertEqual(report["photos"], 1)
        self.assertNotIn("secret-local-python", (self.root / "photos/catalog.json").read_text(encoding="utf-8"))

    def test_ambiguous_metadata_fails_without_creating_output(self):
        self.image()
        for value in ("---\ndraft: maybe\n---\n![[photo.jpg]]", "---\ndescription: |\n  secret\n---\n![[photo.jpg]]",
                      "![[photo.jpg]]\n<!-- photo: pubic=false -->", "![[photo.jpg]] ![[photo.jpg]]"):
            with self.subTest(value=value):
                self.write(value)
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse((self.root / "photos").exists())


if __name__ == "__main__":
    unittest.main()
