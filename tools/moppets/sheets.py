"""Turn Codex sprite sheets (8 frames, 4x2 cells of 384x512 on flat magenta) into stage assets:
keys out the background, steadies every frame on its feet so swaps between the open- and closed-mouth
sheets do not jump, and writes public/moppets/<id>/{open,closed}.webp.
Usage: uv run --no-project --with pillow --with numpy --with scipy python tools/moppets/sheets.py"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

CAST = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"]
SRC = "out/moppet-art/sheets/"
CW, CH = 384, 512
for name in CAST:
    os.makedirs(f"public/moppets/{name}", exist_ok=True)
    for mouth in ("open", "closed"):
        path = f"{SRC}{name}-{mouth}.png"
        if not os.path.exists(path):
            print("missing", path)
            continue
        im = np.asarray(Image.open(path).convert("RGB").resize((CW * 4, CH * 2), Image.LANCZOS)).astype(float)
        r, g, b = im[..., 0], im[..., 1], im[..., 2]
        # distance from pure magenta; fringe pixels get partial alpha and lose their pink spill
        chroma = ((np.minimum(r, b) - g) / 255).clip(0, 1)
        alpha = 1 - ((chroma - 0.12) / 0.32).clip(0, 1)
        alpha = nd.gaussian_filter(alpha, 0.6)
        spill = np.minimum(r, b) > g + 18
        fg = alpha > 0.04
        rgb = im.copy()
        rgb[spill & fg, 0] = np.maximum(g[spill & fg], r[spill & fg] - (np.minimum(r, b) - g)[spill & fg])
        rgb[spill & fg, 2] = np.maximum(g[spill & fg], b[spill & fg] - (np.minimum(r, b) - g)[spill & fg])
        out = np.zeros((CH * 2, CW * 4, 4), np.uint8)
        for f in range(8):
            cx, cy = (f % 4) * CW, (f // 4) * CH
            cell_a = alpha[cy:cy + CH, cx:cx + CW]
            lab, n = nd.label(cell_a > 0.5)
            if n > 1:
                sizes = nd.sum(cell_a > 0.5, lab, range(1, n + 1))
                keep = nd.binary_dilation(lab == 1 + int(np.argmax(sizes)), iterations=4)
                cell_a = cell_a * keep
            ys, xs = np.where(cell_a > 0.5)
            if not len(ys):
                continue
            # feet to the baseline, hips centred: every frame stands in the same place
            shift_y = 490 - int(np.percentile(ys, 99.5))
            low = ys > np.percentile(ys, 62)
            shift_x = CW // 2 - int(np.median(xs[low]))
            cell = np.dstack([rgb[cy:cy + CH, cx:cx + CW], cell_a * 255]).clip(0, 255).astype(np.uint8)
            moved = np.roll(np.roll(cell, shift_y, axis=0), shift_x, axis=1)
            if shift_y > 0: moved[:shift_y] = 0
            elif shift_y < 0: moved[shift_y:] = 0
            if shift_x > 0: moved[:, :shift_x] = 0
            elif shift_x < 0: moved[:, shift_x:] = 0
            out[cy:cy + CH, cx:cx + CW] = moved
        Image.fromarray(out, "RGBA").save(f"public/moppets/{name}/{mouth}.webp", quality=86, method=6)
        print(name, mouth, "ok")
