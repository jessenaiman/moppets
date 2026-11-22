"""Where each Moppet's found object is, in every dance cel: src/ui/prop-anchors.generated.json.

Each object's anchor is placed by hand on cel 0 (ANCHORS, fractions of the 384x512 cel). The same
patch is then found in the other 7 cels by template matching (OpenCV, normalised correlation,
searched near the cel-0 position, at a few scales, against the patch of every cel already found),
since the object moves and turns as the Moppet dances. Prints each match score: a low one (< 0.5)
means the object turned or was covered in that cel, and the cel-0 position is kept unless
OVERRIDES places it by hand.

Usage: python3 tools/gen-prop-anchors.py   (run again when a sprite sheet or an anchor changes)
"""
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
W, H = 384, 512
# cel-0 anchors: what each effect sits on (see src/ui/props.tsx)
ANCHORS = {
    "vee": (0.416, 0.673),  # the cassette's window, between its reels
    "scribe": (0.52, 0.60),  # the paper in the typewriter
    "clank": (0.47, 0.535),  # the drive bay
    "pip": (0.5, 0.5),  # the chin, where the throat sac swells
    "gruff": (0.40, 0.76),  # the belly button
    "tabby": (0.46, 0.355),  # the screen's top strip, above the eyes
    "chip": (0.595, 0.575),  # the floppy's corner
}
# cels where the object moves too far or turns too much to be matched, placed by hand (checked on
# a grid): cel 6 is the arms-up pose, which lifts each chest object well above its cel-0 place
OVERRIDES = {
    ("vee", 6): (0.45, 0.465),
    ("scribe", 6): (0.55, 0.41),
    ("clank", 6): (0.51, 0.35),
    ("pip", 6): (0.46, 0.30),
}
PATCH, SEARCH, MIN_SCORE = 36, 120, 0.5
SCALES = (0.85, 0.92, 1.0, 1.08, 1.16)


def cels(sheet: np.ndarray) -> list[np.ndarray]:
    a = sheet[:, :, 3:4] / 255.0
    grey = cv2.cvtColor((sheet[:, :, :3] * a + 128 * (1 - a)).astype(np.uint8), cv2.COLOR_BGR2GRAY)
    return [grey[(f // 4) * H : (f // 4 + 1) * H, (f % 4) * W : (f % 4 + 1) * W] for f in range(8)]


def main() -> None:
    out: dict[str, list[list[float]]] = {}
    for id, (fx, fy) in ANCHORS.items():
        sheet = cv2.imread(str(ROOT / "public/moppets" / id / ("body.webp" if id == "vee" else "closed.webp")), cv2.IMREAD_UNCHANGED)
        cs = cels(sheet)
        cx, cy = round(fx * W), round(fy * H)
        found = [cs[0][cy - PATCH : cy + PATCH, cx - PATCH : cx + PATCH]]
        frames, scores = [], []
        for f, c in enumerate(cs):
            x0, y0 = max(0, cx - SEARCH), max(0, cy - SEARCH)
            win = c[y0 : cy + SEARCH, x0 : cx + SEARCH]
            best = (-1.0, cx, cy)
            for tpl in found:
                for k in SCALES:
                    t = cv2.resize(tpl, None, fx=k, fy=k)
                    if t.shape[0] >= win.shape[0] or t.shape[1] >= win.shape[1]:
                        continue
                    res = cv2.matchTemplate(win, t, cv2.TM_CCOEFF_NORMED)
                    _, score, _, (mx, my) = cv2.minMaxLoc(res)
                    if score > best[0]:
                        best = (score, x0 + mx + t.shape[1] / 2, y0 + my + t.shape[0] / 2)
            score, x, y = best
            if (id, f) in OVERRIDES:
                x, y, score = OVERRIDES[(id, f)][0] * W, OVERRIDES[(id, f)][1] * H, 1.0
            elif score < MIN_SCORE:
                x, y = cx, cy
            elif f:
                xi, yi = round(x), round(y)
                found.append(c[yi - PATCH : yi + PATCH, xi - PATCH : xi + PATCH])
            frames.append([round(x / W, 4), round(y / H, 4)])
            scores.append(round(score, 2))
        out[id] = frames
        print(f"{id:7} scores {scores}")
    path = ROOT / "src/ui/prop-anchors.generated.json"
    path.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
