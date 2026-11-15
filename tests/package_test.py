"""Regression checks for the deliberately small, standard-library packager."""
import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("package_merge", ROOT / "scripts/package_merge.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageTests(unittest.TestCase):
    def compile(self, source):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "config.js").write_text(source, encoding="utf-8")
            with patch.object(packager, "SOURCE", path):
                return packager.compile_module("config")

    def test_named_imports_and_exports(self):
        result = self.compile('import { Matter } from "./vendor.js";\nexport const value = 1;\nexport { value as alias };')
        self.assertIn('const { Matter } = modules["vendor"]', result)
        self.assertIn('return {alias: value, value}', result)

    def test_unsupported_syntax_and_dependency_order_fail(self):
        for source in ('import x from "./vendor.js";', 'export default 1;', 'import { x } from "./main.js";'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.compile(source)

    def test_embedded_defaults_match_sources_and_bytes(self):
        outputs = packager.outputs()
        data = outputs[packager.SOURCE / "offline-data.js"]
        embedded = json.loads(data.split("window.MergeOffline = ", 1)[1].removesuffix(";\n"))
        skin_path = ROOT / "config/merge/default.json"
        self.assertEqual(embedded["skin"], json.loads(skin_path.read_text(encoding="utf-8")))
        self.assertEqual(set(embedded["images"]), {item["image"] for item in embedded["skin"]["items"]})
        for name, uri in embedded["images"].items():
            self.assertEqual(base64.b64decode(uri.split(",", 1)[1]), (skin_path.parent / name).read_bytes())
        audio_source = (ROOT / "src/merge/audio.js").read_text(encoding="utf-8")
        self.assertEqual(len(embedded["audio"]), 3)
        for name, uri in embedded["audio"].items():
            self.assertIn('"' + name + '"', audio_source)
            self.assertEqual(base64.b64decode(uri.split(",", 1)[1]), (ROOT / name).read_bytes())
        for path, content in outputs.items():
            self.assertEqual(path.read_text(encoding="utf-8"), content, f"Stale build: {path.name}")


if __name__ == "__main__":
    unittest.main()
