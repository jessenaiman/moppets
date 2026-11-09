"""Assets for a fully animated Moppet: a headless 8-frame dance body and an 8-cell viseme head
(rest, M/B/P, F/V, EE, AH, OH, OO, blink), keyed from flat magenta, feet-aligned, with each frame's
neck position measured so the head can ride the dance.
Usage: uv run --no-project --with pillow --with numpy --with scipy python tools/moppets/solo.py [id]"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

name = sys.argv[1] if len(sys.argv) > 1 else "vee"
SRC = "out/moppet-art/sheets/solo/"
CW, CH = 384, 512

def key(path):
    im = np.asarray(Image.open(path).convert("RGB").resize((CW * 4, CH * 2), Image.LANCZOS)).astype(float)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    chroma = ((np.minimum(r, b) - g) / 255).clip(0, 1)
    alpha = nd.gaussian_filter(1 - ((chroma - 0.12) / 0.32).clip(0, 1), 0.6)
    spill = np.minimum(r, b) > g + 18
    rgb = im.copy()
    rgb[spill, 0] = np.maximum(g[spill], r[spill] - (np.minimum(r, b) - g)[spill])
    rgb[spill, 2] = np.maximum(g[spill], b[spill] - (np.minimum(r, b) - g)[spill])
    return rgb, alpha

def clean(a):
    lab, n = nd.label(a > 0.5)
    if n > 1:
        sizes = nd.sum(a > 0.5, lab, range(1, n + 1))
        a = a * nd.binary_dilation(lab == 1 + int(np.argmax(sizes)), iterations=4)
    return a

os.makedirs(f"public/moppets/{name}", exist_ok=True)
frames = []
# body: feet to the baseline, hips centred; the neck is the top of the body nearest the centre line
rgb, alpha = key(SRC + "body.png")
out = np.zeros((CH * 2, CW * 4, 4), np.uint8)
for f in range(8):
    cx, cy = (f % 4) * CW, (f // 4) * CH
    a = clean(alpha[cy:cy + CH, cx:cx + CW])
    ys, xs = np.where(a > 0.5)
    sy = 490 - int(np.percentile(ys, 99.5))
    low = ys > np.percentile(ys, 62)
    sx = CW // 2 - int(np.median(xs[low]))
    cell = np.dstack([rgb[cy:cy + CH, cx:cx + CW], a * 255]).clip(0, 255).astype(np.uint8)
    moved = np.roll(np.roll(cell, sy, axis=0), sx, axis=1)
    if sy > 0: moved[:sy] = 0
    elif sy < 0: moved[sy:] = 0
    if sx > 0: moved[:, :sx] = 0
    elif sx < 0: moved[:, sx:] = 0
    out[cy:cy + CH, cx:cx + CW] = moved
    m = moved[..., 3] > 128
    # the neck stub: topmost solid column near the body's centre of mass
    ys2, xs2 = np.where(m)
    cmx = int(np.median(xs2[ys2 < np.percentile(ys2, 35)]))
    band = m[:, max(0, cmx - 40):min(CW, cmx + 40)]
    top = np.where(band.any(axis=1))[0][0]
    tx = max(0, cmx - 40) + int(np.mean(np.where(band[top + 6])[0]))
    frames.append([round(tx / CW, 4), round((top + 10) / CH, 4)])
Image.fromarray(out, "RGBA").save(f"public/moppets/{name}/body.webp", quality=86, method=6)

# head: every cell aligned on its neck bottom, centred
rgb, alpha = key(SRC + "head.png")
out = np.zeros((CH * 2, CW * 4, 4), np.uint8)
bot = []
for f in range(8):
    cx, cy = (f % 4) * CW, (f // 4) * CH
    a = clean(alpha[cy:cy + CH, cx:cx + CW])
    ys, xs = np.where(a > 0.5)
    sy = 452 - int(ys.max())
    sx = CW // 2 - int(np.median(xs))
    cell = np.dstack([rgb[cy:cy + CH, cx:cx + CW], a * 255]).clip(0, 255).astype(np.uint8)
    moved = np.roll(np.roll(cell, sy, axis=0), sx, axis=1)
    if sy > 0: moved[:sy] = 0
    elif sy < 0: moved[sy:] = 0
    if sx > 0: moved[:, :sx] = 0
    elif sx < 0: moved[:, sx:] = 0
    out[cy:cy + CH, cx:cx + CW] = moved
    bot.append(int(ys.max()) + sy)
Image.fromarray(out, "RGBA").save(f"public/moppets/{name}/head.webp", quality=86, method=6)
neck_y = round(max(bot) / CH, 4)
open("src/choir/vee-solo.json", "w").write(json.dumps({"neck": frames, "headNeckY": round(neck_y - 0.075, 4), "headScale": 0.66}))
print(frames, neck_y)
