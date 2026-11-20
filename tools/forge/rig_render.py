# Moppet Forge (S-7): rig a TRELLIS GLB, animate clips, render 8 directions → frames for sprite sheets.
#   blender -b -P tools/forge/rig_render.py -- <glb> <out_dir> <rig.json> [--size 256] [--fps 12] [--clips idle,wave,press]
# rig.json: bones as model-space points (x right, z up, front faces -Y), measured from the cut-out.
import bpy, sys, json, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out_dir, rig_path = argv[0], argv[1], argv[2]
opt = dict(zip(argv[3::2], argv[4::2]))
SIZE = int(opt.get("--size", 256)); FPS = int(opt.get("--fps", 12))
CLIPS = opt.get("--clips", "idle,wave,press").split(",")
rig = json.load(open(rig_path))
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")

# Armature: root (turntable) → body → arms and legs.
bpy.ops.object.armature_add(location=(0, 0, 0))
arm = bpy.context.object; arm.name = "rig"
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
eb.remove(eb[0])
def bone(name, head, tail, parent=None):
    b = eb.new(name); b.head = Vector(head); b.tail = Vector(tail)
    if parent: b.parent = eb[parent]
    return b
bone("root", (0, 0, -0.5), (0, 0, -0.4))
for name, b in rig["bones"].items():
    bone(name, b["head"], b["tail"], b.get("parent", "root"))
bpy.ops.object.mode_set(mode="OBJECT")
root_free = [n for n in rig["bones"]]  # deforming bones; root does not deform
arm.data.bones["root"].use_deform = False

bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
weighted = sum(1 for g in mesh.vertex_groups)
print("RIG vertex groups:", weighted)

# Clips: keyframes as (frame, {bone: (rx, ry, rz degrees, sz scale)}).
def key(clip, frames):
    act = bpy.data.actions.new(clip); arm.animation_data_create(); arm.animation_data.action = act
    for f, poses in frames:
        for bn, (rx, ry, rz, s) in poses.items():
            pb = arm.pose.bones[bn]; pb.rotation_mode = "XYZ"
            pb.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz)); pb.scale = (1, s, 1)
            pb.keyframe_insert("rotation_euler", frame=f); pb.keyframe_insert("scale", frame=f)
    return act
C = rig["clips"]
actions = {c: key(c, [(int(f), {b: tuple(v) for b, v in poses.items()}) for f, poses in C[c]["keys"]]) for c in CLIPS}

# Camera (orthographic, front), soft key + fill light, transparent film.
sc = bpy.context.scene
# Colab has no display: Cycles on the GPU (CUDA) renders headless reliably; few samples for drafts.
sc.render.engine = "CYCLES"; sc.cycles.samples = int(opt.get("--samples", 16)); sc.cycles.use_denoising = True
if opt.get("--device", "GPU") == "GPU":
    prefs = bpy.context.preferences.addons["cycles"].preferences; prefs.compute_device_type = "CUDA"; prefs.get_devices()
    for dev in prefs.devices: dev.use = True
    sc.cycles.device = "GPU"
else:
    sc.cycles.device = "CPU"
sc.render.resolution_x = sc.render.resolution_y = SIZE
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
sc.render.fps = FPS
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.25
cam.location = (0, -3, 0.02); cam.rotation_euler = (math.radians(90), 0, 0)
for name, energy, rot in [("key", 3.0, (50, 0, -35)), ("fill", 1.2, (60, 0, 140)), ("rim", 1.5, (110, 0, 0))]:
    l = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN")); l.data.energy = energy
    l.rotation_euler = tuple(math.radians(a) for a in rot); sc.collection.objects.link(l)
sc.world = bpy.data.worlds.new("w"); sc.world.color = (0.35, 0.33, 0.3)

# Render: each clip × 8 directions (0 = front, then 45° steps turning the character to its left).
for clip in CLIPS:
    arm.animation_data.action = actions[clip]
    n = int(C[clip]["frames"])
    for d in range(8):
        arm.rotation_euler = (0, 0, math.radians(45 * d))  # turn the whole rig about the vertical axis
        for f in range(n):
            sc.frame_set(f)
            sc.render.filepath = os.path.join(out_dir, clip, f"d{d}", f"{f:03d}.png")
            bpy.ops.render.render(write_still=True)
    print("RENDERED", clip, n, "frames x 8 directions")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "rig.blend"))
