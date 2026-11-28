#!/usr/bin/env python3
"""Generate the measured 21-cast Studio 404 scale comparison chart (`2560x1440`).

Reads canonical `heightDu`, `displayName`, `role`, `color`, and `portraitUrl`
directly from `public/cast/manifest.json` so it stays 100% synced with the
compiled Bible manifest (`1.00H = 100 DU = 254 mm`, Tabby baseline; Moonbell =
70 DU / 0.70H; Gruff = 200 DU / 2.00H).

Outputs to both:
- `/run/media/jesse/Speedy/magic-studio-assets/bibles/general/scale-lineup-21-cast-measured.png`
- `public/cast/scale-lineup-21-cast-measured.png`
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "public" / "cast" / "manifest.json"
OUT_PUBLIC = ROOT / "public" / "cast" / "scale-lineup-21-cast-measured.png"
OUT_BIBLES = Path("/run/media/jesse/Speedy/magic-studio-assets/bibles/general/scale-lineup-21-cast-measured.png")

W, H = 2560, 1440
RAIL_W = 264
PLOT_L = RAIL_W + 24
PLOT_R = W - 36
UNIT_1H_PX = 232.0  # Identical global scale across both aligned 0.00H tiers

PAPER = (245, 240, 230, 255)       # #F5F0E6 archival plate paper
RAIL_BG = (233, 225, 211, 255)     # #E9E1D3 left measurement rail
INK = (34, 29, 25, 255)
INK_MUTED = (102, 92, 82, 255)
RULE_LIGHT = (212, 203, 188, 255)
RULE_MID = (176, 165, 148, 255)
RULE_ACCENT = (168, 74, 42, 255)   # Tabby 1.00H baseline & Moonbell callout
RULE_GROUND = (52, 45, 39, 255)
MOONBELL_ACCENT = (38, 114, 102, 255)


def load_font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    candidates = []
    if mono:
        candidates = [
            "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf" if bold else "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ]
    else:
        candidates = [
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
        ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def hex_to_rgb(hx: str) -> tuple[int, int, int, int]:
    h = hx.strip().lstrip("#")
    if len(h) == 6:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    return (90, 90, 90, 255)


def trim_alpha(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    mask = rgba.getchannel("A").point(lambda a: 255 if a > 12 else 0)
    bbox = mask.getbbox()
    return rgba.crop(bbox) if bbox else rgba


def draw_tier(
    canvas: Image.Image,
    draw: ImageDraw.ImageDraw,
    entries: list[dict],
    ground_y: int,
    max_h_val: float,
    tier_title: str,
    rules: list[tuple[float, str, tuple[int, int, int, int], bool]],
    fonts: dict,
) -> None:
    top_y = int(round(ground_y - max_h_val * UNIT_1H_PX))

    # Left rail label
    draw.text((20, top_y - 30), tier_title, font=fonts["rail_hdr"], fill=INK_MUTED)

    # Horizontal measurement rules across rail + plot (labels live inside rail so sprites never overlap text)
    for h_val, rail_tag, color, is_major in rules:
        y = int(round(ground_y - h_val * UNIT_1H_PX))
        if is_major:
            draw.line([(RAIL_W, y), (PLOT_R, y)], fill=color, width=2 if h_val in (0.0, 1.0) else 1)
        else:
            for x in range(RAIL_W, PLOT_R, 14):
                draw.line([(x, y), (min(PLOT_R, x + 7), y)], fill=color, width=1)
        draw.line([(RAIL_W - 12, y), (RAIL_W, y)], fill=color, width=2 if is_major else 1)

        label_h = f"{h_val:.2f}H"
        mm = int(round(h_val * 254))
        full_rail = f"{label_h}  {rail_tag} ({mm}mm)" if rail_tag else f"{label_h}  ({mm}mm)"
        draw.text((16, y - 9), full_rail, font=fonts["rail_bold"] if h_val in (0.0, 1.0, 0.70) else fonts["rail"], fill=color if h_val in (1.0, 0.70, 0.0) else INK_MUTED)

    # Compute scaled sprites & pack horizontally proportionally within [PLOT_L, PLOT_R]
    prepared = []
    sum_w = 0.0
    for item in entries:
        target_h = max(24, int(round((item["heightDu"] / 100.0) * UNIT_1H_PX)))
        sprite = item["sprite"]
        scale = target_h / sprite.height
        target_w = max(24, int(round(sprite.width * scale)))
        prepared.append((item, sprite.resize((target_w, target_h), Image.Resampling.LANCZOS), target_w, target_h))
        sum_w += target_w

    avail_w = PLOT_R - PLOT_L
    n = len(prepared)
    gap = max(8.0, (avail_w - sum_w) / max(1, n + 1))

    cursor_x = PLOT_L + gap
    for idx, (item, resized, tw, th) in enumerate(prepared):
        x0 = int(round(cursor_x))
        cx = x0 + tw // 2
        y0 = ground_y - th
        cursor_x += tw + gap

        # Soft ground shadow ellipse right beneath feet on 0.00H line
        sh_rx = max(18, min(tw // 2 - 4, 72))
        draw.ellipse([cx - sh_rx, ground_y - 4, cx + sh_rx, ground_y + 5], fill=(185, 174, 158, 120))

        canvas.alpha_composite(resized, (x0, y0))

        # Top crown tick for extremes & baseline markers
        is_featured = item["id"] in ("gruff", "hertz", "tabby", "moonbell", "tracker", "latch")
        accent = hex_to_rgb(item.get("color", "#444444"))
        if is_featured:
            draw.line([(cx - 12, y0), (cx + 12, y0)], fill=accent, width=2)

        # Bottom nameplate under 0.00H floor
        draw.line([(cx, ground_y), (cx, ground_y + 10)], fill=RULE_GROUND, width=2)
        name = item["displayName"]
        du = item["heightDu"]
        h_frac = du / 100.0
        mm = int(round(du * 2.54))

        name_col = MOONBELL_ACCENT if item["id"] == "moonbell" else (RULE_ACCENT if item["id"] == "tabby" else INK)
        nw = draw.textlength(name, font=fonts["name"])
        draw.text((cx - nw / 2, ground_y + 15), name, font=fonts["name"], fill=name_col)

        metric = f"{h_frac:.2f}H · {du}DU"
        mw = draw.textlength(metric, font=fonts["metric"])
        draw.text((cx - mw / 2, ground_y + 37), metric, font=fonts["metric"], fill=INK_MUTED)

        mm_txt = f"{mm} mm"
        mmw = draw.textlength(mm_txt, font=fonts["mm"])
        draw.text((cx - mmw / 2, ground_y + 55), mm_txt, font=fonts["mm"], fill=INK_MUTED)


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    rows = []
    for cid, c in manifest["characters"].items():
        p = ROOT / "public" / c["portraitUrl"].lstrip("/")
        rows.append({
            "id": cid,
            "displayName": c["displayName"],
            "role": c["role"],
            "color": c["color"],
            "heightDu": int(c["heightDu"]),
            "sprite": trim_alpha(Image.open(p)),
        })

    # Canonical descending sort: Gruff 200 DU -> Moonbell 70 DU
    rows.sort(key=lambda r: (-r["heightDu"], r["displayName"].lower()))

    tier1 = rows[:10]   # Gruff (200 DU) -> Clacker (98 DU)
    tier2 = rows[10:]   # Deck (98 DU) -> Moonbell (70 DU)

    canvas = Image.new("RGBA", (W, H), PAPER)
    draw = ImageDraw.Draw(canvas)

    # Left archival measurement rail
    draw.rectangle([0, 0, RAIL_W, H], fill=RAIL_BG)
    draw.line([(RAIL_W, 0), (RAIL_W, H)], fill=RULE_MID, width=2)

    fonts = {
        "title": load_font(34, bold=True),
        "subtitle": load_font(18, bold=False),
        "tag": load_font(15, bold=True, mono=True),
        "rail_hdr": load_font(14, bold=True, mono=True),
        "rail": load_font(14, bold=False, mono=True),
        "rail_bold": load_font(15, bold=True, mono=True),
        "rule_note": load_font(13, bold=True, mono=True),
        "name": load_font(16, bold=True),
        "metric": load_font(13, bold=True, mono=True),
        "mm": load_font(12, bold=False, mono=True),
        "footer": load_font(15, bold=False),
    }

    # Header block
    draw.text((RAIL_W + 32, 26), "STUDIO 404 · COMPLETE 21-CAST MEASURED SCALE LINEUP", font=fonts["title"], fill=INK)
    draw.text(
        (RAIL_W + 34, 70),
        "Canon proportional height chart anchored to Tabby (1.00H = 100 DU = 254 mm). Both tiers share identical pixel-to-DU scale (1.00H = 232 px).",
        font=fonts["subtitle"],
        fill=INK_MUTED,
    )
    badge = "21 BIBLE CANON RIGS · 200 DU to 70 DU"
    bw = draw.textlength(badge, font=fonts["tag"])
    draw.rounded_rectangle([PLOT_R - bw - 28, 30, PLOT_R, 62], radius=6, fill=(224, 214, 198, 255), outline=RULE_MID, width=1)
    draw.text((PLOT_R - bw - 14, 38), badge, font=fonts["tag"], fill=INK)
    draw.line([(RAIL_W + 24, 106), (PLOT_R, 106)], fill=RULE_MID, width=1)

    tier1_rules = [
        (2.00, "GRUFF MAX", INK_MUTED, True),
        (1.50, "HERTZ", INK_MUTED, True),
        (1.12, "NEON / TALLY", RULE_LIGHT, False),
        (1.00, "TABBY BASE", RULE_ACCENT, True),
        (0.50, "", RULE_LIGHT, False),
        (0.00, "STAGE FLOOR", RULE_GROUND, True),
    ]
    draw_tier(canvas, draw, tier1, ground_y=645, max_h_val=2.05, tier_title="TIER 1 · 200 to 98 DU", rules=tier1_rules, fonts=fonts)

    tier2_rules = [
        (1.12, "", RULE_LIGHT, False),
        (1.00, "TABBY REF", RULE_ACCENT, True),
        (0.84, "CHIP / LATCH", RULE_LIGHT, False),
        (0.75, "TRACKER", RULE_MID, False),
        (0.70, "MOONBELL MIN", MOONBELL_ACCENT, True),
        (0.50, "", RULE_LIGHT, False),
        (0.00, "STAGE FLOOR", RULE_GROUND, True),
    ]
    draw_tier(canvas, draw, tier2, ground_y=1245, max_h_val=1.20, tier_title="TIER 2 · 98 to 70 DU", rules=tier2_rules, fonts=fonts)

    # Footer bar
    draw.line([(RAIL_W + 24, 1348), (PLOT_R, 1348)], fill=RULE_MID, width=1)
    draw.text(
        (RAIL_W + 32, 1364),
        "Height Law: Gruff (200 DU / 508 mm) towers 2.86x Moonbell (70 DU / 178 mm). All sprites & 3D GLBs bind feet flush at 0.00H.",
        font=fonts["footer"],
        fill=INK_MUTED,
    )
    draw.text((20, 1364), "UNIT: 1 DU = 2.54 mm", font=fonts["rail_bold"], fill=INK_MUTED)

    out_rgb = canvas.convert("RGB")
    OUT_PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    OUT_BIBLES.parent.mkdir(parents=True, exist_ok=True)
    out_rgb.save(OUT_PUBLIC, "PNG", optimize=True)
    shutil.copy2(OUT_PUBLIC, OUT_BIBLES)
    print(f"Generated {OUT_PUBLIC} ({out_rgb.size[0]}x{out_rgb.size[1]}) & synced to {OUT_BIBLES}")


if __name__ == "__main__":
    main()
