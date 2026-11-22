#!/usr/bin/env python3
"""Build standalone EffectCraft project `/run/media/jesse/Speedy/Work/moppet-choir/out/neon.ecproj`
with 4 integer-period loop comps, FK Null skeleton, triangulated Puppet Meshes + Starch pins,
`paths.pointsFollowNulls`, `puppet.follow` cascade on the braided plug cord, and VectorCraft
neon halo overlay (`Screen` blend mode).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path("/run/media/jesse/Speedy/Work/moppet-choir")
PARTS = ROOT / "out" / "neon-parts"
OUT_ECPROJ = ROOT / "out" / "neon.ecproj"

FPS = 24
DUR = 2.0
W, H = 384, 512

LAYERS = [
    ("Legs_Stand", "legs_stand.png", [212, 502]),
    ("Torso_Ballast", "torso_ballast.png", [216, 326]),
    ("Arm_Left", "arm_left.png", [156, 290]),
    ("Arm_Right", "arm_right.png", [275, 292]),
    ("Head_Rest", "head_rest.png", [211, 272]),
    ("Head_Sing", "head_sing.png", [211, 272]),
    ("Neon_Rings_Glow", "neon_rings_glow.png", [211, 272]),
]


def run_ec(args: list[str]) -> dict:
    proc = subprocess.run(["effectcraft-cli", *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"effectcraft-cli {' '.join(args[:4])} failed:\n{proc.stdout}\n{proc.stderr}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"raw": proc.stdout}


def build_rig_for_comp(comp_name: str, cfg: dict, proj_flag: list[str]) -> None:
    steps: list[tuple[str, dict]] = []

    steps.append(("comp.new", {"name": comp_name, "width": W, "height": H, "frameRate": FPS, "duration": DUR, "open": True}))

    # 1. Create FK Null hierarchy bottom-to-top before adding keyframes
    for null_name, pos in [
        ("Root_Null", [212, 502]),
        ("Pelvis_Null", [216, 382]),
        ("Torso_Null", [216, 326]),
        ("Neck_Null", [211, 272]),
        ("L_Shoulder_Null", [156, 290]),
        ("R_Shoulder_Null", [275, 292]),
    ]:
        steps.append(("layer.newNull", {"name": null_name}))
        steps.append(("prop.set", {"layer": null_name, "path": "transform/position", "value": [pos[0], pos[1], 0]}))

    # 2. Parent Nulls cleanly
    steps.append(("layer.setParent", {"layers": ["Pelvis_Null"], "parent": "Root_Null", "compensate": True}))
    steps.append(("layer.setParent", {"layers": ["Torso_Null"], "parent": "Pelvis_Null", "compensate": True}))
    steps.append(("layer.setParent", {"layers": ["Neck_Null", "L_Shoulder_Null", "R_Shoulder_Null"], "parent": "Torso_Null", "compensate": True}))

    # 3. Add footage layers (keep exact layer/world alignment by matching anchor == position)
    for lname, fname, pivot in LAYERS:
        # Insert bottom to top: Legs -> Arm_Left -> Arm_Right -> Torso -> Head_Rest -> Head_Sing -> Neon_Rings_Glow
        steps.append(("layer.addItem", {"item": fname, "position": [192, 256], "index": 1}))
        steps.append(("layer.rename", {"layer": fname, "name": lname}))
        steps.append(("prop.set", {"layer": lname, "path": "transform/anchor", "value": [pivot[0], pivot[1], 0]}))
        steps.append(("prop.set", {"layer": lname, "path": "transform/position", "value": [pivot[0], pivot[1], 0]}))

    # Head visibility per comp + Screen blend mode for VectorCraft glow rings
    steps.append(("layer.setSwitch", {"layers": ["Head_Rest"], "switch": "video", "value": not cfg["sing_head"]}))
    steps.append(("layer.setSwitch", {"layers": ["Head_Sing"], "switch": "video", "value": cfg["sing_head"]}))
    steps.append(("layer.setBlendMode", {"layers": ["Neon_Rings_Glow"], "mode": "Screen"}))

    # Reorder visual stacking so Torso overlaps arm/leg sockets cleanly and Head sits on Top
    steps.append(("layer.setParent", {"layers": ["Legs_Stand"], "parent": "Root_Null", "compensate": True}))
    steps.append(("layer.setParent", {"layers": ["Arm_Left"], "parent": "L_Shoulder_Null", "compensate": True}))
    steps.append(("layer.setParent", {"layers": ["Arm_Right"], "parent": "R_Shoulder_Null", "compensate": True}))
    steps.append(("layer.setParent", {"layers": ["Torso_Ballast"], "parent": "Torso_Null", "compensate": True}))
    steps.append(("layer.setParent", {"layers": ["Head_Rest", "Head_Sing", "Neon_Rings_Glow"], "parent": "Neck_Null", "compensate": True}))

    # Apply structural build steps first so Puppet pin UIDs can be captured accurately
    cmd_args = proj_flag + ["--json", "run"]
    for cid, params in steps:
        cmd_args.extend([cid, json.dumps(params)])
    cmd_args.append("--save")
    run_ec(cmd_args)

    # 4. Add Puppet Mesh + Position + Starch pins to Arm_Left, Arm_Right, and Legs_Stand
    def add_pin(layer: str, kind: str, pos: list[float], mesh_opts: dict | None = None) -> int:
        p = {"layer": layer, "kind": kind, "position": pos}
        if mesh_opts:
            p.update(mesh_opts)
        res = run_ec(proj_flag + ["--json", "run", "puppet.addPin", json.dumps(p), "--save"])
        return int(res["result"][0]["result"]["pin"])

    # Arm Left: Position pins + Starch on shoulder
    l_p1 = add_pin("Arm_Left", "position", [156, 290], {"density": 7, "expansion": 8})
    l_p2 = add_pin("Arm_Left", "position", [124, 348])
    l_p3 = add_pin("Arm_Left", "position", [112, 412])
    l_st = add_pin("Arm_Left", "starch", [156, 290])
    run_ec(proj_flag + ["--json", "run",
        "puppet.setPin", json.dumps({"layer": "Arm_Left", "pin": l_st, "amount": 95, "extent": 32}),
        "paths.pointsFollowNulls", json.dumps({"layer": "Arm_Left", "pins": [l_p1, l_p2, l_p3]}),
        "--save"
    ])

    # Arm Right: Position pins + Starch on shoulder
    r_p1 = add_pin("Arm_Right", "position", [275, 292], {"density": 7, "expansion": 8})
    r_p2 = add_pin("Arm_Right", "position", [316, 338])
    r_p3 = add_pin("Arm_Right", "position", [346, 388])
    r_st = add_pin("Arm_Right", "starch", [275, 292])
    run_ec(proj_flag + ["--json", "run",
        "puppet.setPin", json.dumps({"layer": "Arm_Right", "pin": r_st, "amount": 95, "extent": 32}),
        "paths.pointsFollowNulls", json.dumps({"layer": "Arm_Right", "pins": [r_p1, r_p2, r_p3]}),
        "--save"
    ])

    # Legs Stand: Starch on caster pedestal & taped dowel boot + 3 Position pins along dangling AC cord
    c_p1 = add_pin("Legs_Stand", "position", [214, 392], {"density": 7, "expansion": 8})
    c_p2 = add_pin("Legs_Stand", "position", [165, 444])
    c_p3 = add_pin("Legs_Stand", "position", [46, 470])
    st1 = add_pin("Legs_Stand", "starch", [175, 420])
    st2 = add_pin("Legs_Stand", "starch", [140, 492])
    st3 = add_pin("Legs_Stand", "starch", [215, 495])
    st4 = add_pin("Legs_Stand", "starch", [286, 470])
    run_ec(proj_flag + ["--json", "run",
        "puppet.setPin", json.dumps({"layer": "Legs_Stand", "pin": st1, "amount": 98, "extent": 44}),
        "puppet.setPin", json.dumps({"layer": "Legs_Stand", "pin": st2, "amount": 98, "extent": 44}),
        "puppet.setPin", json.dumps({"layer": "Legs_Stand", "pin": st3, "amount": 98, "extent": 44}),
        "puppet.setPin", json.dumps({"layer": "Legs_Stand", "pin": st4, "amount": 98, "extent": 44}),
        "--save"
    ])

    # 5. Parent generated Arm Puppet Pin Nulls to each Arm layer BEFORE adding Null expressions/keys
    # Never rename the generated Nulls (`<Layer>: Puppet Pin N`) so pointsFollowNulls expressions stay intact!
    run_ec(proj_flag + ["--json", "run",
        "layer.setParent", json.dumps({"layers": ["Arm_Left: Puppet Pin 1", "Arm_Left: Puppet Pin 2", "Arm_Left: Puppet Pin 3"], "parent": "Arm_Left", "compensate": True}),
        "layer.setParent", json.dumps({"layers": ["Arm_Right: Puppet Pin 1", "Arm_Right: Puppet Pin 2", "Arm_Right: Puppet Pin 3"], "parent": "Arm_Right", "compensate": True}),
        "--save"
    ])

    # Animate cord root (`c_p1`) with integer-period keys (`0.0, 0.5, 1.0, 1.5, 2.0`) and cascade follow-through (`puppet.follow`)
    c_dx = cfg["cord_dx"]
    c_dy = cfg["cord_dy"]
    cord_steps: list[tuple[str, dict]] = []
    for t_s, sx, sy in [(0.0, 0.0, 0.0), (0.5, c_dx, -c_dy), (1.0, 0.0, 0.0), (1.5, -c_dx, c_dy), (2.0, 0.0, 0.0)]:
        cord_steps.append(("puppet.movePin", {"layer": "Legs_Stand", "pin": c_p1, "time": t_s, "position": [214.0 + sx, 392.0 + sy]}))
    cord_steps.append(("puppet.follow", {"layer": "Legs_Stand", "leader": c_p1, "pins": [c_p2, c_p3], "delay": cfg["cord_delay"], "amount": cfg["cord_amt"], "cascade": True}))
    c_args = proj_flag + ["--json", "run"]
    for cid, params in cord_steps:
        c_args.extend([cid, json.dumps(params)])
    c_args.append("--save")
    run_ec(c_args)

    # 6. Apply integer-period loop expressions (t in [0, 2.0) -> omega = 2*pi*cycles/2.0 = pi*cycles*time)
    expr_steps: list[tuple[str, dict]] = [
        ("prop.setExpression", {
            "layer": "Pelvis_Null",
            "path": "transform/position",
            "expression": cfg["pelvis_pos_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Torso_Null",
            "path": "transform/rotation",
            "expression": cfg["torso_rot_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Torso_Null",
            "path": "transform/scale",
            "expression": cfg["torso_scale_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Neck_Null",
            "path": "transform/rotation",
            "expression": cfg["neck_rot_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Neck_Null",
            "path": "transform/position",
            "expression": cfg["neck_pos_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "L_Shoulder_Null",
            "path": "transform/rotation",
            "expression": cfg["l_arm_rot_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "R_Shoulder_Null",
            "path": "transform/rotation",
            "expression": cfg["r_arm_rot_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Arm_Left: Puppet Pin 2",
            "path": "transform/position",
            "expression": cfg["l_elbow_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Arm_Left: Puppet Pin 3",
            "path": "transform/position",
            "expression": cfg["l_wrist_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Arm_Right: Puppet Pin 2",
            "path": "transform/position",
            "expression": cfg["r_elbow_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Arm_Right: Puppet Pin 3",
            "path": "transform/position",
            "expression": cfg["r_wrist_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Legs_Stand",
            "path": "transform/scale",
            "expression": cfg["legs_scale_expr"],
            "enabled": True,
        }),
        ("prop.setExpression", {
            "layer": "Neon_Rings_Glow",
            "path": "transform/opacity",
            "expression": cfg["glow_opacity_expr"],
            "enabled": True,
        }),
    ]
    e_args = proj_flag + ["--json", "run"]
    for cid, params in expr_steps:
        e_args.extend([cid, json.dumps(params)])
    e_args.append("--save")
    run_ec(e_args)
    print(f"Built comp {comp_name}")


def main() -> None:
    if OUT_ECPROJ.exists():
        OUT_ECPROJ.unlink()

    files = [str(PARTS / f) for f in [
        "legs_stand.png",
        "torso_ballast.png",
        "arm_left.png",
        "arm_right.png",
        "head_rest.png",
        "head_sing.png",
        "neon_rings_glow.png",
    ]]
    run_ec([
        "--empty", "--json", "run",
        "file.import", json.dumps({"paths": files}),
        "--save-as", str(OUT_ECPROJ),
    ])

    proj_flag = ["--project", str(OUT_ECPROJ)]

    comps = {
        "01_Idle_Breathe_Blink": {
            "sing_head": False,
            "pelvis_pos_expr": "[value[0], value[1] - 2.2 * Math.sin(Math.PI * time), 0]",
            "torso_rot_expr": "2.0 * Math.sin(Math.PI * time)",
            "torso_scale_expr": "[100 - 1.2 * Math.sin(Math.PI * time), 100 + 1.5 * Math.sin(Math.PI * time), 100]",
            "neck_rot_expr": "-3.2 * Math.sin(Math.PI * time - 0.3)",
            "neck_pos_expr": "[value[0], value[1] - 1.5 * Math.sin(Math.PI * time - 0.2), 0]",
            "l_arm_rot_expr": "4.5 * Math.sin(Math.PI * time - 0.4)",
            "r_arm_rot_expr": "-4.5 * Math.sin(Math.PI * time - 0.4)",
            "l_elbow_expr": "[value[0] + 2.5 * Math.sin(Math.PI * time - 0.6), value[1], 0]",
            "l_wrist_expr": "[value[0] + 5.0 * Math.sin(Math.PI * time - 0.9), value[1] - 2.0 * Math.cos(Math.PI * time), 0]",
            "r_elbow_expr": "[value[0] - 2.5 * Math.sin(Math.PI * time - 0.6), value[1], 0]",
            "r_wrist_expr": "[value[0] - 5.0 * Math.sin(Math.PI * time - 0.9), value[1] - 2.0 * Math.cos(Math.PI * time), 0]",
            "legs_scale_expr": "[100 + 0.8 * Math.sin(Math.PI * time), 100 - 1.0 * Math.sin(Math.PI * time), 100]",
            "glow_opacity_expr": "45 + 18 * (0.5 + 0.5 * Math.sin(Math.PI * time))",
            "cord_dx": 4.0, "cord_dy": 2.5, "cord_delay": 0.12, "cord_amt": 85,
        },
        "02_Sing_Viseme_Groove": {
            "sing_head": True,
            "pelvis_pos_expr": "[value[0] + 2.5 * Math.sin(Math.PI * time), value[1] + 2.0 * Math.cos(2 * Math.PI * time), 0]",
            "torso_rot_expr": "4.0 * Math.sin(Math.PI * time)",
            "torso_scale_expr": "[100 - 1.5 * Math.abs(Math.sin(Math.PI * time)), 100 + 2.0 * Math.abs(Math.sin(Math.PI * time)), 100]",
            "neck_rot_expr": "7.0 * Math.sin(Math.PI * time + 0.25)",
            "neck_pos_expr": "[value[0], value[1] - 2.2 * Math.sin(2 * Math.PI * time), 0]",
            "l_arm_rot_expr": "12.0 * Math.sin(Math.PI * time) + 3.5 * Math.sin(2 * Math.PI * time)",
            "r_arm_rot_expr": "-9.5 * Math.sin(Math.PI * time + 0.5) - 3.0 * Math.sin(2 * Math.PI * time) - 2.0",
            "l_elbow_expr": "[value[0] + 5.0 * Math.sin(Math.PI * time - 0.4), value[1] - 3.5 * Math.cos(2 * Math.PI * time), 0]",
            "l_wrist_expr": "[value[0] + 9.0 * Math.sin(Math.PI * time - 0.8), value[1] - 7.5 * Math.sin(2 * Math.PI * time - 0.3), 0]",
            "r_elbow_expr": "[value[0] - 4.0 * Math.sin(Math.PI * time - 0.4) - 2.0, value[1] - 3.5 * Math.cos(2 * Math.PI * time), 0]",
            "r_wrist_expr": "[value[0] - 8.0 * Math.sin(Math.PI * time - 0.8) - 4.0, value[1] - 7.0 * Math.sin(2 * Math.PI * time - 0.3), 0]",
            "legs_scale_expr": "[100 + 1.0 * Math.abs(Math.sin(Math.PI * time)), 100 + 2.5 * Math.abs(Math.sin(Math.PI * time)), 100]",
            "glow_opacity_expr": "68 + 30 * (0.5 + 0.5 * Math.sin(2 * Math.PI * time))",
            "cord_dx": 8.0, "cord_dy": 5.0, "cord_delay": 0.10, "cord_amt": 95,
        },
        "03_HighNote_Belt_Swing": {
            "sing_head": True,
            "pelvis_pos_expr": "[value[0] + 2.0 * Math.sin(Math.PI * time), value[1] - 2.2 + 2.0 * Math.cos(2 * Math.PI * time), 0]",
            "torso_rot_expr": "5.0 * Math.sin(Math.PI * time)",
            "torso_scale_expr": "[99.0 + 1.5 * Math.sin(2 * Math.PI * time), 104.0 - 1.5 * Math.sin(2 * Math.PI * time), 100]",
            "neck_rot_expr": "8.0 * Math.sin(Math.PI * time + 0.15) - 3.0",
            "neck_pos_expr": "[value[0], value[1] - 2.5 - 1.8 * Math.sin(2 * Math.PI * time), 0]",
            "l_arm_rot_expr": "18.0 + 9.0 * Math.sin(2 * Math.PI * time)",
            "r_arm_rot_expr": "-18.0 - 8.0 * Math.sin(2 * Math.PI * time)",
            "l_elbow_expr": "[value[0] - 6.0, value[1] - 9.0 + 3.5 * Math.sin(2 * Math.PI * time), 0]",
            "l_wrist_expr": "[value[0] - 11.0, value[1] - 16.0 + 7.0 * Math.sin(2 * Math.PI * time - 0.5), 0]",
            "r_elbow_expr": "[value[0] + 5.0, value[1] - 9.0 + 3.5 * Math.sin(2 * Math.PI * time), 0]",
            "r_wrist_expr": "[value[0] + 7.0, value[1] - 16.0 + 7.0 * Math.sin(2 * Math.PI * time - 0.5), 0]",
            "legs_scale_expr": "[99.5, 102.0 + 1.2 * Math.cos(2 * Math.PI * time), 100]",
            "glow_opacity_expr": "85 + 15 * Math.sin(4 * Math.PI * time)",
            "cord_dx": 10.0, "cord_dy": 6.5, "cord_delay": 0.08, "cord_amt": 98,
        },
        "04_Chuckle_Bounce_Freeze": {
            "sing_head": False,
            # anticipation (0..0.4s) -> 2x chuckle bounces (0.4..1.3s) -> freeze hold (1.3..1.75s) -> settle (1.75..2.0s)
            "pelvis_pos_expr": "var p=time/2.0; var y=(p<0.2?3*Math.sin(p*Math.PI/0.2):(p<0.65?-2.4*Math.abs(Math.sin((p-0.2)*Math.PI/0.225)):(p<0.85?-1.5:0))); [value[0], value[1]+y, 0]",
            "torso_rot_expr": "var p=time/2.0; p<0.2?-4*Math.sin(p*Math.PI/0.2):(p<0.65?5*Math.sin((p-0.2)*Math.PI/0.225):0)",
            "torso_scale_expr": "[100, 100 - 2.0 * Math.sin(4 * Math.PI * time), 100]",
            "neck_rot_expr": "var p=time/2.0; p<0.65?8*Math.sin((p)*Math.PI/0.22):10*(1-Math.min(1,Math.abs(p-0.75)/0.15))",
            "neck_pos_expr": "[value[0], value[1] - 2.2 * Math.abs(Math.sin(3 * Math.PI * time)), 0]",
            "l_arm_rot_expr": "9.0 * Math.sin(3 * Math.PI * time)",
            "r_arm_rot_expr": "-8.0 * Math.sin(3 * Math.PI * time)",
            "l_elbow_expr": "[value[0] + 4.0 * Math.sin(3 * Math.PI * time), value[1], 0]",
            "l_wrist_expr": "[value[0] + 7.0 * Math.sin(3 * Math.PI * time - 0.5), value[1] - 4.0 * Math.sin(3 * Math.PI * time), 0]",
            "r_elbow_expr": "[value[0] - 3.5 * Math.sin(3 * Math.PI * time), value[1], 0]",
            "r_wrist_expr": "[value[0] - 5.5 * Math.sin(3 * Math.PI * time - 0.5), value[1] - 4.0 * Math.sin(3 * Math.PI * time), 0]",
            "legs_scale_expr": "[100 + 1.5 * Math.abs(Math.sin(3 * Math.PI * time)), 100 - 1.5 * Math.abs(Math.sin(3 * Math.PI * time)), 100]",
            "glow_opacity_expr": "55 + 25 * (0.5 + 0.5 * Math.sin(3 * Math.PI * time))",
            "cord_dx": 6.5, "cord_dy": 4.0, "cord_delay": 0.09, "cord_amt": 90,
        },
    }

    for cname, cfg in comps.items():
        build_rig_for_comp(cname, cfg, proj_flag)

    print(f"Saved standalone rig -> {OUT_ECPROJ}")


if __name__ == "__main__":
    main()
