"""Prompt points for SAM from a classical cut-out: points deep inside it (the character) and far
outside it (the background), so SAM takes the whole character, not the part one point lands on.
Reads only the cut-out's alpha; the cutting is done by the Craft apps (tools/moppets/isolate.ts).
Usage: uv run --no-project --with pillow --with numpy --with scipy python tools/moppets/prompts.py <cutout.png>
Prints {"fg": [[x, y], ...], "bg": [[x, y], ...]}."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

alpha = np.asarray(Image.open(sys.argv[1]).convert("RGBA"))[..., 3] > 200
inside = nd.binary_erosion(alpha, iterations=5)
outside = nd.binary_erosion(~nd.binary_dilation(alpha, iterations=6), iterations=10)


def spread(mask, n):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return []
    # a coarse grid over the mask's bounds, one point per cell that has any
    pts = []
    for gy in np.linspace(ys.min(), ys.max(), n + 1)[:-1]:
        for gx in np.linspace(xs.min(), xs.max(), n + 1)[:-1]:
            cell = (ys >= gy) & (ys < gy + (ys.max() - ys.min()) / n + 1) & (xs >= gx) & (xs < gx + (xs.max() - xs.min()) / n + 1)
            if cell.sum() > 30:
                k = np.argmin((xs[cell] - xs[cell].mean()) ** 2 + (ys[cell] - ys[cell].mean()) ** 2)
                pts.append([int(xs[cell][k]), int(ys[cell][k])])
    return pts


print(json.dumps({"fg": spread(inside, 4), "bg": spread(outside, 3)}))
