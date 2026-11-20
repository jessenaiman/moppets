"""Verified UI map for Google Flow Asset Breakout."""
from __future__ import annotations

DEFAULT_SESSION = "flow-live"

MAIN_MODES = {
    "tool": 'role=radio[name="Tool"]',
    "edit": 'role=radio[name="Edit"]',
}

WORKBENCH_MODES = {
    "sprite": "Mode A: Sprite Grid",
    "cutout": "Mode B: Cutout Parts",
    "rig": "Mode C: Pin & Bone Rig",
    "turnaround": "Mode D: Turnaround Sheet",
}

CUTOUT_PARTS = [
    "Head",
    "Torso",
    "Upper Arm (L)",
    "Fore Arm (L)",
    "Wing (L)",
    "Wing (R)",
    "Leg (L)",
    "Leg (R)",
    "Prop / Weapon",
]

RIG_NODE_TYPES = [
    "Starch Pin",
    "Deform Pin",
    "Follow Pin",
    "Bone Joint",
]

ASPECT_OPTIONS = [
    "1:1 (Square Sheet)",
    "16:9 (Horizontal Sheet)",
    "9:16 (Tall Turnaround)",
    "4:3 (Classic Panel)",
    "3:4 (Portrait Breakout)",
]

SELECTORS = {
    "storyboard_file": 'input[type="file"][accept*=".xml"]',
    "reference_files": 'input[type="file"][accept*="image"]',
    "copy_rig_json": "Copy Rig JSON",
    "download_rig_json": "Download Rig JSON",
    "flow_gallery": "Flow Media Gallery",
    "layout_hint_checkbox": "Include editable layout hint",
    "locked_generate_prefix": "Complete All 3 Gate Inputs",
}


def as_dict() -> dict:
    return {
        "session": DEFAULT_SESSION,
        "main_modes": MAIN_MODES,
        "workbench_modes": WORKBENCH_MODES,
        "cutout_parts": CUTOUT_PARTS,
        "rig_node_types": RIG_NODE_TYPES,
        "aspect_options": ASPECT_OPTIONS,
        "selectors": SELECTORS,
    }
