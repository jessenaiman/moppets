#!/usr/bin/env python3
"""Prepare and optimize the 6 isolated Children's Education Farm School GLBs.

Copies ONLY the 6 Farm School characters from `clap-cleared/` into
`public/kids-farm/models/` (completely isolated from `public/cast/`):
  - Downscales embedded 4K textures to <= 1024px RGB JPEG (or PNG if true alpha cutout)
  - Strips `.scale` animation channels and non-root `.translation` channels
  - Clamps root hip translation deviation safely within validate-animation bounds
    and zeroes horizontal XZ hip drift relative to frame 0 so characters stay grounded
  - Verifies 6/6 pass `threejs_3d_asset.py validate-animation`
"""
from __future__ import annotations

import io
import json
import math
import struct
import subprocess
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = Path("/run/media/jesse/Speedy/magic-studio-assets/media/mixamo-playground/clap-cleared")
OUT_DIR = REPO_ROOT / "public" / "kids-farm" / "models"
VALIDATOR = Path("/home/jesse/.agents/skills/threejs-3d-generator/scripts/threejs_3d_asset.py")

FARM_MODELS = [
    ("old-macdonald-moves.glb", "old-macdonald.glb"),
    ("miss-hayley-moves.glb", "miss-hayley.glb"),
    ("mr-maisy-moves.glb", "maisy-cow.glb"),
    ("mr-rusty-moves.glb", "rusty-horse.glb"),
    ("mr-sam-moves.glb", "sam-pig.glb"),
    ("miss-puddles-moves.glb", "puddles-duck.glb"),
]

ROOT_HIP_NAMES = {"Armature", "Root", "Hip", "Pelvis", "tripo::Root", "mixamorig:Hips", "Hips"}


def _read_vec3_accessor(doc: dict, buf: bytes, acc_idx: int) -> np.ndarray:
    acc = doc["accessors"][acc_idx]
    bv = doc["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    cnt = acc["count"]
    stride = bv.get("byteStride") or 12
    out = np.empty((cnt, 3), dtype=np.float32)
    if stride == 12:
        out[:] = np.frombuffer(buf, dtype=np.float32, count=cnt * 3, offset=off).reshape(cnt, 3)
    else:
        for i in range(cnt):
            out[i] = struct.unpack_from("<fff", buf, off + i * stride)
    return out


def _write_vec3_accessor(doc: dict, mutable_buf: bytearray, acc_idx: int, arr: np.ndarray) -> None:
    acc = doc["accessors"][acc_idx]
    bv = doc["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    cnt = acc["count"]
    stride = bv.get("byteStride") or 12
    arr32 = np.asarray(arr, dtype=np.float32)
    if stride == 12:
        raw = arr32.tobytes()
        mutable_buf[off : off + len(raw)] = raw
    else:
        for i in range(cnt):
            struct.pack_into("<fff", mutable_buf, off + i * stride, float(arr32[i, 0]), float(arr32[i, 1]), float(arr32[i, 2]))
    acc["min"] = [float(x) for x in arr32.min(axis=0)]
    acc["max"] = [float(x) for x in arr32.max(axis=0)]


def process_glb(src_path: Path, dst_path: Path, max_tex: int = 1024) -> None:
    raw = src_path.read_bytes()
    magic, ver, _ = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67 or ver != 2:
        raise ValueError(f"Invalid GLB header in {src_path}")
    jlen, jtype = struct.unpack_from("<II", raw, 12)
    assert jtype == 0x4E4F534A
    doc = json.loads(raw[20 : 20 + jlen].decode("utf-8"))
    boff = 20 + jlen
    blen, btype = struct.unpack_from("<II", raw, boff)
    assert btype == 0x004E4942
    bin_mut = bytearray(raw[boff + 8 : boff + 8 + blen])

    nodes = doc.get("nodes", [])
    rest_trans = {i: np.array(n.get("translation", [0.0, 0.0, 0.0]), dtype=np.float32) for i, n in enumerate(nodes)}

    # 1. Strip .scale + non-root .translation channels; keep Hips translation within safe bounds & stationary XZ
    for anim in doc.get("animations", []):
        kept = []
        samplers = anim.get("samplers", [])
        for ch in anim.get("channels", []):
            tgt = ch.get("target", {})
            path = tgt.get("path")
            if path == "scale":
                continue
            if path == "translation":
                n_idx = tgt.get("node")
                n_name = nodes[n_idx].get("name", "") if n_idx is not None else ""
                if n_name not in ROOT_HIP_NAMES and n_name.split("::")[-1] not in ROOT_HIP_NAMES:
                    continue
                if n_idx is not None:
                    samp = samplers[ch["sampler"]]
                    out_acc = samp["output"]
                    arr = _read_vec3_accessor(doc, bin_mut, out_acc)
                    if len(arr) > 0:
                        # Lock XZ to frame-0 rest offset to stop sliding drift while keeping vertical bounce
                        arr[:, 0] = arr[0, 0]
                        arr[:, 2] = arr[0, 2]
                        # Ensure max deviation never exceeds 0.45 * ||rest|| (validate-animation fails > 0.5x)
                        rvec = rest_trans.get(n_idx, np.zeros(3, dtype=np.float32))
                        rlen = float(np.linalg.norm(rvec))
                        if rlen > 1e-4:
                            diff = arr - rvec[None, :]
                            dnorm = np.linalg.norm(diff, axis=1)
                            cap = 0.44 * rlen
                            over = dnorm > cap
                            if np.any(over):
                                scale = cap / np.maximum(dnorm[over], 1e-6)
                                arr[over] = rvec[None, :] + diff[over] * scale[:, None]
                        _write_vec3_accessor(doc, bin_mut, out_acc, arr)
            kept.append(ch)
        anim["channels"] = kept

    # 2. Compress embedded 4K images -> <= 1024px JPEG (or PNG if genuine alpha mask exists)
    img_bv_replacements: dict[int, bytes] = {}
    for im in doc.get("images", []):
        bv_idx = im.get("bufferView")
        if bv_idx is None:
            continue
        bv = doc["bufferViews"][bv_idx]
        off = bv.get("byteOffset", 0)
        ln = bv["byteLength"]
        img_bytes = bytes(bin_mut[off : off + ln])
        pil = Image.open(io.BytesIO(img_bytes))
        w, h = pil.size
        if max(w, h) > max_tex:
            scale = max_tex / float(max(w, h))
            pil = pil.resize((max(64, int(round(w * scale))), max(64, int(round(h * scale)))), Image.Resampling.LANCZOS)

        has_real_alpha = False
        if "A" in pil.getbands():
            amin, _ = pil.getchannel("A").getextrema()
            has_real_alpha = amin < 250

        out_io = io.BytesIO()
        if has_real_alpha:
            pil.convert("RGBA").save(out_io, format="PNG", optimize=True)
            im["mimeType"] = "image/png"
        else:
            pil.convert("RGB").save(out_io, format="JPEG", quality=86, optimize=True)
            im["mimeType"] = "image/jpeg"
        img_bv_replacements[bv_idx] = out_io.getvalue()

    # 3. Repack binary buffer cleanly preserving 4-byte alignment on every bufferView
    new_bin = bytearray()
    for idx, bv in enumerate(doc.get("bufferViews", [])):
        while len(new_bin) % 4 != 0:
            new_bin.append(0)
        if idx in img_bv_replacements:
            chunk = img_bv_replacements[idx]
        else:
            old_off = bv.get("byteOffset", 0)
            old_len = bv["byteLength"]
            chunk = bytes(bin_mut[old_off : old_off + old_len])
        bv["byteOffset"] = len(new_bin)
        bv["byteLength"] = len(chunk)
        new_bin.extend(chunk)
    while len(new_bin) % 4 != 0:
        new_bin.append(0)
    if doc.get("buffers"):
        doc["buffers"][0]["byteLength"] = len(new_bin)

    new_json = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    new_json += b" " * ((4 - (len(new_json) % 4)) % 4)

    total_len = 12 + 8 + len(new_json) + 8 + len(new_bin)
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    with dst_path.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total_len))
        f.write(struct.pack("<II", len(new_json), 0x4E4F534A))
        f.write(new_json)
        f.write(struct.pack("<II", len(new_bin), 0x004E4942))
        f.write(new_bin)

    print(
        f"[kids-farm] {dst_path.name:20s} "
        f"{src_path.stat().st_size/1e6:5.2f} MB -> {dst_path.stat().st_size/1e6:4.2f} MB"
    )


def main() -> int:
    fails = 0
    for src_name, dst_name in FARM_MODELS:
        src = SRC_DIR / src_name
        dst = OUT_DIR / dst_name
        if not src.exists():
            print(f"MISSING source: {src}", file=sys.stderr)
            fails += 1
            continue
        process_glb(src, dst)
        res = subprocess.run(
            ["python3", str(VALIDATOR), "validate-animation", str(dst)],
            capture_output=True,
            text=True,
        )
        if res.returncode != 0:
            print(f"VALIDATE FAIL {dst.name}:\n{res.stdout}\n{res.stderr}", file=sys.stderr)
            fails += 1
        else:
            print(f"  validate-animation PASS: {dst.name}")
    return fails


if __name__ == "__main__":
    raise SystemExit(main())
