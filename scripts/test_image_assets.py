"""Meaningful local checks for image derivatives and cache ownership."""

from hashlib import sha256
import json
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import quote

from PIL import Image, ImageCms

import image_assets
from image_assets import MANIFEST, MARKER, MARKER_TEXT, MIN_SOURCE_BYTES, ResponsiveImages


class ResponsiveImageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / "source"
        self.output = self.directory / "build"
        (self.root / "images").mkdir(parents=True)
        (self.root / "附属资料").mkdir()

    def source(self, name="测试 图.png", size=(2200, 1200), mode="RGB", **kwargs):
        path = self.root / "images" / name
        Image.new(mode, size, (55, 120, 180, 50) if mode == "RGBA" else (55, 120, 180)).save(path, **kwargs)
        return path

    def prepare(self):
        generator = ResponsiveImages(self.root, self.output, "/articles/")
        with patch.object(image_assets, "MIN_SOURCE_BYTES", 1):
            generator.prepare()
        return generator

    def test_default_threshold_preserves_small_images_and_original_bytes(self):
        source = self.source()
        before = source.read_bytes()
        self.assertLess(source.stat().st_size, MIN_SOURCE_BYTES)
        generator = ResponsiveImages(self.root, self.output, "/articles/")
        report = generator.prepare()
        self.assertEqual(report["source_count"], 0)
        self.assertEqual(report["derivative_files"], 0)
        self.assertEqual(generator.attributes("/articles/images/测试%20图.png"), {})
        self.assertEqual(source.read_bytes(), before)

    def test_only_jpg_png_eligible_and_derivatives_keep_source_unchanged(self):
        source = self.source()
        self.source("small.png", size=(1, 1))
        self.source("photo.webp", size=(2200, 1200))
        self.source("motion.gif", size=(100, 100))
        (self.root / "images" / "ignored.txt").write_text("not an image", encoding="utf-8")
        before = {path.name: sha256(path.read_bytes()).hexdigest() for path in (self.root / "images").iterdir()}
        threshold = (self.root / "images" / "small.png").stat().st_size
        generator = ResponsiveImages(self.root, self.output, "/articles/")
        with patch.object(image_assets, "MIN_SOURCE_BYTES", threshold):
            report = generator.prepare()
        self.assertEqual(report["source_count"], 1)
        self.assertEqual(report["derivative_files"], 2)
        self.assertEqual(report["source_bytes"], source.stat().st_size)
        self.assertEqual(before, {path.name: sha256(path.read_bytes()).hexdigest() for path in (self.root / "images").iterdir()})
        self.assertTrue(all(path.suffix == ".webp" for path in generator.directory.glob("*.webp")))

    def test_chinese_spaces_base_prefix_and_remote_urls(self):
        self.source()
        generator = self.prepare()
        url = "/articles/images/" + quote("测试 图.png")
        attrs = generator.attributes(url)
        self.assertEqual(attrs["data-original-src"], url)
        self.assertEqual(attrs["data-original-width"], "2200")
        self.assertEqual(attrs["width"], "960")
        self.assertIn(" 960w", attrs["srcset"])
        self.assertIn(" 1920w", attrs["srcset"])
        for remote in ("https://example.com" + url, "//example.com" + url,
                       "/different/images/测试%20图.png", "/articles/images/../测试%20图.png",
                       "/articles/%2e%2e/images/测试%20图.png", "/articles/images\\测试 图.png"):
            self.assertEqual(generator.attributes(remote), {}, remote)
        self.assertEqual(generator.attributes(url + "?v=1#example")["data-original-src"], url + "?v=1#example")

    def test_cache_reused_without_derivative_byte_or_mtime_changes(self):
        self.source()
        first = self.prepare()
        state = {path.name: (path.read_bytes(), path.stat().st_mtime_ns)
                 for path in first.directory.glob("*.webp")}
        with patch.object(image_assets, "_srgb_pixels", side_effect=AssertionError("A valid cache must not decode or recolor pixels.")):
            second = self.prepare()
        self.assertEqual(second.report()["cache_reused_files"], 2)
        self.assertEqual(state, {path.name: (path.read_bytes(), path.stat().st_mtime_ns)
                                 for path in second.directory.glob("*.webp")})
        self.assertEqual(first.report()["derivative_bytes"], second.report()["derivative_bytes"])

    def test_corrupted_owned_derivative_is_regenerated(self):
        self.source()
        first = self.prepare()
        derivative = next(first.directory.glob("*.webp"))
        expected = derivative.read_bytes()
        derivative.write_bytes(b"corrupted cache")
        second = self.prepare()
        self.assertEqual(derivative.read_bytes(), expected)
        self.assertEqual(second.report()["cache_reused_files"], 1)

    def test_source_change_expires_only_previously_owned_variants(self):
        source = self.source()
        first = self.prepare()
        old_files = set(first.directory.glob("*.webp"))
        Image.new("RGB", (2200, 1200), (200, 20, 80)).save(source)
        self.prepare()
        new_files = set(first.directory.glob("*.webp"))
        self.assertEqual(len(new_files), 2)
        self.assertTrue(old_files.isdisjoint(new_files))
        self.assertTrue(all(not path.exists() for path in old_files))
        source.unlink()
        empty = self.prepare()
        self.assertEqual(empty.report()["source_count"], 0)
        self.assertEqual(list(first.directory.glob("*.webp")), [])
        self.assertTrue((first.directory / MARKER).is_file())

    def test_unknown_file_is_protected_before_any_cleanup(self):
        source = self.source()
        first = self.prepare()
        expected = {path.name: path.read_bytes() for path in first.directory.glob("*.webp")}
        unknown = first.directory / "keep-my-photo.jpg"
        unknown.write_bytes(b"must not be removed")
        source.unlink()
        with self.assertRaisesRegex(ValueError, "unknown file"):
            self.prepare()
        self.assertEqual(unknown.read_bytes(), b"must not be removed")
        self.assertEqual(expected, {path.name: path.read_bytes() for path in first.directory.glob("*.webp")})

    def test_missing_owner_marker_refuses_existing_directory(self):
        directory = self.output / "assets" / "responsive-images"
        directory.mkdir(parents=True)
        (directory / "important.txt").write_text("preserve", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "unowned"):
            self.prepare()
        self.assertEqual((directory / "important.txt").read_text(encoding="utf-8"), "preserve")

    def test_invalid_manifest_cannot_delete_paths_outside_cache(self):
        first = self.prepare()
        outside = self.directory / "preserve.webp"
        outside.write_bytes(b"outside data")
        manifest_path = first.directory / MANIFEST
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["owned_files"] = ["../../../preserve.webp"]
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "ownership records"):
            self.prepare()
        self.assertEqual(outside.read_bytes(), b"outside data")

    def test_output_inside_source_asset_directory_is_rejected(self):
        self.source()
        generator = ResponsiveImages(self.root, self.root, "/articles/")
        with self.assertRaisesRegex(ValueError, "source directory"):
            generator.prepare()
        self.assertFalse((self.root / "assets").exists())

    def test_linked_output_is_rejected_without_touching_target(self):
        outside = self.directory / "outside"
        outside.mkdir()
        (outside / "preserve.txt").write_text("outside", encoding="utf-8")
        self.output.mkdir()
        try:
            (self.output / "assets").symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("This Windows account cannot create test symlinks.")
        with self.assertRaisesRegex(ValueError, "link/junction|escapes"):
            self.prepare()
        self.assertEqual(list(outside.iterdir()), [outside / "preserve.txt"])

    def test_palette_transparency_survives_and_metadata_is_removed(self):
        path = self.root / "images" / "transparent.png"
        original = Image.new("P", (2000, 1000), color=0)
        original.putpalette([0, 0, 0, 200, 20, 80] + [0] * 762)
        original.putpixel((1000, 500), 1)
        original.save(path, transparency=0)
        generator = self.prepare()
        for derivative in generator.directory.glob("*.webp"):
            with Image.open(derivative) as image:
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(image.getpixel((0, 0))[3], 0)
                self.assertFalse(image.getexif())
                self.assertNotIn("icc_profile", image.info)

    def test_exif_orientation_is_applied_before_sizing_without_source_changes(self):
        original = Image.new("RGB", (2000, 1000), (55, 120, 180))
        exif = Image.Exif()
        exif[274] = 6
        exif[270] = "metadata must be removed"
        source = self.root / "images" / "rotated.jpg"
        original.save(source, exif=exif)
        before = source.read_bytes()
        generator = self.prepare()
        attrs = generator.attributes("/articles/images/rotated.jpg")
        self.assertEqual((attrs["data-original-width"], attrs["data-original-height"]), ("1000", "2000"))
        self.assertEqual((attrs["width"], attrs["height"]), ("960", "1920"))
        for derivative in generator.directory.glob("*.webp"):
            with Image.open(derivative) as image:
                self.assertLessEqual(image.width, 1000)
                self.assertLessEqual(image.height, 2000)
                self.assertFalse(image.getexif())
        self.assertEqual(source.read_bytes(), before)

    def test_no_upscale_or_duplicate_width_candidate(self):
        self.source(size=(300, 200))
        generator = self.prepare()
        attrs = generator.attributes("/articles/images/" + quote("测试 图.png"))
        self.assertEqual((attrs["width"], attrs["height"]), ("300", "200"))
        self.assertEqual(generator.report()["derivative_files"], 1)
        self.assertEqual(len(attrs["srcset"].split(",")), 1)
        second = self.prepare()
        self.assertEqual(second.report()["cache_reused_files"], 1)

    def test_animated_png_is_not_flattened(self):
        path = self.root / "images" / "animated.png"
        frames = [Image.new("RGBA", (100, 100), color) for color in ((255, 0, 0, 255), (0, 255, 0, 255))]
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=100, loop=0)
        before = path.read_bytes()
        generator = self.prepare()
        self.assertEqual(generator.report()["source_count"], 0)
        self.assertEqual(path.read_bytes(), before)

    def test_missing_pillow_has_actionable_installation_message(self):
        with patch.object(image_assets, "Image", None):
            with self.assertRaisesRegex(RuntimeError, "pip install -r blog/requirements.txt"):
                ResponsiveImages(self.root, self.output, "/articles/").prepare()
        self.assertFalse(self.output.exists())

    def test_bad_url_prefix_is_rejected(self):
        for prefix in ("https://example.com/articles/", "//example.com/", "articles/", "/articles/../", "/articles/?bad=1"):
            with self.assertRaises(ValueError):
                ResponsiveImages(self.root, self.output, prefix)

    def test_windows_reparse_point_is_rejected_without_path_is_junction(self):
        self.output.mkdir()
        assets = self.output / "assets"
        assets.mkdir()
        actual_lstat = Path.lstat

        def reparse_stat(path, *args, **kwargs):
            attributes = actual_lstat(path, *args, **kwargs)
            if path == assets:
                return SimpleNamespace(st_mode=attributes.st_mode,
                                       st_file_attributes=getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
            return attributes

        with patch.object(Path, "lstat", reparse_stat):
            with self.assertRaisesRegex(ValueError, "link/junction"):
                self.prepare()
        self.assertEqual(list(assets.iterdir()), [])

    def test_nonexistent_path_is_not_a_link(self):
        self.assertFalse(image_assets._is_link(self.directory / "not-created"))

    def test_lab_profile_is_converted_to_rgb_before_metadata_removal(self):
        image = Image.new("LAB", (4, 4), (128, 128, 128))
        image.info["icc_profile"] = ImageCms.ImageCmsProfile(ImageCms.createProfile("LAB")).tobytes()
        image.info["private-comment"] = "remove metadata"
        converted = image_assets._srgb_pixels(image)
        self.assertEqual(converted.mode, "RGB")
        pixel = converted.getpixel((0, 0))
        self.assertLessEqual(max(pixel) - min(pixel), 2)
        self.assertTrue(100 < pixel[0] < 140, "A neutral LAB midpoint must become a neutral sRGB gray.")
        self.assertEqual(converted.info, {})
        self.assertIn("icc_profile", image.info, "The input object itself is unchanged.")

    def test_tagged_rgba_keeps_alpha_after_srgb_conversion(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        self.source("tagged.png", size=(1800, 1000), mode="RGBA", icc_profile=profile)
        generator = self.prepare()
        for path in generator.directory.glob("*.webp"):
            with Image.open(path) as image:
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(image.getpixel((0, 0))[3], 50)
                self.assertNotIn("icc_profile", image.info)

    def test_tagged_image_without_cms_fails_instead_of_losing_its_profile(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        source = self.source("tagged.png", icc_profile=profile)
        before = source.read_bytes()
        with patch.object(image_assets, "ImageCms", None):
            with self.assertRaisesRegex(RuntimeError, "littlecms2/ImageCms"):
                self.prepare()
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(list((self.output / "assets" / "responsive-images").glob("*.webp")), [])

    def test_invalid_icc_fails_before_writing_derivatives(self):
        source = self.source("broken-profile.png", icc_profile=b"not a valid ICC profile")
        before = source.read_bytes()
        with self.assertRaisesRegex(ValueError, "ICC profile"):
            self.prepare()
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(list((self.output / "assets" / "responsive-images").glob("*.webp")), [])


if __name__ == "__main__":
    unittest.main()
