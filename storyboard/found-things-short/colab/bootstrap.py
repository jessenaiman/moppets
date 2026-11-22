"""Run on the dedicated Colab GPU via colab exec. Comfy stays on the VM loopback interface."""
import concurrent.futures,os,pathlib,subprocess,sys
from huggingface_hub import hf_hub_download
root=pathlib.Path('/content/ComfyUI')
if not root.exists():subprocess.run(['git','clone','--quiet','--depth','1','https://github.com/Comfy-Org/ComfyUI.git',str(root)],check=True)
models={'diffusion_models':'wan2.2_ti2v_5B_fp16.safetensors','vae':'wan2.2_vae.safetensors','text_encoders':'umt5_xxl_fp8_e4m3fn_scaled.safetensors'}
def fetch(item):
 group,name=item;f=hf_hub_download('Comfy-Org/Wan_2.2_ComfyUI_Repackaged','split_files/'+group+'/'+name)
 dest=root/'models'/group/name
 if not dest.exists():dest.symlink_to(f)
 print('Ready:',name,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 downloads=[pool.submit(fetch,m) for m in models.items()]
 subprocess.run([sys.executable,'-m','pip','install','--quiet','-r',str(root/'requirements.txt')],check=True)
 for job in downloads:job.result()
with open('/content/found-comfy.log','wb') as log:
 subprocess.Popen([sys.executable,'main.py','--listen','127.0.0.1','--port','8188','--preview-method','none'],cwd=root,stdout=log,stderr=log,start_new_session=True)
print('ComfyUI launched',flush=True)
