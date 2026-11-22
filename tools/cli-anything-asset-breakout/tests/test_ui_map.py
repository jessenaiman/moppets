"""Unit tests for cli-anything-asset-breakout UI map and snapshot parser."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cli_anything.asset_breakout.cli import _chrome_download_dir, _find_gate_textboxes
from cli_anything.asset_breakout.session import AssetBreakoutSession
from cli_anything.asset_breakout.ui_map import ASPECT_OPTIONS, WORKBENCH_MODES

SAMPLE_SNAPSHOT = """
- banner
  - button "Mode A: Sprite Grid" [ref=e112]
  - button "Mode B: Cutout Parts" [ref=e113]
  - button "Copy Rig JSON" [ref=e116]
  - button "Download Rig JSON" [ref=e117]
- complementary
  - textbox [ref=e128]
  - textbox [ref=e130]
  - checkbox "Include editable layout hint" [checked=false, ref=e135]
  - combobox [expanded=false, ref=e131]: 1:1 (Square Sheet)
    - option "1:1 (Square Sheet)" [selected, ref=e136]
    - option "16:9 (Horizontal Sheet)" [ref=e137]
  - combobox [expanded=false, ref=e132]: 1 Output
    - option "1 Output" [selected, ref=e141]
    - option "2 Outputs" [ref=e142]
  - textbox "toasty" [ref=e133]
  - button "Complete All 3 Gate Inputs Above to Unlock Generate" [disabled, ref=e134]
"""


class UiMapTests(unittest.TestCase):
    def test_snapshot_parser_extracts_controls_and_gate_textboxes(self) -> None:
        drv = AssetBreakoutSession("flow-live")
        refs = drv.parse_snapshot_refs(SAMPLE_SNAPSHOT)
        gate = _find_gate_textboxes(refs)
        self.assertEqual(gate["context"], "@e128")
        self.assertEqual(gate["prompt"], "@e130")
        self.assertEqual(gate["slug"], "@e133")
        self.assertEqual(len(refs["comboboxes"]), 2)
        self.assertEqual(refs["checkboxes"][0][1], "@e135")
        self.assertEqual(WORKBENCH_MODES["cutout"], "Mode B: Cutout Parts")
        self.assertIn("1:1 (Square Sheet)", ASPECT_OPTIONS)

    def test_chrome_download_dir_prefers_configured_preferences(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dl = Path(tmp) / "magic-studio-assets"
            dl.mkdir()
            prefs = Path(tmp) / "Preferences"
            prefs.write_text(json.dumps({"download": {"default_directory": str(dl)}}), encoding="utf-8")
            self.assertEqual(_chrome_download_dir((prefs,)), dl)


if __name__ == "__main__":
    unittest.main()
