"""Crops Vee's solo sheets into per-cel PNGs for the EffectCraft scene (tools/moppets/solo-scene.ts)."""
from PIL import Image
import os
OUT = "out/effectcraft/solo-cels"
os.makedirs(OUT, exist_ok=True)
for kind in ("body", "head"):
    im = Image.open(f"public/moppets/vee/{kind}.webp").convert("RGBA")
    for f in range(8):
        x, y = (f % 4) * 384, (f // 4) * 512
        im.crop((x, y, x + 384, y + 512)).save(f"{OUT}/{kind}-{f}.png")
print("ok")
