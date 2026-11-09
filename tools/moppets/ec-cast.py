"""Builds an EffectCraft replacement-cel scene of the whole cast from the sprite sheets: each
Moppet is 8 full-frame cels with hold-opacity swaps on the beat (no cut-up limbs).
Usage: uv run --no-project --with pillow python tools/moppets/ec-cast.py"""
import json, os
from PIL import Image
CAST = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"]
OUT = os.path.abspath("out/effectcraft/cels")
os.makedirs(OUT, exist_ok=True)
for n in CAST:
    sheet = Image.open(f"public/moppets/{n}/open.webp").convert("RGBA")
    for f in range(8):
        x, y = (f % 4) * 384, (f // 4) * 512
        sheet.crop((x, y, x + 384, y + 512)).save(f"{OUT}/{n}-{f}.png")
BPM = 118
spacing = 270
jsx = 'var c = app.project.items.addComp("Moppet choir dance", 2000, 720, 1, 12, 24);\nc.bgColor = [0.16,0.13,0.1];\n'
for i, n in enumerate(CAST):
    x = 190 + i * spacing
    for f in range(8):
        jsx += f'var it = app.project.importFile(new ImportOptions(new File("{OUT}/{n}-{f}.png")));\n'
        jsx += f'var l = c.layers.add(it); l.name = "{n} cel {f}";\n'
        jsx += f'l.property("Transform").property("Position").setValue([{x}, 400]);\n'
        # replacement cel: visible only on its frame, two frames a beat
        jsx += f'l.property("Transform").property("Opacity").expression = "Math.floor(time * {BPM / 60 * 2}) % 8 === {f} ? 100 : 0";\n'
    jsx += f'// foot-anchored squash lives in the app\n'
jsx += 'writeLn(c.numLayers);\n'
open("out/effectcraft/moppet-choir.jsx", "w").write(jsx)
print("ok")
