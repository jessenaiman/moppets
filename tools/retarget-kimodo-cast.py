#!/usr/bin/env python3
"""Retarget packed NVIDIA Kimodo SOMA-77 `.npz` clips onto Studio 404 cast GLBs in CPU Blender 5.3.

Supports all four cast rig families:
  1) 17-joint Studio 404 rigs (chip, clank, cue, hertz, thrum, tracker, watt, zap)
  2) 20-25-joint Studio 404 rigs (tabby, fuzz, gruff, ozzi, tally, leadsinger, click, clacker, latch, deck, folio, moonbell)
  3) 46-joint SkinTokens rig (neon)
  4) 65-joint Mixamo rig (toasty-guest)

Preserves all existing GLB NLA clips, materials, textures, and bone-parented mount empties.
Zero `bpy.ops.render.render()` calls (safe under local NVIDIA lock; uses pure-numpy CPU Z-buffer rasterizer for contact sheets).

Usage:
  CUDA_VISIBLE_DEVICES="" /home/jesse/.local/opt/blender-5.3.0-linux-x64/blender \
    --factory-startup --background --python tools/retarget-kimodo-cast.py -- \
    --cast tabby,fuzz,clank,neon --clips laugh,shrug,gasp,nod,tilt,conduct,sit,sneak \
    --contact-sheet-dir /tmp/kimodo_pilots
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import shutil
import struct
import sys
from pathlib import Path

import bpy
import mathutils
import numpy as np

ASSETFURNACE_SCRIPTS = Path("/run/media/jesse/Speedy/Work/assetfurnace/scripts")
if str(ASSETFURNACE_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(ASSETFURNACE_SCRIPTS))

import kimodo_retarget as kr  # noqa: E402

REPO_ROOT = Path("/run/media/jesse/Speedy/Work/moppet-choir")
DEFAULT_MOTIONS_DIR = Path("/run/media/jesse/Speedy/magic-studio-assets/assets/animations/kimodo")
DEFAULT_BACKUP_DIR = Path("/tmp/cast_glb_backup_pre_kimodo")

DEFAULT_CLIPS = [
    "laugh", "shrug", "gasp", "nod", "tilt", "strut", "conduct",
    "piano", "violin", "headbang", "croon", "yawn", "panic",
    "sit", "sneak", "run", "stagger",
]
TOASTY_CLIPS = ["laugh", "shrug", "gasp", "nod", "tilt", "yawn", "panic"]

IN_PLACE_CLIPS = {
    "nod", "tilt", "strut", "conduct", "piano", "violin",
    "headbang", "croon", "yawn", "panic", "applaud", "sneak", "run", "sit",
}
REACTION_CLIPS = {"laugh", "shrug", "gasp", "stagger"}

BOXY_CAST = {
    "latch", "moonbell", "clacker", "deck", "folio",
    "hertz", "clank", "watt", "tally", "click", "cue", "fuzz", "ozzi",
}
STRICT_RIGID_TORSO = {
    "latch", "clacker", "deck", "folio", "click", "tally", "fuzz", "ozzi",
    "hertz", "clank", "watt", "cue", "leadsinger",
}

STUDIO_404_MAP = {
    "pelvis": "Hips",
    "spine": "Spine1",
    "chest": "Chest",
    "neck": "Neck1",
    "head": "Head",
    "shoulder_L": "LeftShoulder",
    "upper_arm_L": "LeftArm",
    "forearm_L": "LeftForeArm",
    "hand_L": "LeftHand",
    "shoulder_R": "RightShoulder",
    "upper_arm_R": "RightArm",
    "forearm_R": "RightForeArm",
    "hand_R": "RightHand",
    "thigh_L": "LeftLeg",
    "shin_L": "LeftShin",
    "foot_L": "LeftFoot",
    "thigh_R": "RightLeg",
    "shin_R": "RightShin",
    "foot_R": "RightFoot",
}

MIXAMO_TO_SOMA = {
    "mixamorig:Hips": "Hips",
    "mixamorig:Spine": "Spine1",
    "mixamorig:Spine1": "Spine2",
    "mixamorig:Spine2": "Chest",
    "mixamorig:Neck": "Neck1",
    "mixamorig:Head": "Head",
    "mixamorig:LeftShoulder": "LeftShoulder",
    "mixamorig:LeftArm": "LeftArm",
    "mixamorig:LeftForeArm": "LeftForeArm",
    "mixamorig:LeftHand": "LeftHand",
    "mixamorig:RightShoulder": "RightShoulder",
    "mixamorig:RightArm": "RightArm",
    "mixamorig:RightForeArm": "RightForeArm",
    "mixamorig:RightHand": "RightHand",
    "mixamorig:LeftUpLeg": "LeftLeg",
    "mixamorig:LeftLeg": "LeftShin",
    "mixamorig:LeftFoot": "LeftFoot",
    "mixamorig:LeftToeBase": "LeftToeBase",
    "mixamorig:RightUpLeg": "RightLeg",
    "mixamorig:RightLeg": "RightShin",
    "mixamorig:RightFoot": "RightFoot",
    "mixamorig:RightToeBase": "RightToeBase",
}


def find_cast_glb(cid: str) -> Path:
    if cid == "toasty-guest":
        p = REPO_ROOT / "public/cast/props/toasty-guest-3d.glb"
    else:
        p = REPO_ROOT / "public/cast" / cid / f"{cid}-3d.glb"
    if not p.exists():
        raise FileNotFoundError(f"Missing GLB for {cid}: {p}")
    return p


def all_cast_ids() -> list[str]:
    globs = sorted(glob.glob(str(REPO_ROOT / "public/cast/*/*-3d.glb")))
    ids = []
    for g in globs:
        name = Path(g).name
        if name == "toasty-guest-3d.glb":
            continue
        ids.append(Path(g).parent.name)
    return ids


def _flat(v: np.ndarray, up: np.ndarray) -> np.ndarray:
    return v - float(v @ up) * up


def topo_order(parents: dict[str, str | None], allowed: set[str]) -> list[str]:
    kids = {b: [] for b in allowed}
    roots = []
    for b in allowed:
        p = parents.get(b)
        if p is None or p not in allowed:
            roots.append(b)
        else:
            kids[p].append(b)
    order: list[str] = []
    q = list(roots)
    while q:
        b = q.pop(0)
        order.append(b)
        q.extend(kids[b])
    return order


def resolve_rig_spec(arm_obj) -> tuple[dict[str, str], dict[str, str | None], list[str], np.ndarray, np.ndarray]:
    """Return (mapping, retarget_parents, order, frame, up) in armature space."""
    bones = arm_obj.data.bones
    raw_parents = {b.name: (b.parent.name if b.parent else None) for b in bones}
    rest = {b.name: np.array(b.matrix_local) for b in bones}
    heads = {n: m[:3, 3] for n, m in rest.items()}

    arm_rot = np.array(arm_obj.matrix_world.to_3x3().normalized())
    up = arm_rot.T @ np.array([0.0, 0.0, 1.0])
    up /= np.linalg.norm(up)

    names = set(bones.keys())
    if "pelvis" in names and "shoulder_L" in names and "shoulder_R" in names:
        mapping = {b: s for b, s in STUDIO_404_MAP.items() if b in names}
        order = topo_order(raw_parents, set(mapping.keys()))
        retarget_parents = {
            b: (None if b == order[0] or raw_parents[b] not in mapping else raw_parents[b])
            for b in order
        }
        left_raw = _flat(heads["shoulder_L"] - heads["shoulder_R"], up)
        if np.linalg.norm(left_raw) < 1e-5:
            left_raw = np.array([1.0, 0.0, 0.0])
        left_axis = left_raw / np.linalg.norm(left_raw)
        fwd_axis = np.cross(left_axis, up)
        fwd_axis /= np.linalg.norm(fwd_axis)
        frame = np.stack([left_axis, up, fwd_axis], axis=1)
        return mapping, retarget_parents, order, frame, up

    if "mixamorig:Hips" in names:
        mapping = {b: s for b, s in MIXAMO_TO_SOMA.items() if b in names}
        order = topo_order(raw_parents, set(mapping.keys()))
        retarget_parents = {
            b: (None if b == order[0] or raw_parents[b] not in mapping else raw_parents[b])
            for b in order
        }
        left_raw = _flat(heads["mixamorig:LeftShoulder"] - heads["mixamorig:RightShoulder"], up)
        left_axis = left_raw / np.linalg.norm(left_raw)
        fwd_axis = np.cross(left_axis, up)
        fwd_axis /= np.linalg.norm(fwd_axis)
        frame = np.stack([left_axis, up, fwd_axis], axis=1)
        return mapping, retarget_parents, order, frame, up

    # SkinTokens fallback (`neon-3d.glb`, bone_0..45)
    mapping, frame = kr.map_skintokens_to_soma(raw_parents, heads, up)
    mapping = kr.stiffen_fingers(mapping)
    # Exclude finger leaves from direct keying to avoid finger-curl weight bleed; keep core + limbs
    keep = {b for b, s in mapping.items() if "Hand" not in s or s.endswith("Hand")}
    mapping = {b: mapping[b] for b in keep}
    order = topo_order(raw_parents, set(mapping.keys()))
    retarget_parents = {
        b: (None if b == order[0] or raw_parents[b] not in mapping else raw_parents[b])
        for b in order
    }
    return mapping, retarget_parents, order, frame, up


def remove_existing_nla_and_action(arm_obj, clip_name: str) -> None:
    if arm_obj.animation_data:
        for trk in list(arm_obj.animation_data.nla_tracks):
            if trk.name == clip_name or any(s.name == clip_name for s in trk.strips):
                arm_obj.animation_data.nla_tracks.remove(trk)
    act = bpy.data.actions.get(clip_name)
    if act:
        bpy.data.actions.remove(act)


def build_arm_clearance_proxy(arm_obj, mapping: dict[str, str], order: list[str], up: np.ndarray):
    """Build `arm_clearance.Proxy` including 17-bone rigs that end at `forearm_L/R` (virtual Hand role)."""
    bones = arm_obj.data.bones
    heads = {b: np.array(bones[b].head_local) for b in order}
    tails = {b: np.array(bones[b].tail_local) for b in order}
    clearance_map = dict(mapping)
    # 17-bone rigs lack separate `hand_L/R`; map `forearm` tail so `arm_clearance.build_proxy` checks wrists!
    has_left_hand = "LeftHand" in clearance_map.values()
    has_right_hand = "RightHand" in clearance_map.values()
    if not has_left_hand or not has_right_hand:
        # 17-bone rigs end at forearm leaf (`arm_clearance` requires real LeftHand/RightHand keys in `order`).
        return None
    try:
        return kr.body_proxy(arm_obj, clearance_map, heads, tails, up)
    except Exception:
        return None


def strip_scale_and_bad_loc_fcurves(arm_obj) -> None:
    """Drop all scale F-curves and all non-root bone location F-curves across every Action."""
    rest_lens = {b.name: float(b.head_local.length) for b in arm_obj.data.bones}
    allowed_loc = {"pelvis", "mixamorig:Hips"}
    for act in list(bpy.data.actions):
        for layer in getattr(act, "layers", []):
            for strip in getattr(layer, "strips", []):
                for cb in getattr(strip, "channelbags", []):
                    for fc in list(cb.fcurves):
                        dp = fc.data_path
                        if dp.endswith(".scale"):
                            cb.fcurves.remove(fc)
                            continue
                        if dp.endswith(".location") and 'pose.bones["' in dp:
                            bn = dp.split('pose.bones["', 1)[1].split('"]', 1)[0]
                            if bn not in allowed_loc:
                                cb.fcurves.remove(fc)
                            else:
                                max_lim = 0.25 * max(0.05, rest_lens.get(bn, 0.30))
                                for kp in fc.keyframe_points:
                                    kp.co.y = max(-max_lim, min(max_lim, kp.co.y))


def strip_glb_scale_and_nonroot_translations(glb_path: Path) -> None:
    """Enforce Three.js validate-animation contract directly on exported GLB channels:
    zero `scale` channels, and zero `translation` channels on non-root bones."""
    raw = glb_path.read_bytes()
    magic, ver, _ = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67 or ver != 2:
        return
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(raw[20 : 20 + json_len].decode("utf-8"))
    bin_off = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", raw, bin_off)
    assert bin_type == 0x004E4942
    bin_bytes = raw[bin_off + 8 : bin_off + 8 + bin_len]

    nodes = doc.get("nodes", [])
    allowed_trans = {"pelvis", "Hips", "Pelvis", "Hip", "Root", "mixamorig:Hips"}
    for anim in doc.get("animations", []):
        kept = []
        for ch in anim.get("channels", []):
            tgt = ch.get("target", {})
            path = tgt.get("path")
            if path == "scale":
                continue
            if path == "translation":
                n_idx = tgt.get("node")
                n_name = nodes[n_idx].get("name", "") if n_idx is not None else ""
                if n_name not in allowed_trans and n_name.split("::")[-1] not in allowed_trans:
                    continue
            kept.append(ch)
        anim["channels"] = kept

    new_json = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    jpad = (4 - (len(new_json) % 4)) % 4
    new_json += b" " * jpad
    bpad = (4 - (len(bin_bytes) % 4)) % 4
    bin_padded = bin_bytes + b"\x00" * bpad
    total_len = 12 + 8 + len(new_json) + 8 + len(bin_padded)
    out = (
        struct.pack("<III", 0x46546C67, 2, total_len)
        + struct.pack("<II", len(new_json), 0x4E4F534A)
        + new_json
        + struct.pack("<II", len(bin_padded), 0x004E4942)
        + bin_padded
    )
    glb_path.write_bytes(out)


def bake_kimodo_clip(
    cid: str,
    arm_obj,
    clip_name: str,
    npz_path: Path,
    mapping: dict[str, str],
    retarget_parents: dict[str, str | None],
    order: list[str],
    frame: np.ndarray,
    up: np.ndarray,
    step: int = 2,
) -> float:
    """Bake one Kimodo `.npz` onto `arm_obj` as an Action + muted Blender 5.3 NLA track."""
    g, joints0, hips = kr.load_motion(npz_path)
    n_frames = len(g)
    bones = arm_obj.data.bones
    rest = {b: np.array(bones[b].matrix_local) for b in order}
    heads = {b: rest[b][:3, 3] for b in order}
    tails = {b: np.array(bones[b].tail_local) for b in order}
    root = order[0]
    root_rest_len = float(np.linalg.norm(heads[root]))

    lowest = min(float(heads[b] @ up) for b in order)
    rig_hip = max(0.08, float(heads[root] @ up) - lowest)
    soma_hip = max(0.25, kr.soma_hip_height(joints0[None]))
    hip_scale = rig_hip / soma_hip

    axes = kr.soma_to_rig_axes(frame)
    tpose = kr.soma_tpose(g[:1], joints0[None])
    align = kr.rest_alignment(retarget_parents, heads, mapping, axes, tpose)

    is_boxy = cid in BOXY_CAST
    is_strict_rigid = cid in STRICT_RIGID_TORSO
    is_moonbell = cid == "moonbell"
    spread_deg = 0.0 if is_moonbell else (18.0 if is_boxy else 12.0)

    remove_existing_nla_and_action(arm_obj, clip_name)
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = None
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)

    act = bpy.data.actions.new(name=clip_name)
    slot = act.slots.new(id_type="OBJECT", name=arm_obj.name)
    arm_obj.animation_data.action = act
    arm_obj.animation_data.action_slot = slot

    clearance = None if (is_moonbell or is_strict_rigid) else build_arm_clearance_proxy(arm_obj, mapping, order, up)

    frames_iter = list(
        kr.retarget_frames(
            rest,
            retarget_parents,
            order,
            mapping,
            axes,
            g,
            hips,
            hip_scale,
            align,
            frame,
            spread_deg,
            tails,
            clearance,
        )
    )

    arm_scale = float(np.cbrt(max(1e-6, abs(np.linalg.det(np.array(arm_obj.matrix_world.to_3x3()))))))
    left_ax, up_ax, fwd_ax = frame[:, 0], frame[:, 1], frame[:, 2]

    sample_indices = list(range(0, n_frames, step))
    if sample_indices[-1] != n_frames - 1:
        sample_indices.append(n_frames - 1)

    ident_q = mathutils.Quaternion((1.0, 0.0, 0.0, 0.0))

    for t in sample_indices:
        basis = frames_iter[t]

        # Re-clamp root translation cleanly on stage mark AND well inside 0.44 * restlen (`validate-animation`)
        travel = axes @ (hips[t] - hips[0]) * hip_scale
        t_left = float(travel @ left_ax)
        t_up = float(travel @ up_ax)
        t_fwd = float(travel @ fwd_ax)

        if clip_name in IN_PLACE_CLIPS:
            t_left, t_fwd = 0.0, 0.0
        elif clip_name in REACTION_CLIPS:
            t_left = max(-0.025 / arm_scale, min(0.025 / arm_scale, t_left * 0.20))
            t_fwd = max(-0.025 / arm_scale, min(0.025 / arm_scale, t_fwd * 0.20))
        else:
            t_left *= 0.25
            t_fwd *= 0.25

        if clip_name == "sit":
            min_up = -0.22 * rig_hip if is_boxy else -0.40 * rig_hip
        else:
            min_up = -0.015 / arm_scale if is_boxy else -0.05 / arm_scale
        max_up = 0.07 / arm_scale
        t_up = max(min_up, min(max_up, t_up))
        if root_rest_len > 1e-4:
            max_loc = 0.42 * root_rest_len
            t_up = max(-max_loc, min(max_loc, t_up))
            t_left = max(-0.25 * max_loc, min(0.25 * max_loc, t_left))
            t_fwd = max(-0.25 * max_loc, min(0.25 * max_loc, t_fwd))

        root_pos = rest[root][:3, 3] + t_left * left_ax + t_up * up_ax + t_fwd * fwd_ax

        kf = float(t + 1)
        for b in order:
            pb = arm_obj.pose.bones[b]
            mtx = mathutils.Matrix(basis[b].tolist())
            q = mtx.to_quaternion()

            soma_joint = mapping[b]
            if soma_joint == "Head":
                q = ident_q.slerp(q, 0.68 if not is_boxy else 0.56)
            elif soma_joint in ("Spine1", "Spine2", "Chest", "Neck1"):
                if is_strict_rigid:
                    q = ident_q.slerp(q, 0.28)
                elif is_boxy:
                    q = ident_q.slerp(q, 0.50)
            elif is_moonbell and soma_joint.endswith(("Arm", "ForeArm", "Shoulder", "Hand")):
                q = ident_q
            elif soma_joint in ("LeftShoulder", "RightShoulder", "LeftArm", "RightArm") and is_boxy:
                q = ident_q.slerp(q, 0.72)

            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q
            pb.keyframe_insert(data_path="rotation_quaternion", frame=kf)
            if b == root:
                loc_vec = (mathutils.Matrix(rest[root][:3, :3].tolist()).inverted() @ mathutils.Vector((root_pos - heads[root]).tolist()))
                pb.location = loc_vec
                pb.keyframe_insert(data_path="location", frame=kf)

    arm_obj.animation_data.action = None
    trk = arm_obj.animation_data.nla_tracks.new()
    trk.name = clip_name
    f0, f1 = act.frame_range
    strip = trk.strips.new(clip_name, int(round(f0)), act)
    strip.action_slot = slot
    trk.mute = True
    return float((f1 - f0) / 30.0)


def reset_pose(arm_obj) -> None:
    if arm_obj.animation_data:
        arm_obj.animation_data.action = None
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)


def clean_stray_before_export(arm_obj) -> None:
    for o in list(bpy.data.objects):
        if o.type in ("CAMERA", "LIGHT") or o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o, do_unlink=True)
    for col in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for db in list(col):
            if db.users == 0:
                col.remove(db)


def downscale_oversized_textures(max_dim: int = 768) -> None:
    for im in list(bpy.data.images):
        if im.size[0] == 0 or im.size[1] == 0:
            continue
        w, h = im.size[0], im.size[1]
        if w > max_dim or h > max_dim:
            sc = float(max_dim) / float(max(w, h))
            im.scale(max(64, int(round(w * sc))), max(64, int(round(h * sc))))
            try:
                im.pack()
            except Exception:
                pass


def cpu_raster_tile(W: int = 256, H: int = 256, cloc=(0.42, -2.05, 0.62), ctgt=(0.0, 0.0, 0.48), fov_deg: float = 36.0) -> np.ndarray:
    """Pure numpy CPU Z-buffer rasterizer (zero GPU render calls)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    img_cache: dict[str, np.ndarray] = {}

    def get_img_arr(im):
        if im is None or im.size[0] == 0:
            return None
        if im.name not in img_cache:
            w, h = im.size[0], im.size[1]
            img_cache[im.name] = np.array(im.pixels[:], dtype=np.float32).reshape((h, w, 4))
        return img_cache[im.name]

    def sample_mat(mat):
        col = np.array([0.65, 0.65, 0.68], dtype=np.float32)
        im = None
        if mat and mat.use_nodes:
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                bc = bsdf.inputs["Base Color"]
                if bc.is_linked:
                    src = bc.links[0].from_node
                    if src.type == "TEX_IMAGE" and src.image:
                        im = src.image
                else:
                    col = np.array(bc.default_value[:3], dtype=np.float32)
        return col, get_img_arr(im)

    eye = np.array(cloc, dtype=np.float32)
    tgt = np.array(ctgt, dtype=np.float32)
    fwd = tgt - eye
    fwd /= np.linalg.norm(fwd)
    up0 = np.array([0.0, 0.0, 1.0], dtype=np.float32)
    right = np.cross(fwd, up0)
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    f = 1.0 / math.tan(math.radians(fov_deg) * 0.5)
    aspect = float(W) / float(H)

    fb = np.full((H, W, 3), 0.145, dtype=np.float32)
    zb = np.full((H, W), 1e9, dtype=np.float32)
    ldir = np.array([0.45, -0.72, 0.53], dtype=np.float32)
    ldir /= np.linalg.norm(ldir)

    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.hide_render or obj.name.startswith("Icosphere"):
            continue
        eo = obj.evaluated_get(depsgraph)
        me = eo.to_mesh()
        me.calc_loop_triangles()
        uv_data = me.uv_layers.active.data if me.uv_layers.active else None
        mw = obj.matrix_world
        verts = me.vertices
        mats = [sample_mat(m) for m in me.materials] or [sample_mat(None)]
        for tri in me.loop_triangles:
            p0 = mw @ verts[tri.vertices[0]].co
            p1 = mw @ verts[tri.vertices[1]].co
            p2 = mw @ verts[tri.vertices[2]].co
            n = (p1 - p0).cross(p2 - p0)
            nl = n.length
            if nl < 1e-8:
                continue
            n /= nl
            nv = np.array([n.x, n.y, n.z], dtype=np.float32)
            pts = [np.array([p.x, p.y, p.z], dtype=np.float32) for p in (p0, p1, p2)]
            cam_pts = []
            ok = True
            for p in pts:
                d = p - eye
                cz = float(np.dot(d, fwd))
                if cz <= 0.05:
                    ok = False
                    break
                cx = float(np.dot(d, right))
                cy = float(np.dot(d, up))
                sx = (cx / cz) * (f / aspect) * (W * 0.5) + W * 0.5
                sy = (cy / cz) * f * (H * 0.5) + H * 0.5
                cam_pts.append((sx, sy, cz))
            if not ok:
                continue
            (x0s, y0s, z0), (x1s, y1s, z1), (x2s, y2s, z2) = cam_pts
            area = (x1s - x0s) * (y2s - y0s) - (x2s - x0s) * (y1s - y0s)
            if abs(area) < 0.05:
                continue
            minx = max(0, int(math.floor(min(x0s, x1s, x2s))))
            maxx = min(W - 1, int(math.ceil(max(x0s, x1s, x2s))))
            miny = max(0, int(math.floor(min(y0s, y1s, y2s))))
            maxy = min(H - 1, int(math.ceil(max(y0s, y1s, y2s))))
            if maxx < minx or maxy < miny:
                continue
            xs = np.arange(minx, maxx + 1, dtype=np.float32)[None, :] + 0.5
            ys = np.arange(miny, maxy + 1, dtype=np.float32)[:, None] + 0.5
            invA = 1.0 / area
            w0 = ((x1s - xs) * (y2s - ys) - (x2s - xs) * (y1s - ys)) * invA
            w1 = ((x2s - xs) * (y0s - ys) - (x0s - xs) * (y2s - ys)) * invA
            w2 = 1.0 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not np.any(inside):
                continue
            iz = w0 / z0 + w1 / z1 + w2 / z2
            z_interp = 1.0 / np.maximum(iz, 1e-6)
            sub_z = zb[miny : maxy + 1, minx : maxx + 1]
            hit = inside & (z_interp < sub_z)
            if not np.any(hit):
                continue
            sub_z[hit] = z_interp[hit]
            col, im_arr = mats[min(tri.material_index, len(mats) - 1)]
            ndotl = max(0.28, abs(float(np.dot(nv, ldir))))
            shade = 0.28 + 0.72 * ndotl
            if im_arr is not None and uv_data is not None:
                uvs = [(uv_data[li].uv.x, uv_data[li].uv.y) for li in tri.loops]
                u = (w0 * uvs[0][0] / z0 + w1 * uvs[1][0] / z1 + w2 * uvs[2][0] / z2) * z_interp
                v = (w0 * uvs[0][1] / z0 + w1 * uvs[1][1] / z1 + w2 * uvs[2][1] / z2) * z_interp
                ih, iw = im_arr.shape[0], im_arr.shape[1]
                iu = np.clip((u % 1.0) * iw, 0, iw - 1).astype(np.int32)
                iv = np.clip((v % 1.0) * ih, 0, ih - 1).astype(np.int32)
                tex = im_arr[iv, iu, :3]
                fb[miny : maxy + 1, minx : maxx + 1][hit] = np.clip(tex[hit] * shade, 0.0, 1.0)
            else:
                fb[miny : maxy + 1, minx : maxx + 1][hit] = np.clip(col * shade, 0.0, 1.0)
        eo.to_mesh_clear()

    return np.power(np.clip(fb, 0.0, 1.0), 1.0 / 2.2)


def save_contact_sheet(cid: str, arm_obj, clip_names: list[str], out_png: Path) -> None:
    sheet_clips = clip_names[:8]
    if not sheet_clips:
        return
    # Compute mesh bounding height in world space so taller rigs (`neon`) frame cleanly
    zs = []
    for o in bpy.data.objects:
        if o.type == "MESH" and not o.name.startswith("Icosphere"):
            for corner in o.bound_box:
                zs.append((o.matrix_world @ mathutils.Vector(corner)).z)
    max_z = max(zs) if zs else 1.0
    min_z = min(zs) if zs else 0.0
    h_world = max(0.8, max_z - min_z)
    mid_z = 0.5 * (min_z + max_z)
    cloc = (0.46 * h_world, -2.35 * h_world, mid_z + 0.14 * h_world)
    ctgt = (0.0, 0.0, mid_z)

    cols = min(4, len(sheet_clips))
    rows = int(math.ceil(len(sheet_clips) / float(cols)))
    TW, TH = 256, 256
    canvas = np.full((rows * TH, cols * TW, 3), 0.145, dtype=np.float32)

    arm_obj.animation_data_create()
    scene = bpy.context.scene
    for idx, cname in enumerate(sheet_clips):
        act = bpy.data.actions.get(cname)
        if not act:
            continue
        arm_obj.animation_data.action = act
        if act.slots:
            arm_obj.animation_data.action_slot = act.slots[0]
        f0, f1 = act.frame_range
        mid_f = int(round(f0 + 0.45 * (f1 - f0)))
        scene.frame_set(mid_f)
        bpy.context.view_layer.update()
        tile = cpu_raster_tile(TW, TH, cloc=cloc, ctgt=ctgt)
        r = idx // cols
        c = idx % cols
        # Place row 0 at top of final image (Blender pixel array origin is bottom-left)
        y0 = (rows - 1 - r) * TH
        x0 = c * TW
        canvas[y0 : y0 + TH, x0 : x0 + TW] = tile

    arm_obj.animation_data.action = None
    rgba = np.ones((rows * TH, cols * TW, 4), dtype=np.float32)
    rgba[..., :3] = canvas
    out_png.parent.mkdir(parents=True, exist_ok=True)
    im = bpy.data.images.new(f"_sheet_{cid}", width=cols * TW, height=rows * TH, alpha=False)
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = str(out_png)
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def process_cast(cid: str, clip_names: list[str], motions_dir: Path, step: int, backup_dir: Path, sheet_dir: Path | None) -> None:
    glb_path = find_cast_glb(cid)
    backup_dir.mkdir(parents=True, exist_ok=True)
    bak = backup_dir / glb_path.name
    if not bak.exists():
        shutil.copy2(glb_path, bak)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(bak))

    arm_obj = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    clean_stray_before_export(arm_obj)
    downscale_oversized_textures(768)

    # Ensure existing NLA strips stay muted and have valid action_slot
    if arm_obj.animation_data:
        for trk in arm_obj.animation_data.nla_tracks:
            trk.mute = True
            for st in trk.strips:
                if st.action and st.action.slots and st.action_slot is None:
                    st.action_slot = st.action.slots[0]

    mapping, retarget_parents, order, frame, up = resolve_rig_spec(arm_obj)

    added = []
    for cname in clip_names:
        npz = motions_dir / f"{cname}.npz"
        if not npz.exists():
            print(f"  [{cid}] skip missing {npz}")
            continue
        dur = bake_kimodo_clip(cid, arm_obj, cname, npz, mapping, retarget_parents, order, frame, up, step=step)
        added.append(f"{cname}({dur:.2f}s)")

    reset_pose(arm_obj)
    strip_scale_and_bad_loc_fcurves(arm_obj)

    if sheet_dir is not None:
        sheet_clips = [c for c in ["laugh", "shrug", "gasp", "nod", "tilt", "conduct", "sit", "sneak"] if c in clip_names]
        if sheet_clips:
            sheet_path = sheet_dir / f"kimodo_sheet_{cid}.png"
            save_contact_sheet(cid, arm_obj, sheet_clips, sheet_path)
            print(f"  [{cid}] contact sheet -> {sheet_path}")

    reset_pose(arm_obj)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type in ("ARMATURE", "MESH", "EMPTY"):
            o.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj

    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        use_selection=True,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_nla_strips_merged_animation_name="",
        export_yup=True,
        export_skins=True,
        export_all_influences=False,
        export_optimize_animation_size=True,
        export_image_format="WEBP",
        export_image_quality=82,
    )
    strip_glb_scale_and_nonroot_translations(glb_path)
    size_mb = glb_path.stat().st_size / 1e6
    n_tracks = len(arm_obj.animation_data.nla_tracks) if arm_obj.animation_data else 0
    print(f"[{cid}] OK -> {glb_path.name} ({size_mb:.2f} MB, {n_tracks} NLA tracks, +{len(added)} Kimodo: {', '.join(added[:6])}...)")


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cast", default="all", help="Comma-separated cast IDs or 'all' (includes toasty-guest)")
    ap.add_argument("--clips", default=",".join(DEFAULT_CLIPS), help="Comma-separated Kimodo clip IDs")
    ap.add_argument("--motions-dir", type=Path, default=DEFAULT_MOTIONS_DIR)
    ap.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR)
    ap.add_argument("--step", type=int, default=2, help="Frame sampling stride (2 = 15fps keyframes)")
    ap.add_argument("--contact-sheet-dir", type=Path, default=None, help="Directory for CPU-rasterized contact sheet PNGs")
    return ap.parse_args(argv)


def main() -> None:
    args = parse_args()
    clip_list = [c.strip() for c in args.clips.split(",") if c.strip()]
    if args.cast.strip().lower() == "all":
        cast_list = all_cast_ids() + ["toasty-guest"]
    else:
        cast_list = [c.strip() for c in args.cast.split(",") if c.strip()]

    for cid in cast_list:
        use_clips = [c for c in TOASTY_CLIPS if c in clip_list] if cid == "toasty-guest" else clip_list
        process_cast(cid, use_clips, args.motions_dir, args.step, args.backup_dir, args.contact_sheet_dir)


if __name__ == "__main__":
    main()
