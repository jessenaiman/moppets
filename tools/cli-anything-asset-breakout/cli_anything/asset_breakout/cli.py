"""CLI entrypoint for `cli-anything-asset-breakout`."""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from .session import AssetBreakoutSession, BrowserError
from .ui_map import ASPECT_OPTIONS, DEFAULT_SESSION, SELECTORS, WORKBENCH_MODES, as_dict


def _read_iframe_status(drv: AssetBreakoutSession) -> dict[str, Any]:
    snap = drv.run("snapshot")
    refs = drv.parse_snapshot_refs(snap)
    mode_m = re.search(r'strong\s*\n\s*- StaticText "([^"]+)"', snap)
    gate_m = re.search(r'(LOCKED \([^)]+\)|UNLOCKED[^"\n]*|READY[^"\n]*)', snap)
    ref_count_m = re.search(r'- StaticText "(\d+)"\s*\n\s*- StaticText " of 4 selected"', snap)
    tray_m = re.search(r'Iterative Re-Seed Tray \(\s*"?\s*\n\s*- StaticText "(\d+)"', snap)
    if not tray_m:
        # fallback plain regex
        tray_m2 = re.search(r"Iterative Re-Seed Tray\s*\(\s*\n\s*-\s*StaticText\s*\"(\d+)\"", snap)
        tray_count = int(tray_m2.group(1)) if tray_m2 else 0
    else:
        tray_count = int(tray_m.group(1))

    dom_info = drv.eval_json(
        """JSON.stringify({
            selects: [...document.querySelectorAll('select')].map((s, i) => ({
                index: i,
                value: s.value,
                options: [...s.options].map(o => ({value: o.value, text: o.text}))
            })),
            textareas: [...document.querySelectorAll('textarea')].map((t, i) => ({index: i, len: t.value.length})),
            trayCards: document.querySelectorAll('img').length,
            buttons: [...document.querySelectorAll('button')].map(b => ({text: b.innerText.replace(/\\s+/g,' ').trim(), disabled: b.disabled}))
        })"""
    )
    return {
        "mode": mode_m.group(1) if mode_m else None,
        "gate": gate_m.group(1) if gate_m else "unknown",
        "references_selected": int(ref_count_m.group(1)) if ref_count_m else 0,
        "tray_count": tray_count,
        "textboxes": [{"hint": t[0], "ref": t[1], "value_preview": t[2]} for t in refs["textboxes"]],
        "comboboxes": [{"value": c[0], "ref": c[1], "options": [o[0] for o in c[2]]} for c in refs["comboboxes"]],
        "dom": dom_info,
    }


def _find_gate_textboxes(refs: dict[str, Any]) -> dict[str, str]:
    """Identify context textarea (`01`), prompt textarea (`03`), and slug input (`toasty`/last textbox)."""
    tbs = refs["textboxes"]
    if len(tbs) < 2:
        raise BrowserError(f"Expected >= 2 textboxes in Gate, found {tbs}")
    slug_ref = None
    others: list[tuple[str, str, str]] = []
    for hint, ref, val in tbs:
        if hint == "toasty" or (hint == "" and len(tbs) >= 3 and ref == tbs[-1][1]):
            slug_ref = ref
        else:
            others.append((hint, ref, val))
    if slug_ref is None and len(tbs) >= 3:
        slug_ref = tbs[-1][1]
        others = tbs[:-1]
    out: dict[str, str] = {"context": others[0][1], "prompt": others[-1][1]}
    if slug_ref:
        out["slug"] = slug_ref
    return out


def cmd_map(_args: argparse.Namespace) -> dict[str, Any]:
    return as_dict()


def cmd_status(args: argparse.Namespace) -> dict[str, Any]:
    drv = AssetBreakoutSession(args.session)
    main_snap = drv.main_snapshot(interactive=True)
    tool_m = re.search(r'- radio "Tool" \[checked=(true|false), ref=(e\d+)\]', main_snap)
    iframe_m = re.search(r'- Iframe \[ref=(e\d+)\]', main_snap)
    url = drv.run("get", "url").strip()
    with drv.in_iframe():
        iframe_state = _read_iframe_status(drv)
    return {
        "session": args.session,
        "url": url,
        "tool_mode": tool_m.group(1) == "true" if tool_m else None,
        "iframe_ref": iframe_m.group(1) if iframe_m else None,
        "iframe": iframe_state,
    }


def cmd_tool_mode(args: argparse.Namespace) -> dict[str, Any]:
    drv = AssetBreakoutSession(args.session)
    snap = drv.main_snapshot(interactive=True)
    m = re.search(r'- radio "Tool" \[checked=(true|false), ref=(e\d+)\]', snap)
    if not m:
        raise BrowserError("Tool mode radio button not found in main page snapshot")
    if m.group(1) != "true":
        drv.run("click", f"@{m.group(2)}")
        drv.run("wait", "800")
    snap2 = drv.main_snapshot(interactive=True)
    m2 = re.search(r'- radio "Tool" \[checked=(true|false), ref=(e\d+)\]', snap2)
    return {"tool_mode": m2.group(1) == "true" if m2 else False}


def cmd_mode(args: argparse.Namespace) -> dict[str, Any]:
    label = WORKBENCH_MODES[args.target]
    drv = AssetBreakoutSession(args.session)
    with drv.in_iframe():
        snap = drv.run("snapshot", "-i")
        refs = drv.parse_snapshot_refs(snap)
        match = next((b for b in refs["buttons"] if b[0] == label), None)
        if not match:
            raise BrowserError(f"Mode button '{label}' not found inside iframe")
        drv.run("click", match[1])
        drv.run("wait", "300")
        return {"mode": label}


def cmd_import_storyboard(args: argparse.Namespace) -> dict[str, Any]:
    path = Path(args.file).expanduser().resolve()
    if not path.is_file():
        raise BrowserError(f"Storyboard file not found: {path}")
    drv = AssetBreakoutSession(args.session)
    with drv.in_iframe():
        drv.run("upload", SELECTORS["storyboard_file"], str(path))
        drv.run("wait", "800")
        info = drv.eval_json(
            """JSON.stringify({
                selects: [...document.querySelectorAll('select')].map((s, i) => ({
                    index: i,
                    value: s.value,
                    options: [...s.options].map(o => ({value: o.value, text: o.text}))
                }))
            })"""
        )
        selected_page = None
        if args.page:
            snap = drv.run("snapshot")
            refs = drv.parse_snapshot_refs(snap)
            # Find any combobox whose options aren't Aspect Ratio or Output Count
            for val, cb_ref, opts in refs["comboboxes"]:
                opt_texts = [o[0] for o in opts]
                if any(o in opt_texts for o in ASPECT_OPTIONS) or "1 Output" in opt_texts:
                    continue
                target_opt = next((o for o in opts if args.page.lower() in o[0].lower()), None)
                if target_opt:
                    drv.run("select", cb_ref, target_opt[0])
                    drv.run("wait", "500")
                    selected_page = target_opt[0]
                    break
        state = _read_iframe_status(drv)
        state["selected_page"] = selected_page
        state["selects_after_upload"] = info.get("selects") if isinstance(info, dict) else info
        return state


def cmd_upload_refs(args: argparse.Namespace) -> dict[str, Any]:
    files = [str(Path(f).expanduser().resolve()) for f in args.files]
    for f in files:
        if not Path(f).is_file():
            raise BrowserError(f"Reference image not found: {f}")
    if len(files) > 4:
        raise BrowserError("Asset Breakout allows at most 4 reference images")
    drv = AssetBreakoutSession(args.session)
    with drv.in_iframe():
        drv.run("upload", SELECTORS["reference_files"], *files)
        drv.run("wait", "800")
        return _read_iframe_status(drv)


def cmd_set_inputs(args: argparse.Namespace) -> dict[str, Any]:
    drv = AssetBreakoutSession(args.session)
    with drv.in_iframe():
        snap = drv.run("snapshot")
        refs = drv.parse_snapshot_refs(snap)
        gate_tb = _find_gate_textboxes(refs)

        if args.context is not None:
            drv.run("fill", gate_tb["context"], "--", args.context)
        if args.prompt is not None:
            drv.run("fill", gate_tb["prompt"], "--", args.prompt)
        if args.slug is not None:
            if "slug" not in gate_tb:
                raise BrowserError("Character Slug input ref not found")
            drv.run("fill", gate_tb["slug"], "--", args.slug)

        if args.aspect is not None:
            cb = next((c for c in refs["comboboxes"] if any("Square Sheet" in o[0] for o in c[2])), None)
            if not cb:
                raise BrowserError("Aspect Ratio combobox not found")
            drv.run("select", cb[1], args.aspect)

        if args.outputs is not None:
            cb = next((c for c in refs["comboboxes"] if any("1 Output" in o[0] for o in c[2])), None)
            if not cb:
                raise BrowserError("Output Count combobox not found")
            label = "1 Output" if args.outputs == 1 else f"{args.outputs} Outputs"
            drv.run("select", cb[1], label)

        if args.layout_hint is not None:
            chk = next((c for c in refs["checkboxes"] if "layout hint" in c[0].lower()), None)
            if not chk:
                raise BrowserError("Include editable layout hint checkbox not found")
            drv.run("check" if args.layout_hint == "on" else "uncheck", chk[1])

        drv.run("wait", "400")
        return _read_iframe_status(drv)


def cmd_generate(args: argparse.Namespace) -> dict[str, Any]:
    drv = AssetBreakoutSession(args.session)
    with drv.in_iframe():
        before = _read_iframe_status(drv)
        snap = drv.run("snapshot")
        refs = drv.parse_snapshot_refs(snap)
        gen_btn = next(
            (
                b
                for b in refs["buttons"]
                if "generate" in b[0].lower() and "unlocked" not in b[0].lower()
            ),
            None,
        )
        # Button label may say "Generate..." or "Run..." — exclude known non-generate buttons
        if not gen_btn:
            known = {
                *WORKBENCH_MODES.values(),
                "Copy Rig JSON",
                "Download Rig JSON",
                "6 fps",
                "12 fps",
                "24 fps",
                "Play Sprite Loop",
                "Flow Media Gallery",
                "Reset Defaults",
                "Drop New Bone Joint",
            }
            for b in reversed(refs["buttons"]):
                if b[0] and b[0] not in known and not b[0].startswith("Place ") and not b[0].startswith("Complete All"):
                    gen_btn = b
                    break
        if not gen_btn:
            raise BrowserError(f"Generate button not found in buttons: {refs['buttons']}")
        if gen_btn[2]:
            raise BrowserError(f"Generate button '{gen_btn[0]}' is still disabled (check 3/3 gate inputs)")

        drv.run("scrollintoview", gen_btn[1])
        drv.run("click", gen_btn[1])
        deadline = time.monotonic() + args.wait
        before_tray = before["tray_count"]
        before_imgs = before["dom"].get("trayCards", 0) if isinstance(before.get("dom"), dict) else 0
        latest = before
        while time.monotonic() < deadline:
            time.sleep(5)
            latest = _read_iframe_status(drv)
            cur_tray = latest["tray_count"]
            cur_imgs = latest["dom"].get("trayCards", 0) if isinstance(latest.get("dom"), dict) else 0
            cur_btns = latest["dom"].get("buttons", []) if isinstance(latest.get("dom"), dict) else []
            still_busy = any("generat" in (b.get("text", "").lower()) and b.get("disabled") for b in cur_btns)
            if (cur_tray > before_tray or cur_imgs > before_imgs) and not still_busy:
                latest["generated"] = True
                return latest
        latest["generated"] = False
        latest["timed_out"] = True
        return latest


def _chrome_download_dir(prefs_paths: tuple[Path, ...] | None = None) -> Path:
    candidates = prefs_paths or (
        Path.home() / ".config" / "google-chrome" / "Default" / "Preferences",
        Path.home() / ".config" / "chromium" / "Default" / "Preferences",
    )
    for prefs in candidates:
        try:
            if prefs.exists():
                data = json.loads(prefs.read_text(encoding="utf-8"))
                dl = data.get("download", {}).get("default_directory")
                if dl:
                    p = Path(dl).expanduser()
                    if p.exists():
                        return p
        except Exception:
            pass
    magic_assets = Path("/run/media/jesse/Speedy/magic-studio-assets")
    if magic_assets.exists():
        return magic_assets
    return Path.home() / "Downloads"


def _latest_download(before: set[str], exts: str | tuple[str, ...], timeout: float = 10.0, dl_dir: Path | None = None) -> Path | None:
    target_dir = dl_dir or _chrome_download_dir()
    suffixes = (exts.lower(),) if isinstance(exts, str) else tuple(e.lower() for e in exts)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if target_dir.exists():
            cur = {p.name for p in target_dir.iterdir() if not p.name.endswith(".crdownload")}
            added = [target_dir / n for n in cur - before if any(n.lower().endswith(s) for s in suffixes)]
            if added:
                added.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                return added[0]
        time.sleep(0.35)
    return None


def cmd_download_rig(args: argparse.Namespace) -> dict[str, Any]:
    import shutil

    out_path = Path(args.out).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    drv = AssetBreakoutSession(args.session)
    dl_dir = _chrome_download_dir()
    before = {p.name for p in dl_dir.iterdir()} if dl_dir.exists() else set()
    with drv.in_iframe():
        snap = drv.run("snapshot", "-i")
        refs = drv.parse_snapshot_refs(snap)
        btn = next((b for b in refs["buttons"] if b[0] == SELECTORS["download_rig_json"]), None)
        if not btn:
            raise BrowserError("Download Rig JSON button not found")
        drv.run("click", btn[1])
    found = _latest_download(before, ".json", timeout=8.0, dl_dir=dl_dir)
    if found and found.exists():
        shutil.copy2(found, out_path)
        return {"downloaded": str(out_path), "bytes": out_path.stat().st_size, "source": str(found), "download_dir": str(dl_dir)}
    raise BrowserError(f"Timed out waiting for Rig JSON download in {dl_dir}")


def cmd_download_tray(args: argparse.Namespace) -> dict[str, Any]:
    import base64
    import shutil

    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    drv = AssetBreakoutSession(args.session)
    dl_dir = _chrome_download_dir()
    downloaded: list[dict[str, Any]] = []
    with drv.in_iframe():
        snap = drv.run("snapshot", "-i")
        refs = drv.parse_snapshot_refs(snap)
        slug_tb = [t for t in refs["textboxes"] if t[0] == "toasty" or len(refs["textboxes"]) >= 3]
        slug = slug_tb[-1][2] if slug_tb and slug_tb[-1][2] else "asset"
        dl_btns = [b for b in refs["buttons"] if "download image asset" in b[0].lower()]
        inspect_btns = [b for b in refs["buttons"] if b[0].lower() == "inspect"]
        if dl_btns:
            for idx, db in enumerate(dl_btns, 1):
                before = {p.name for p in dl_dir.iterdir()} if dl_dir.exists() else set()
                drv.run("scrollintoview", db[1])
                drv.run("click", db[1])
                found = _latest_download(before, (".png", ".jpg", ".jpeg", ".webp"), timeout=8.0, dl_dir=dl_dir)
                dest = out_dir / f"{slug}__breakout_{idx:02d}.png"
                if found and found.exists():
                    shutil.copy2(found, dest)
                    downloaded.append({"file": str(dest), "source": str(found), "download_dir": str(dl_dir), "bytes": dest.stat().st_size})
                    continue
                if idx - 1 < len(inspect_btns):
                    drv.run("click", inspect_btns[idx - 1][1])
                    drv.run("wait", "300")
                drv.run("screenshot", str(dest))
                downloaded.append({"file": str(dest), "source": "screenshot-fallback", "bytes": dest.stat().st_size})
            return {"downloaded": downloaded, "count": len(downloaded), "download_dir": str(dl_dir)}

        for idx, ib in enumerate(inspect_btns, 1):
            drv.run("scrollintoview", ib[1])
            drv.run("click", ib[1])
            drv.run("wait", "400")
            src = drv.eval_json(
                """(() => {
                    const imgs = [...document.querySelectorAll('img')].filter(im => im.naturalWidth >= 256);
                    imgs.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
                    return imgs[0] ? JSON.stringify({src: imgs[0].src, w: imgs[0].naturalWidth, h: imgs[0].naturalHeight}) : '';
                })()"""
            )
            dest = out_dir / f"{slug}__breakout_{idx:02d}.png"
            if isinstance(src, dict) and str(src.get("src", "")).startswith("data:image/") and "," in str(src["src"]):
                dest.write_bytes(base64.b64decode(str(src["src"]).split(",", 1)[1]))
                downloaded.append({"file": str(dest), "w": src.get("w"), "h": src.get("h"), "bytes": dest.stat().st_size})
            else:
                before = {p.name for p in dl_dir.iterdir()} if dl_dir.exists() else set()
                cur_snap = drv.run("snapshot", "-i")
                cur_refs = drv.parse_snapshot_refs(cur_snap)
                exp_btn = next((b for b in cur_refs["buttons"] if b[0].lower().startswith("export image")), None)
                found = None
                if exp_btn:
                    drv.run("click", exp_btn[1])
                    found = _latest_download(before, (".png", ".jpg", ".jpeg", ".webp"), timeout=6.0, dl_dir=dl_dir)
                if found and found.exists():
                    shutil.copy2(found, dest)
                    downloaded.append({"file": str(dest), "w": src.get("w") if isinstance(src, dict) else None, "h": src.get("h") if isinstance(src, dict) else None, "bytes": dest.stat().st_size, "source": str(found)})
                else:
                    chroma = next((c for c in cur_refs["checkboxes"] if "chroma key matte" in c[0].lower()), None)
                    if chroma and not chroma[2]:
                        drv.run("click", chroma[1])
                        drv.run("wait", "200")
                    drv.run("scroll", "up", "9999")
                    drv.run("wait", "250")
                    drv.run("screenshot", str(dest))
                    try:
                        from PIL import Image
                        box_raw = drv.run("get", "box", "img", check=False).strip()
                        box = json.loads(box_raw) if box_raw.startswith("{") else None
                        if isinstance(box, dict) and float(box.get("width", 0)) >= 256 and float(box.get("height", 0)) >= 256:
                            with Image.open(dest) as im:
                                x0, y0 = max(0, int(round(box["x"]))), max(0, int(round(box["y"])))
                                x1, y1 = min(im.width, int(round(box["x"] + box["width"]))), min(im.height, int(round(box["y"] + box["height"])))
                                if x1 - x0 >= 256 and y1 - y0 >= 256:
                                    im.crop((x0, y0, x1, y1)).save(dest)
                    except Exception:
                        pass
                    downloaded.append({"file": str(dest), "bytes": dest.stat().st_size, "source": "iframe-sandbox-canvas-fallback"})
    return {"downloaded": downloaded, "count": len(downloaded), "download_dir": str(dl_dir)}


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--session", default=DEFAULT_SESSION, help="agent-browser session name (default: flow-live)")
    common.add_argument("--json", action="store_true", help="Output JSON (always prints formatted JSON)")

    p = argparse.ArgumentParser(prog="cli-anything-asset-breakout", parents=[common], description="CLI-Anything harness for Google Flow Asset Breakout")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("map", parents=[common], help="Show complete mapped Asset Breakout UI controls & selectors")
    sub.add_parser("status", parents=[common], help="Inspect current tab, Tool/Edit mode, iframe, gate, and tray count")
    sub.add_parser("tool-mode", parents=[common], help="Switch outer Flow frame to Tool mode without editing Tool Builder")

    pm = sub.add_parser("mode", parents=[common], help="Select workbench mode tab inside Asset Breakout")
    pm.add_argument("target", choices=list(WORKBENCH_MODES.keys()))

    ps = sub.add_parser("import-storyboard", parents=[common], help="Upload storyboard (.xml/.md/.txt/.json/.pdf) into section 01")
    ps.add_argument("file")
    ps.add_argument("--page", help="Optional substring to match in parsed Page/Section dropdown")

    pu = sub.add_parser("upload-refs", parents=[common], help="Upload 1..4 reference images into section 02")
    pu.add_argument("files", nargs="+")

    pi = sub.add_parser("set-inputs", parents=[common], help="Fill Gate inputs (context, verbatim prompt, slug, aspect, outputs)")
    pi.add_argument("--context", help="01 Storyboard Concept & Scene Context")
    pi.add_argument("--prompt", help="03 User Prompt (Verbatim Only)")
    pi.add_argument("--slug", help="Character Slug")
    pi.add_argument("--aspect", help="Aspect Ratio label")
    pi.add_argument("--outputs", type=int, choices=[1, 2, 3, 4], help="Output Count (1..4)")
    pi.add_argument("--layout-hint", choices=["on", "off"], help="Include editable layout hint checkbox")

    pg = sub.add_parser("generate", parents=[common], help="Verify gate unlocked, trigger generation, and wait for tray update")
    pg.add_argument("--wait", type=int, default=120, help="Max seconds to wait for output")

    pdr = sub.add_parser("download-rig", parents=[common], help="Download Rig JSON from top bar")
    pdr.add_argument("out")

    pdt = sub.add_parser("download-tray", parents=[common], help="Download all tray item PNGs into a directory")
    pdt.add_argument("out_dir")

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    dispatch = {
        "map": cmd_map,
        "status": cmd_status,
        "tool-mode": cmd_tool_mode,
        "mode": cmd_mode,
        "import-storyboard": cmd_import_storyboard,
        "upload-refs": cmd_upload_refs,
        "set-inputs": cmd_set_inputs,
        "generate": cmd_generate,
        "download-rig": cmd_download_rig,
        "download-tray": cmd_download_tray,
    }
    res = dispatch[args.cmd](args)
    print(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
