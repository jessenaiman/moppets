"""Safe agent-browser session driver for Asset Breakout (never closes session or calls --auto-connect)."""
from __future__ import annotations

import json
import re
import subprocess
from contextlib import contextmanager
from typing import Any


class BrowserError(RuntimeError):
    """Raised when an agent-browser command fails."""


class AssetBreakoutSession:
    """Thin stateful wrapper around `agent-browser --session <name>`."""

    def __init__(self, session: str = "flow-live") -> None:
        self.session = session

    def run(self, *args: str, check: bool = True) -> str:
        cmd = ["agent-browser", "--session", self.session, *args]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        out = (proc.stdout or "") + (f"\n{proc.stderr}" if proc.stderr else "")
        if check and proc.returncode != 0:
            raise BrowserError(f"Command {' '.join(cmd)} failed ({proc.returncode}): {out.strip()}")
        return proc.stdout

    def ensure_main_frame(self) -> None:
        self.run("frame", "main", check=False)

    def main_snapshot(self, interactive: bool = True) -> str:
        self.ensure_main_frame()
        return self.run("snapshot", "-i") if interactive else self.run("snapshot")

    def find_iframe_ref(self) -> str:
        snap = self.main_snapshot(interactive=True)
        m = re.search(r"- Iframe \[ref=(e\d+)\]", snap)
        if not m:
            # Try scanning a few seconds after switching to Tool mode
            self.run("wait", "800")
            snap = self.main_snapshot(interactive=True)
            m = re.search(r"- Iframe \[ref=(e\d+)\]", snap)
        if not m:
            raise BrowserError("Could not locate workbench Iframe ref in main snapshot")
        return f"@{m.group(1)}"

    @contextmanager
    def in_iframe(self):
        ref = self.find_iframe_ref()
        self.run("frame", ref)
        try:
            yield ref
        finally:
            self.ensure_main_frame()

    def eval_json(self, js_expr: str) -> Any:
        raw = self.run("eval", js_expr).strip()
        try:
            first = json.loads(raw)
            if isinstance(first, str):
                return json.loads(first)
            return first
        except json.JSONDecodeError:
            return raw

    def parse_snapshot_refs(self, snap: str) -> dict[str, Any]:
        """Extract exact role refs inside the active frame snapshot."""
        buttons: list[tuple[str, str, bool]] = []
        textboxes: list[tuple[str, str, str]] = []
        comboboxes: list[tuple[str, str, list[tuple[str, str]]]] = []
        checkboxes: list[tuple[str, str, bool]] = []

        lines = snap.splitlines()
        for i, line in enumerate(lines):
            mb = re.search(r'- button "([^"]*)"([^\n]*)', line)
            if mb:
                ref_m = re.search(r"ref=(e\d+)", line)
                if ref_m:
                    buttons.append((mb.group(1), f"@{ref_m.group(1)}", "disabled" in line))
                continue
            mt = re.search(r'- textbox(?: "([^"]*)")?([^\n]*)', line)
            if mt:
                ref_m = re.search(r"ref=(e\d+)", line)
                if ref_m:
                    val = line.split(":", 1)[1].strip() if ":" in line else ""
                    textboxes.append((mt.group(1) or "", f"@{ref_m.group(1)}", val))
                continue
            mc = re.search(r"- checkbox \"([^\"]*)\"([^\n]*)", line)
            if mc:
                ref_m = re.search(r"ref=(e\d+)", line)
                if ref_m:
                    checkboxes.append((mc.group(1), f"@{ref_m.group(1)}", "checked=true" in line))
                continue
            mcb = re.search(r"- combobox([^\n]*)", line)
            if mcb:
                ref_m = re.search(r"ref=(e\d+)", line)
                if ref_m:
                    label_val = line.split(":", 1)[1].strip() if ":" in line else ""
                    opts: list[tuple[str, str]] = []
                    for j in range(i + 1, min(len(lines), i + 40)):
                        if re.match(r"^\s*-\s+(?:combobox|textbox|button|checkbox|LabelText|StaticText|separator)", lines[j]):
                            break
                        mo = re.search(r'- option "([^"]*)"([^\n]*)', lines[j])
                        if mo:
                            or_m = re.search(r"ref=(e\d+)", lines[j])
                            if or_m:
                                opts.append((mo.group(1), f"@{or_m.group(1)}"))
                    comboboxes.append((label_val, f"@{ref_m.group(1)}", opts))

        return {
            "buttons": buttons,
            "textboxes": textboxes,
            "comboboxes": comboboxes,
            "checkboxes": checkboxes,
        }
