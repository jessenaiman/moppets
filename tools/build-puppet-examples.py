"""Rebuild native, editable puppet examples from the character's registered images and footage."""
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out/animation-examples'
OUT.mkdir(exist_ok=True)
FPS = 24

def run(project, commands, fresh=False):
    args = ['effectcraft-cli', '--empty'] if fresh else ['effectcraft-cli', '--project', str(project)]
    process = subprocess.run(args + ['run', '--commands', '-', '--save-as', str(project), '--json'],
                             input=json.dumps(commands), text=True, capture_output=True, check=True)
    result = json.loads(process.stdout)
    return result

def step(command, **params):
    return dict(command=command, params=params)

def comp(name, w, h, seconds):
    return step('comp.new', name=name, width=w, height=h, duration=seconds, frameRate=FPS)

def footage(path, **params):
    assert path.is_file(), path
    return [step('file.import', paths=[str(path)]), step('layer.addItem', item=path.name, **params)]

def keys(layer, path, samples):
    return [step('prop.addKey', layer=layer, path=path, time=frame/FPS, value=v) for frame,v in samples]

def ease(layer):
    return [step('keys.selectAll', layers=[layer]),step('keys.easyEase'),step('keys.deselectAll')]

def marker(frame, text):
    return step('comp.addMarker',time=frame/FPS,comment=text)

def build_tabby():
    project = OUT/'Tabby - Applause and Bow.ecproj'
    name = 'Tabby - Applause and Bow'
    data=json.loads((ROOT/'out/studio404-flow/tabby-pilot/rig.json').read_text())
    parts=ROOT/'out/tabby-solo/parts'
    steps=[comp('Reference - Ribbon and Felt',384,512,31)]
    steps+=footage(ROOT/'moppets/tabby/clips/ribbon-and-felt.webm')
    steps.append(comp(name,384,512,5))
    for part in reversed(data['parts']):
        layer=part['id']+'.png'; pivot=part['anchor']
        steps+=footage(parts/layer,anchor=pivot,position=pivot)
    # The feet remain planted. Torso, face and arms share the hip hinge.
    torso='body_torso_intact.png'
    for part in data['parts']:
        if part['id'] in ('arm_left','arm_right','head_rest','tail_ribbon'):
            steps.append(step('layer.setParent',layers=[part['id']+'.png'],parent=torso,compensate=True))
    # Palms meet high in front of the bezel. Opposed arcs break on three contacts.
    for side,sgn in [('left',1),('right',-1)]:
        layer='arm_'+side+'.png'
        steps+=keys(layer,'transform/rotation',[(f,sgn*v) for f,v in [(0,0),(8,14),(15,95),(18,97),(23,42),(30,95),(33,97),(39,40),(46,95),(49,97),(57,0),(69,-12),(85,-29),(99,-29),(115,0)]])+ease(layer)
    steps+=keys(torso,'transform/rotation',[(0,0),(60,0),(68,-5),(84,9),(99,9),(113,-2),(119,0)])+ease(torso)
    steps+=keys(torso,'transform/scale',[(0,[100,100,100]),(68,[100,100,100]),(84,[103,70,100]),(99,[103,70,100]),(115,[100,100,100])])+ease(torso)
    steps+=keys('head_rest.png','transform/rotation',[(0,0),(9,-5),(15,5),(30,-5),(46,5),(59,0),(69,8),(83,8),(98,8),(116,0)])+ease('head_rest.png')
    for f,n in [(0,'Ready'),(15,'Clap 1'),(30,'Clap 2'),(46,'Clap 3'),(68,'Bow anticipation'),(84,'Bow hold'),(115,'Recovery')]:
        steps.append(marker(f,n))
    # Three independent mesh pins along the ribbon. The outer tip trails the curl.
    layer='tail_ribbon.png'
    for xy in [(141,376),(98,362),(74,319)]:
        steps.append(step('puppet.addPin',layer=layer,kind='position',position=xy))
    run(project,steps,True)
    info=subprocess.check_output(['effectcraft-cli','--project',str(project),'exec','puppet.info','--params',json.dumps({'layer':layer}),'--json'],text=True)
    pins=json.loads(info)['meshes'][0]['pins']
    samples=[[f/FPS,x,y] for f,x,y in [(0,98,362),(10,101,353),(16,91,370),(30,105,351),(46,90,369),(60,98,362),(83,84,347),(100,87,349),(117,98,362)]]
    run(project,[step('puppet.recordPin',layer=layer,pin=pins[1]['pin'],samples=samples,start=0),
                 step('puppet.follow',layer=layer,leader=pins[1]['pin'],pins=[pins[2]['pin']],delay=.125,amount=80),step('time.set',frame=0)])
    return project

def build_moonbeam():
    project=OUT/'Moonbeam - Motion and Acting Keys.ecproj'
    base=Path('/run/media/jesse/Speedy/magic-studio-assets/output/character-animation-pack-proof/Moonbell')
    steps=[comp('Reference - native Flow motion',1280,720,8)]
    source=base/'motion/Moonbell_motion-master.mp4'
    steps+=footage(source)
    steps.append(comp('Moonbeam - Acting keys',344,384,12))
    cursor=0
    for action,seconds in [('walk-left',2),('walk-right',2),('reach',2),('jump',2),('react',2),('idle',2)]:
        steps.append(marker(cursor,action))
        frames=sorted((base/'actions'/action).glob('*_f*.png'))
        assert len(frames)==8
        for i,img in enumerate(frames):
            duration=[5,4,6,8,6,7,6,6][i]
            start=cursor/FPS;steps+=footage(img,time=start,duration=duration/FPS)
            cursor+=duration
    steps.append(comp('Moonbeam - Followspot performance',1280,720,31))
    steps+=footage(ROOT/'out/moonbeam/spot-has-feet/Borrowed-Light.mp4')
    score=json.loads((ROOT/'out/moonbeam/score.json').read_text())['piece']
    for s in score['sections']:
        steps.append(marker(round((.4+s['beat']*60/score['bpm'])*FPS),s['name']))
    steps+=[step('comp.open',comp='Moonbeam - Acting keys'),step('time.set',frame=0)]
    run(project,steps,True)
    return project

if __name__=='__main__':
    for build in (build_tabby,build_moonbeam):
        print(build(),flush=True)
