"""Verify the offline game contains exactly the editable JSON sources."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("package_turing", ROOT / "scripts/package_turing.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class TuringPackageTests(unittest.TestCase):
    def test_offline_bank_and_config_are_current(self):
        content = packager.content()
        self.assertEqual(packager.OUTPUT.read_text(encoding="utf-8"), content)
        data = json.loads(content.split("window.TuringData = ", 1)[1].removesuffix(";\n"))
        self.assertEqual(data["config"], json.loads((ROOT / "config/turing/default.json").read_text(encoding="utf-8")))
        self.assertEqual(data["scenarios"], json.loads((ROOT / "assets/turing/scenarios.json").read_text(encoding="utf-8")))
        self.assertEqual(len(data["scenarios"]), 50)
        self.assertTrue(all(set(s["responses"]) == {"gpt", "deepseek", "doubao"} for s in data["scenarios"]))
