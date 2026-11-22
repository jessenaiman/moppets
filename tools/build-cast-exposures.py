"""Build editable timelines from the actual artist exposures, retaining source frame references."""
from pathlib import Path
import importlib.util
import json
import subprocess
from functools import lru_cache
from PIL import Image

module=importlib.util.spec_from_file_location('puppets',Path(__file__).with_name('build-puppet-examples.py'))
puppets=importlib.util.module_from_spec(module)
module.loader.exec_module(puppets)
root=puppets.ROOT
out=puppets.OUT/'cast'
out.mkdir(exist_ok=True)
moon=Path('/run/media/jesse/Speedy/magic-studio-assets/output/character-animation-pack-proof/Moonbell')

@lru_cache(maxsize=4)
def video_frames(path):
    return subprocess.check_output(['ffmpeg','-v','error','-c:v','libvpx-vp9','-i',str(path),'-vf','fps=6,scale=192:256','-pix_fmt','rgba','-f','rawvideo','-'])

@lru_cache(maxsize=4)
def atlas(path):
    return Image.open(path).convert('RGBA')

def decode(source):
    filename,sep,cell=source.partition('#')
    if filename=='Neon Flow step':
        return Image.open(root/'out/duet-remotion/media/neon'/('%03d.webp'%int(cell))).convert('RGBA')
    path=root/filename
    if not sep: return Image.open(path).convert('RGBA')
    i=int(cell)
    if path.suffix=='.gif':
        with Image.open(path) as image:
            image.seek(i)
            return image.convert('RGBA')
    if path.suffix=='.webm':
        raw=video_frames(path); size=192*256*4
        return Image.frombytes('RGBA',(192,256),raw[i*size:(i+1)*size])
    image=atlas(path); w=image.width//8; h=image.height//6
    x=i%8*w; y=i//8*h
    return image.crop((x,y,x+w,y+h))

def build(actor):
    slug=actor['id']; name=actor['name']; folder=out/slug
    folder.mkdir(exist_ok=True); cast=root/'public/rehearsal/cast'/slug
    native=list(sorted((root/'public/clips'/slug).glob('*.webm')))
    if slug=='moonbeam':
        sources=[str(p) for action in ['walk-left','walk-right','reach','jump','react','idle'] for p in sorted((moon/'actions'/action).glob('*_f*.png'))]
        native=list(sorted((moon/'motion').glob('*.mp4')))
    elif slug=='click':
        sources=['public/rehearsal/band/click-rest.webp','public/rehearsal/band/click-play.webp']*4
    else:
        sources=json.loads((cast/'exposures.json').read_text())['sources']
    if slug=='zap':native=list(sorted((root/'out/forge/zap/draft').glob('*.webm')))
    if slug=='neon':native.append(root/'out/cue-locked/bench/neon-step-omni.mp4')
    images={s:decode(s) for s in dict.fromkeys(sources)}
    dims=set(i.size for i in images.values())
    width=max(w for w,h in dims);height=max(h for w,h in dims)
    frames=folder/'cels';frames.mkdir(exist_ok=True)
    tempo=6 if slug in ('click','thrum','clacker') else 3
    seconds=len(sources)*tempo/24;comp=name+' - Exposure keys';steps=[puppets.comp(comp,width,height,seconds)]
    assets={};manifest=[]
    for i,source in enumerate(sources):
        if source not in assets:
            img=images[source];path=frames/f'{slug}-{i+1:03}.png';img.save(path)
            assets[source]=path;steps.append(puppets.step('file.import',paths=[str(path)]))
        frame=i*tempo; steps.append(puppets.step('layer.addItem',item=assets[source].name,time=frame/24,duration=tempo/24))
        manifest.append(dict(source=source,frame=frame,duration=tempo,image=str(assets[source].relative_to(folder))))
    for clip in native:
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height:format=duration','-of','json',str(clip)]))
        video=probe['streams'][0];steps.append(puppets.comp(name+' - '+clip.stem,video['width'],video['height'],float(probe['format']['duration'])))
        steps+=puppets.footage(clip)
    steps.extend([puppets.step('comp.open',comp=comp),puppets.step('time.set',frame=0)])
    project=folder/(name+'.ecproj');puppets.run(project,steps,True)
    (folder/'exposures.json').write_text(json.dumps(dict(fps=24,canvas=[width,height],keys=manifest,footage=[str(p) for p in native]),indent=2))
    # Decode both ends through the actual editor.
    for frame in (0,(len(sources)-1)*tempo):
        check=folder/f'proof-{frame:03}.png'
        subprocess.run(['effectcraft-cli','--project',str(project),'render-frame','--comp',comp,'--frame',str(frame),'--transparent','--max-side','256','--out',str(check)],capture_output=True,check=True)
        assert Image.open(check).convert('RGBA').getchannel('A').getbbox(),(slug,frame)
    return f'| [{name}](cast/{slug}/{name}.ecproj) | {len(sources)} | {len(native)} |'

if __name__=='__main__':
    rows=[build(person) for person in json.loads((root/'src/rehearsal/cast.json').read_text()) if person['id']=='moonbeam' or (root/'public/rehearsal/cast'/person['id']/'exposures.json').exists()]
    (puppets.OUT/'README.md').write_text('# Studio 404 animation examples\n\n[Tabby — applause and bow](Tabby%20-%20Applause%20and%20Bow.ecproj) has three hand contacts, a planted bow, keyed shoulder and hip pivots and a three-pin cable tail with delayed follow-through. Its second composition loads the original performance video. [Moonbeam — motion and acting keys](Moonbeam%20-%20Motion%20and%20Acting%20Keys.ecproj) pairs the native Flow footage with separately retimeable exposure layers and a scored performance. In EffectCraft, drag an exposure to change a pose’s timing. Select an animated layer and reveal its keys to change a tween. Edit the cable through Puppet Mesh.\n\nThe cast timelines below use the available source art. Every pose has a separately movable in/out point. Each available local clip has its own composition at its original dimensions. Reference video and source art are linked to this workspace. Four new FMV takes from Flow can be added when downloaded.\n\n| Character project | Exposure layers | Loaded video clips |\n|---|---:|---:|\n'+'\n'.join(rows)+'\n')
