#!/usr/bin/env python3
"""Rebuild the 11 Colab cast rigs ONE CHARACTER AT A TIME with rigid-chassis skinning & symmetric bind poses.

Fixes hard-surface distortion (boxes/bells folding like rubber), asymmetric bind arms (fuzz),
and non-root bone translation / scale warps so exported GLBs pass Three.js `validate-animation`.

Usage:
  CUDA_VISIBLE_DEVICES="" /home/jesse/.local/opt/blender-5.3.0-linux-x64/blender \
    --factory-startup --background --python tools/fix-colab-rigs-rigid.py -- --cast fuzz
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import struct
import sys
from pathlib import Path

import bmesh
import bpy
import mathutils
import numpy as np

ASSETFURNACE_SCRIPTS = Path("/run/media/jesse/Speedy/Work/assetfurnace/scripts")
if str(ASSETFURNACE_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(ASSETFURNACE_SCRIPTS))

import clean_skin_weights as csw  # noqa: E402

RAW_DIR = Path("/run/media/jesse/Speedy/magic-studio-assets/animations/colab-3d-pilot/raw")
MIX_DIR = Path("/run/media/jesse/Speedy/magic-studio-assets/assets/animations/mixamo")
TABBY_GLB = Path("/run/media/jesse/Speedy/Work/moppet-choir/public/cast/tabby/tabby-3d.glb")
PUBLIC_CAST = Path("/run/media/jesse/Speedy/Work/moppet-choir/public/cast")
BACKUP_V4 = Path("/tmp/cast_glb_backup_v4")

JOBS = {
    "fuzz":       [("guitar", "guitar-playing.fbx", 60)],
    "gruff":      [("guitar", "guitar-playing.fbx", 60)],
    "ozzi":       [],
    "tally":      [],
    "leadsinger": [],
    "click":      [("drums", "playing-drums.fbx", 56)],
    "clacker":    [("drums", "playing-drums.fbx", 56)],
    "latch":      [],
    "deck":       [],
    "folio":      [],
    "moonbell":   [],
}

RIGID_BOX_CAST = {"latch", "clacker", "deck", "folio", "click", "tally", "fuzz", "ozzi"}

MIXAMO_TO_RIG = {
    "mixamorig:Hips": "pelvis",
    "mixamorig:Spine1": "spine",
    "mixamorig:Spine2": "chest",
    "mixamorig:Neck": "neck",
    "mixamorig:Head": "head",
    "mixamorig:LeftShoulder": "shoulder_L",
    "mixamorig:LeftArm": "upper_arm_L",
    "mixamorig:LeftForeArm": "forearm_L",
    "mixamorig:LeftHand": "hand_L",
    "mixamorig:RightShoulder": "shoulder_R",
    "mixamorig:RightArm": "upper_arm_R",
    "mixamorig:RightForeArm": "forearm_R",
    "mixamorig:RightHand": "hand_R",
    "mixamorig:LeftUpLeg": "thigh_L",
    "mixamorig:LeftLeg": "shin_L",
    "mixamorig:LeftFoot": "foot_L",
    "mixamorig:RightUpLeg": "thigh_R",
    "mixamorig:RightLeg": "shin_R",
    "mixamorig:RightFoot": "foot_R",
}


def spatial_components(mesh_data):
    nv = len(mesh_data.vertices)
    co = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh_data.vertices], dtype=np.float32)
    pos_map = {}
    uf = list(range(nv))

    def find(x):
        while uf[x] != x:
            uf[x] = uf[uf[x]]
            x = uf[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            uf[rb] = ra

    for i in range(nv):
        k = (round(float(co[i, 0]) * 500), round(float(co[i, 1]) * 500), round(float(co[i, 2]) * 500))
        if k in pos_map:
            union(i, pos_map[k])
        else:
            pos_map[k] = i
    for e in mesh_data.edges:
        union(e.vertices[0], e.vertices[1])
    groups = {}
    for i in range(nv):
        groups.setdefault(find(i), []).append(i)
    res = []
    for idxs in groups.values():
        sub = co[idxs]
        res.append(
            {
                "n": len(idxs),
                "frac": len(idxs) / max(1, nv),
                "x": (float(sub[:, 0].min()), float(sub[:, 0].max())),
                "y": (float(sub[:, 1].min()), float(sub[:, 1].max())),
                "z": (float(sub[:, 2].min()), float(sub[:, 2].max())),
                "idxs": idxs,
            }
        )
    res.sort(key=lambda g: -g["n"])
    return res


def downscale_images(max_dim: int = 768):
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


def join_and_normalize_mesh(cid: str):
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.name.startswith("Icosphere")]
    if not meshes:
        raise RuntimeError(f"{cid}: no meshes found")
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    main = max(meshes, key=lambda o: len(o.data.vertices))
    bpy.context.view_layer.objects.active = main
    if len(meshes) > 1:
        bpy.ops.object.join()
        main = bpy.context.view_layer.objects.active
    for o in list(bpy.data.objects):
        if o != main and o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    main.select_set(True)
    bpy.context.view_layer.objects.active = main
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Remove disconnected flat boundary caps & small floaters
    sc = spatial_components(main.data)
    kill_verts = set()
    main_z1 = sc[0]["z"][1]
    for g in sc[1:]:
        dx = g["x"][1] - g["x"][0]
        dy = g["y"][1] - g["y"][0]
        dz = g["z"][1] - g["z"][0]
        is_flat_cap = dz < 0.16 and max(dx, dy) > 0.50 and (g["z"][0] > 0.78 or g["z"][1] < -0.78)
        is_far_above = g["z"][0] > main_z1 + 0.05
        is_tiny_noise = g["frac"] < 0.03
        if is_flat_cap or is_far_above or is_tiny_noise:
            kill_verts.update(g["idxs"])
    if kill_verts:
        bm = bmesh.new()
        bm.from_mesh(main.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill_verts], context="VERTS")
        bm.to_mesh(main.data)
        main.data.update()
        bm.free()

    # Remove glued pedestal disc brim around feet using ankle XY centers on fuzz / ozzi / gruff
    if cid in ("fuzz", "ozzi", "gruff"):
        bm = bmesh.new()
        bm.from_mesh(main.data)
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        co = np.array([[v.co.x, v.co.y, v.co.z] for v in bm.verts], dtype=np.float32)
        zmin, zmax = float(co[:, 2].min()), float(co[:, 2].max())
        h_raw = max(0.05, zmax - zmin)
        ank = co[(co[:, 2] >= zmin + 0.06 * h_raw) & (co[:, 2] <= zmin + 0.15 * h_raw)]
        xmid = float(np.median(co[:, 0]))
        ank_l = ank[ank[:, 0] >= xmid]
        ank_r = ank[ank[:, 0] < xmid]
        c_l = (float(np.median(ank_l[:, 0])), float(np.median(ank_l[:, 1]))) if len(ank_l) > 4 else (xmid + 0.12 * h_raw, 0.0)
        c_r = (float(np.median(ank_r[:, 0])), float(np.median(ank_r[:, 1]))) if len(ank_r) > 4 else (xmid - 0.12 * h_raw, 0.0)
        z_thresh = zmin + (0.042 if cid == "fuzz" else 0.032) * h_raw
        r_thresh = (0.125 if cid == "fuzz" else 0.145) * h_raw
        bad_faces = []
        for f in bm.faces:
            if all(v.co.z < z_thresh for v in f.verts):
                fc = f.calc_center_median()
                dl = math.hypot(fc.x - c_l[0], fc.y - c_l[1])
                dr = math.hypot(fc.x - c_r[0], fc.y - c_r[1])
                if min(dl, dr) > r_thresh:
                    bad_faces.append(f)
        if bad_faces:
            bmesh.ops.delete(bm, geom=bad_faces, context="FACES")
            orphan_v = [v for v in bm.verts if not v.link_faces]
            if orphan_v:
                bmesh.ops.delete(bm, geom=orphan_v, context="VERTS")
            bm.to_mesh(main.data)
            main.data.update()
        bm.free()
        sc2 = spatial_components(main.data)
        kv2 = set()
        for g in sc2[1:]:
            if g["frac"] < 0.04:
                kv2.update(g["idxs"])
        if kv2:
            bm = bmesh.new()
            bm.from_mesh(main.data)
            bm.verts.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kv2], context="VERTS")
            bm.to_mesh(main.data)
            main.data.update()
            bm.free()

    # Normalize to Z in [0, 1], X/Y centered at bottom center
    coords = np.array([[v.co.x, v.co.y, v.co.z] for v in main.data.vertices], dtype=np.float32)
    zmin, zmax = float(coords[:, 2].min()), float(coords[:, 2].max())
    height = max(0.05, zmax - zmin)
    cx = float((coords[:, 0].min() + coords[:, 0].max()) * 0.5)
    cy = float((coords[:, 1].min() + coords[:, 1].max()) * 0.5)
    scale = 1.0 / height
    for v in main.data.vertices:
        v.co.x = (v.co.x - cx) * scale
        v.co.y = (v.co.y - cy) * scale
        v.co.z = (v.co.z - zmin) * scale
    main.data.update()

    n_polys = len(main.data.polygons)
    if n_polys > 20000:
        mod = main.modifiers.new("Decimate20k", type="DECIMATE")
        mod.ratio = 19500.0 / float(n_polys)
        bpy.context.view_layer.objects.active = main
        bpy.ops.object.modifier_apply(modifier=mod.name)

    return main


def build_symmetric_rigid_armature(cid: str, mesh_obj):
    coords = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh_obj.data.vertices], dtype=np.float32)

    def span_at_z(z0, z1, fallback_x=0.14):
        pts = coords[(coords[:, 2] >= z0) & (coords[:, 2] <= z1)]
        if len(pts) < 8:
            return -fallback_x, fallback_x, 0.0
        return float(np.percentile(pts[:, 0], 5)), float(np.percentile(pts[:, 0], 95)), float(np.median(pts[:, 1]))

    def outer_arm_stats(side_sign, fallback_z=0.52):
        mask = (coords[:, 2] >= 0.32) & (coords[:, 2] <= 0.78)
        if side_sign > 0:
            pts = coords[mask & (coords[:, 0] >= 0.22)]
            reach = float(np.percentile(pts[:, 0], 95)) if len(pts) >= 12 else 0.36
        else:
            pts = coords[mask & (coords[:, 0] <= -0.22)]
            reach = float(abs(np.percentile(pts[:, 0], 5))) if len(pts) >= 12 else 0.36
        if len(pts) < 12:
            return 0.34, (fallback_z, fallback_z - 0.02), 0.0
        sh_pts = pts[np.abs(pts[:, 0]) < reach * 0.72]
        hd_pts = pts[np.abs(pts[:, 0]) >= reach * 0.72]
        z_sh = float(np.median(sh_pts[:, 2])) if len(sh_pts) >= 6 else fallback_z
        z_hd = float(np.median(hd_pts[:, 2])) if len(hd_pts) >= 6 else z_sh - 0.02
        y_m = float(np.median(pts[:, 1]))
        return max(0.26, min(0.46, reach * 0.94)), (z_sh, z_hd), y_m

    if cid == "moonbell":
        z_pelvis, z_spine, z_chest, z_neck, z_head_top = 0.28, 0.38, 0.48, 0.56, 0.96
        arm_z_default = 0.46
    elif cid == "latch":
        z_pelvis, z_spine, z_chest, z_neck, z_head_top = 0.17, 0.36, 0.52, 0.62, 0.96
        arm_z_default = 0.46
    else:
        z_pelvis, z_spine, z_chest, z_neck, z_head_top = 0.33, 0.42, 0.53, 0.60, 0.96
        arm_z_default = 0.52

    tx0, tx1, ty_body = span_at_z(z_spine - 0.06, z_chest + 0.04, 0.12)
    sh_x = max(0.06, min(0.14, max(abs(tx0), abs(tx1)) * 0.55))

    reach_L, (z_sh_L, z_hd_L), ay_L = outer_arm_stats(+1, arm_z_default)
    reach_R, (z_sh_R, z_hd_R), ay_R = outer_arm_stats(-1, arm_z_default)

    # STRICT MIRROR SYMMETRY: prevents one-sided arm bind distortion (e.g. fuzz right arm vs left arm)
    arm_reach = 0.5 * (reach_L + reach_R)
    z_sh_sym = max(0.38, min(0.60, 0.5 * (z_sh_L + z_sh_R)))
    z_hd_sym = max(0.34, min(0.58, 0.5 * (z_hd_L + z_hd_R)))
    # Keep resting bind arms slightly neutral-horizontal/down (never asymmetrically raised into antenna zone!)
    z_sh_sym = 0.5 * (z_chest + z_sh_sym)
    z_hd_sym = min(z_sh_sym + 0.02, max(z_sh_sym - 0.08, z_hd_sym))
    ay_sym = max(-0.06, min(0.05, 0.5 * (ay_L + ay_R) * 0.35))

    lx0, lx1, _ = span_at_z(0.02, 0.18, 0.12)
    foot_x = max(0.07, min(0.14, 0.5 * (abs(lx0) + abs(lx1)) * 0.55))

    arm_data = bpy.data.armatures.new(f"{cid}_armature")
    arm_obj = bpy.data.objects.new(f"{cid}_armature", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm_data.edit_bones

    def add_b(name, h, t, parent=None, connect=False):
        b = eb.new(name)
        b.head = h
        b.tail = t
        b.roll = 0.0
        b.parent = parent
        b.use_connect = connect
        return b

    cy_body = max(-0.06, min(0.05, ty_body * 0.25))
    add_b("root", (0, -0.02, 0.0), (0, -0.02, z_pelvis))
    root = eb["root"]
    pelvis = add_b("pelvis", (0, cy_body, z_pelvis), (0, cy_body, z_spine), root)
    spine = add_b("spine", (0, cy_body, z_spine), (0, cy_body, z_chest), pelvis, False)
    chest = add_b("chest", (0, cy_body, z_chest), (0, cy_body, z_neck), spine, True)
    neck = add_b("neck", (0, cy_body, z_neck), (0, cy_body, z_neck + 0.05), chest, True)
    add_b("head", (0, cy_body, z_neck + 0.05), (0, cy_body, z_head_top), neck, True)

    def place_arm(side_label, sgn):
        z0 = z_sh_sym
        z1 = z_hd_sym
        z_el = 0.5 * (z0 + z1)
        sh = add_b(f"shoulder_{side_label}", (sgn * sh_x * 0.65, ay_sym, z0), (sgn * sh_x, ay_sym, z0), chest)
        u = add_b(f"upper_arm_{side_label}", (sgn * sh_x, ay_sym, z0), (sgn * arm_reach * 0.58, ay_sym, z_el), sh, True)
        f = add_b(
            f"forearm_{side_label}",
            (sgn * arm_reach * 0.58, ay_sym, z_el),
            (sgn * arm_reach * 0.84, ay_sym, 0.5 * (z_el + z1)),
            u,
            True,
        )
        add_b(f"hand_{side_label}", (sgn * arm_reach * 0.84, ay_sym, 0.5 * (z_el + z1)), (sgn * arm_reach, ay_sym, z1), f, True)

    place_arm("L", +1.0)
    place_arm("R", -1.0)

    thL = add_b("thigh_L", (foot_x, 0.0, z_pelvis), (foot_x, -0.01, z_pelvis * 0.52), pelvis)
    shnL = add_b("shin_L", (foot_x, -0.01, z_pelvis * 0.52), (foot_x, -0.02, 0.045), thL, True)
    add_b("foot_L", (foot_x, -0.02, 0.045), (foot_x, -0.14, 0.004), shnL, True)

    thR = add_b("thigh_R", (-foot_x, 0.0, z_pelvis), (-foot_x, -0.01, z_pelvis * 0.52), pelvis)
    shnR = add_b("shin_R", (-foot_x, -0.01, z_pelvis * 0.52), (-foot_x, -0.02, 0.045), thR, True)
    add_b("foot_R", (-foot_x, -0.02, 0.045), (-foot_x, -0.14, 0.004), shnR, True)

    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj

    if cid == "moonbell":
        bpy.ops.object.parent_set(type="ARMATURE_NAME")
        vgs = {vg.name: vg for vg in mesh_obj.vertex_groups}
        for b in arm_data.bones:
            if b.name != "root" and b.name not in vgs:
                vgs[b.name] = mesh_obj.vertex_groups.new(name=b.name)
        for v in mesh_obj.data.vertices:
            x, z = v.co.x, v.co.z
            if z >= 0.44:
                # 100% RIGID bell dome on head so dome NEVER warps
                vgs["head"].add([v.index], 1.0, "REPLACE")
            else:
                side = "L" if x >= 0.0 else "R"
                if z > 0.28:
                    vgs["pelvis"].add([v.index], 0.65, "REPLACE")
                    vgs[f"thigh_{side}"].add([v.index], 0.35, "ADD")
                elif z > 0.14:
                    vgs[f"thigh_{side}"].add([v.index], 0.4, "REPLACE")
                    vgs[f"shin_{side}"].add([v.index], 0.6, "ADD")
                else:
                    vgs[f"shin_{side}"].add([v.index], 0.3, "REPLACE")
                    vgs[f"foot_{side}"].add([v.index], 0.7, "ADD")

    elif cid in RIGID_BOX_CAST:
        bpy.ops.object.parent_set(type="ARMATURE_NAME")
        vgs = {vg.name: vg for vg in mesh_obj.vertex_groups}
        for b in arm_data.bones:
            if b.name != "root" and b.name not in vgs:
                vgs[b.name] = mesh_obj.vertex_groups.new(name=b.name)
        core_half_x = {
            "latch": 0.27,
            "clacker": 0.23,
            "deck": 0.23,
            "folio": 0.22,
            "click": 0.22,
            "tally": 0.22,
            "fuzz": 0.23,
            "ozzi": 0.21,
        }[cid]
        for v in mesh_obj.data.vertices:
            p = v.co
            x, z = p.x, p.z
            if z < z_pelvis * 0.85:
                side = "L" if x >= 0.0 else "R"
                leg_names = [f"thigh_{side}", f"shin_{side}", f"foot_{side}"]
                segs = [(bn, mathutils.Vector(arm_data.bones[bn].head_local), mathutils.Vector(arm_data.bones[bn].tail_local)) for bn in leg_names]
                ds = []
                for bn, h, t in segs:
                    seg = t - h
                    u = max(0.0, min(1.0, (p - h).dot(seg) / max(1e-6, seg.length_squared)))
                    ds.append(((p - (h + seg * u)).length, bn))
                ws = [1.0 / ((d + 0.03) ** 2.6) for d, _ in ds]
                s = sum(ws)
                for (_, bn), w in zip(ds, ws):
                    vgs[bn].add([v.index], w / s, "REPLACE")
            elif abs(x) >= core_half_x and z <= z_neck + 0.12:
                side = "L" if x >= 0.0 else "R"
                arm_names = [f"shoulder_{side}", f"upper_arm_{side}", f"forearm_{side}", f"hand_{side}"]
                segs = [(bn, mathutils.Vector(arm_data.bones[bn].head_local), mathutils.Vector(arm_data.bones[bn].tail_local)) for bn in arm_names]
                ds = []
                for bn, h, t in segs:
                    seg = t - h
                    u = max(0.0, min(1.0, (p - h).dot(seg) / max(1e-6, seg.length_squared)))
                    ds.append(((p - (h + seg * u)).length, bn))
                ws = [1.0 / ((d + 0.03) ** 2.6) for d, _ in ds]
                s = sum(ws)
                for (_, bn), w in zip(ds, ws):
                    vgs[bn].add([v.index], w / s, "REPLACE")
            elif cid in ("ozzi", "tally", "fuzz", "click") and z > z_neck + 0.03:
                # Distinct head housing / CRT tube sits rigidly on `head` (1.0)
                vgs["head"].add([v.index], 1.0, "REPLACE")
            else:
                # Single-piece chassis (latch / deck / folio / clacker) & torso boxes stay 100% rigid (weight=1.0 on chest)
                # ZERO gradient bending across pelvis/spine/chest so box geometry NEVER warps like rubber!
                vgs["chest"].add([v.index], 1.0, "REPLACE")
    else:
        # Organic/articulated characters (`gruff`, `leadsinger`): ARMATURE_AUTO + csw.clean_mesh + rigid head
        try:
            bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        except Exception:
            bpy.ops.object.parent_set(type="ARMATURE_NAME")
        arm_names = ("shoulder_L", "upper_arm_L", "forearm_L", "hand_L", "shoulder_R", "upper_arm_R", "forearm_R", "hand_R")
        arm_gids = {mesh_obj.vertex_groups[n].index for n in arm_names if n in mesh_obj.vertex_groups}
        head_vg = mesh_obj.vertex_groups.get("head")
        if head_vg and arm_gids:
            for v in mesh_obj.data.vertices:
                if v.co.z > z_neck + 0.04 and abs(v.co.x) < sh_x + 0.10:
                    for g in list(v.groups):
                        if g.group in arm_gids and g.weight > 0:
                            mesh_obj.vertex_groups[g.group].remove([v.index])
                    head_vg.add([v.index], 1.0, "REPLACE")
        changed = csw.clean_mesh(mesh_obj, arm_obj, max_hops=4)
        print(f"[{cid}] csw.clean_mesh fixed {changed} vertices")

    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)

    face_pts = coords[(coords[:, 2] >= z_neck + 0.04) & (coords[:, 2] <= z_head_top - 0.05) & (np.abs(coords[:, 0]) < 0.16)]
    front_y = float(np.percentile(face_pts[:, 1], 5)) if len(face_pts) > 8 else -0.10
    mount = bpy.data.objects.new("moppet_face_mount", None)
    mount.empty_display_type = "PLAIN_AXES"
    mount.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(mount)
    mount.parent = arm_obj
    mount.parent_type = "BONE"
    mount.parent_bone = "head"
    mount.matrix_world = mathutils.Matrix.Translation((0.0, front_y - 0.01, (z_neck + 0.05 + z_head_top) * 0.52))
    return arm_obj


def sanitize_all_actions_no_scale_or_bad_loc(arm_obj):
    bones = arm_obj.data.bones
    rest_lens = {b.name: float(b.head_local.length) for b in bones}
    for act in list(bpy.data.actions):
        for bag in getattr(act, "layers", []):
            for strip in getattr(bag, "strips", []):
                for cb in getattr(strip, "channelbags", []):
                    for fc in list(cb.fcurves):
                        dp = fc.data_path
                        if dp.endswith(".scale"):
                            cb.fcurves.remove(fc)
                            continue
                        if dp.endswith(".location") and 'pose.bones["' in dp:
                            bn = dp.split('pose.bones["', 1)[1].split('"]', 1)[0]
                            if bn != "pelvis":
                                cb.fcurves.remove(fc)
                            else:
                                max_lim = 0.42 * max(0.05, rest_lens.get(bn, 0.30))
                                for kp in fc.keyframe_points:
                                    kp.co.y = max(-max_lim, min(max_lim, kp.co.y))


def retarget_fbx_onto_arm(cid: str, arm_obj, fbx_path: Path, clip_name: str, arm_slerp=0.65, max_frames=56, step=3, hip_gain=0.30):
    scene = bpy.context.scene
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = None
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()

    dst_rest_w = {b.name: (arm_obj.matrix_world.to_3x3() @ b.matrix_local.to_3x3()).normalized() for b in arm_obj.data.bones}
    dst_hip_z = max(0.1, (arm_obj.matrix_world @ arm_obj.data.bones["pelvis"].head_local).z)

    before_objs = set(bpy.data.objects.keys())
    before_acts = set(bpy.data.actions.keys())
    bpy.ops.import_scene.fbx(filepath=str(fbx_path))
    new_objs = [bpy.data.objects[k] for k in set(bpy.data.objects.keys()) - before_objs]
    new_acts = [bpy.data.actions[k] for k in set(bpy.data.actions.keys()) - before_acts]
    src_arm = next(o for o in new_objs if o.type == "ARMATURE")

    src_act = src_arm.animation_data.action if src_arm.animation_data else None
    src_slot = src_arm.animation_data.action_slot if src_arm.animation_data else None
    f0, f1 = src_act.frame_range if src_act else (1, 60)
    if src_arm.animation_data:
        src_arm.animation_data.action = None
    bpy.context.view_layer.update()

    src_rest_w = {b.name: (src_arm.matrix_world.to_3x3() @ b.matrix_local.to_3x3()).normalized() for b in src_arm.data.bones}
    src_hip_name = "mixamorig:Hips" if "mixamorig:Hips" in src_arm.data.bones else src_arm.data.bones[0].name
    src_hip_z = max(0.1, (src_arm.matrix_world @ src_arm.data.bones[src_hip_name].head_local).z)
    hip_scale = dst_hip_z / src_hip_z

    if src_arm.animation_data and src_act:
        src_arm.animation_data.action = src_act
        if src_slot:
            src_arm.animation_data.action_slot = src_slot

    if clip_name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[clip_name])
    dst_act = bpy.data.actions.new(name=clip_name)
    dst_slot = dst_act.slots.new(id_type="OBJECT", name=arm_obj.name)
    arm_obj.animation_data.action = dst_act
    arm_obj.animation_data.action_slot = dst_slot

    bmap = {k: v for k, v in MIXAMO_TO_RIG.items() if k in src_arm.data.bones and v in arm_obj.pose.bones}
    ordered = [(sb.name, bmap[sb.name]) for sb in src_arm.data.bones if sb.name in bmap]
    is_boxy = cid in RIGID_BOX_CAST

    start_f = int(round(f0))
    end_f = min(int(round(f1)), start_f + max_frames)
    frames = list(range(start_f, end_f + 1, step))
    if frames[-1] != end_f:
        frames.append(end_f)

    ident_q = mathutils.Quaternion((1, 0, 0, 0))
    out_f = 1
    for f in frames:
        scene.frame_set(f)
        bpy.context.view_layer.update()
        for sb_name, db_name in ordered:
            spb = src_arm.pose.bones[sb_name]
            dpb = arm_obj.pose.bones[db_name]
            src_posed_w = (src_arm.matrix_world.to_3x3() @ spb.matrix.to_3x3()).normalized()
            delta_w = src_posed_w @ src_rest_w[sb_name].inverted()
            target_w = delta_w @ dst_rest_w[db_name]

            if dpb.parent:
                parent_posed_w = (arm_obj.matrix_world.to_3x3() @ dpb.parent.matrix.to_3x3()).normalized()
                rest_rel = arm_obj.data.bones[dpb.parent.name].matrix_local.to_3x3().inverted() @ arm_obj.data.bones[db_name].matrix_local.to_3x3()
                local_m = rest_rel.inverted() @ (parent_posed_w.inverted() @ target_w)
            else:
                rest_m = (arm_obj.matrix_world.to_3x3() @ arm_obj.data.bones[db_name].matrix_local.to_3x3()).normalized()
                local_m = rest_m.inverted() @ target_w
            dpb.rotation_mode = "QUATERNION"
            q = local_m.to_quaternion()
            if db_name == "head":
                q = ident_q.slerp(q, 0.55)
            elif db_name in ("spine", "chest") and is_boxy:
                q = ident_q.slerp(q, 0.30)
            elif ("arm" in db_name or "shoulder" in db_name) and arm_slerp < 0.99:
                q = ident_q.slerp(q, arm_slerp)
            dpb.rotation_quaternion = q
            dpb.keyframe_insert(data_path="rotation_quaternion", frame=out_f)

            if db_name == "pelvis":
                src_disp = (src_arm.matrix_world @ spb.head) - (src_arm.matrix_world @ src_arm.data.bones[sb_name].head_local)
                scaled_disp = src_disp * hip_scale * hip_gain
                scaled_disp.x = 0.0
                scaled_disp.y = 0.0
                loc = dst_rest_w[db_name].inverted() @ scaled_disp
                dpb.location = (max(-0.08, min(0.08, loc.x)), max(-0.08, min(0.08, loc.y)), max(-0.08, min(0.08, loc.z)))
                dpb.keyframe_insert(data_path="location", frame=out_f)
        bpy.context.view_layer.update()
        out_f += step

    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in new_acts:
        if a.users == 0:
            bpy.data.actions.remove(a)
    arm_obj.animation_data.action = None
    return dst_act.name


def load_tabby_core_actions():
    bpy.context.scene.render.fps = 30
    before = set(bpy.data.actions.keys())
    before_objs = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=str(TABBY_GLB))
    new_objs = [bpy.data.objects[k] for k in set(bpy.data.objects.keys()) - before_objs]
    kept = {}
    for cname in ("idle", "sing", "walk", "jump", "spin", "bow"):
        act = bpy.data.actions.get(cname)
        if act:
            cp = act.copy()
            cp.name = f"core_{cname}"
            cp.use_fake_user = True
            kept[cname] = cp
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for k in set(bpy.data.actions.keys()) - before - {a.name for a in kept.values()}:
        a = bpy.data.actions.get(k)
        if a and a.users == 0:
            bpy.data.actions.remove(a)
    return kept


def stash_all_clips(arm_obj, clip_names):
    arm_obj.animation_data_create()
    while len(arm_obj.animation_data.nla_tracks) > 0:
        arm_obj.animation_data.nla_tracks.remove(arm_obj.animation_data.nla_tracks[0])
    for cname in clip_names:
        act = bpy.data.actions.get(cname)
        if not act:
            continue
        if not act.slots:
            act.slots.new(id_type="OBJECT", name=arm_obj.name)
        trk = arm_obj.animation_data.nla_tracks.new()
        trk.name = cname
        f0, f1 = act.frame_range
        st = trk.strips.new(cname, int(round(f0)), act)
        st.action_slot = act.slots[0]
        trk.mute = True
    arm_obj.animation_data.action = None


def rebuild_one(cid: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    core_acts = load_tabby_core_actions()

    raw_glb = RAW_DIR / f"{cid}_colab.glb"
    bpy.ops.import_scene.gltf(filepath=str(raw_glb))
    for o in list(bpy.data.objects):
        if o.type in ("CAMERA", "LIGHT") or o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o, do_unlink=True)
    downscale_images(768)
    mesh_obj = join_and_normalize_mesh(cid)
    arm_obj = build_symmetric_rigid_armature(cid, mesh_obj)

    for cname, src_a in core_acts.items():
        if cname in bpy.data.actions:
            bpy.data.actions.remove(bpy.data.actions[cname])
        cp = src_a.copy()
        cp.name = cname
        cp.use_fake_user = False
        if cp.slots:
            try:
                cp.slots[0].name_display = arm_obj.name
            except Exception:
                pass
        else:
            cp.slots.new(id_type="OBJECT", name=arm_obj.name)
        bpy.data.actions.remove(src_a)

    arm_slerp = 0.45 if cid in ("latch", "moonbell") else 0.65
    retarget_specs = [
        ("dance", "dancing.fbx", 60),
        ("cheer", "cheering.fbx", 56),
        ("clap", "clapping.fbx", 48),
        ("wave", "waving.fbx", 28),
    ] + JOBS[cid]
    for cname, fname, mf in retarget_specs:
        retarget_fbx_onto_arm(cid, arm_obj, MIX_DIR / fname, cname, arm_slerp=arm_slerp, max_frames=mf, step=3, hip_gain=0.30)

    sanitize_all_actions_no_scale_or_bad_loc(arm_obj)
    all_names = ["idle", "sing", "walk", "jump", "spin", "bow", "dance", "cheer", "clap", "wave"] + [c[0] for c in JOBS[cid]]
    stash_all_clips(arm_obj, all_names)

    # Reset pose
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)

    glb_out = PUBLIC_CAST / cid / f"{cid}-3d.glb"
    glb_out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type in ("ARMATURE", "MESH", "EMPTY") and not o.name.startswith("Icosphere"):
            o.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=str(glb_out),
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
    BACKUP_V4.mkdir(parents=True, exist_ok=True)
    shutil.copy2(glb_out, BACKUP_V4 / glb_out.name)
    print(f"[{cid}] rigid-rebuilt -> {glb_out.name} ({glb_out.stat().st_size / 1e6:.2f} MB)")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--cast", required=True)
    args = ap.parse_args(argv)
    for cid in [c.strip() for c in args.cast.split(",") if c.strip()]:
        if cid not in JOBS:
            raise ValueError(f"Unknown Colab rig id: {cid}")
        rebuild_one(cid)


if __name__ == "__main__":
    main()
