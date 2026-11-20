# Moppet Forge: one image per character -> TRELLIS GLB + turntable preview, via the trellis-community Space.
# python trellis_batch.py <in_dir> <out_dir> name1 name2 ...   (reads <in_dir>/<name>.png)
import sys, os, shutil, time
from gradio_client import Client, handle_file
src, dst, names = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(dst, exist_ok=True)
for n in names:
    t = time.time()
    try:
        c = Client("trellis-community/TRELLIS", verbose=False); c.predict(api_name="/start_session")
        r = c.predict(image=handle_file(f"{src}/{n}.png"), multiimages=[], seed=0, ss_guidance_strength=7.5,
                      ss_sampling_steps=12, slat_guidance_strength=3.0, slat_sampling_steps=12,
                      multiimage_algo="stochastic", mesh_simplify=0.95, texture_size=1024, api_name="/generate_and_extract_glb")
        for item in r:
            p = item.get("video") if isinstance(item, dict) else item
            if isinstance(p, str) and os.path.exists(p): shutil.copy(p, f"{dst}/{n}{os.path.splitext(p)[1]}")
        print(f"OK {n} {time.time()-t:.0f}s", flush=True)
    except Exception as e:
        print(f"FAIL {n}: {e}", flush=True)
print("DONE", flush=True)
