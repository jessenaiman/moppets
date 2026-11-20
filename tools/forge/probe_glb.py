# Moppet Forge: print a GLB's mesh stats and bounds (blender -b -P tools/forge/probe_glb.py -- file.glb)
import bpy, sys, json
from mathutils import Vector
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
out = []
for o in bpy.context.scene.objects:
    if o.type != "MESH": continue
    ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = [min(v[i] for v in ws) for i in range(3)]; hi = [max(v[i] for v in ws) for i in range(3)]
    out.append({"name": o.name, "verts": len(o.data.vertices), "faces": len(o.data.polygons),
                "materials": [m.name for m in o.data.materials if m], "min": [round(x, 3) for x in lo], "max": [round(x, 3) for x in hi]})
print("PROBE", json.dumps(out))
