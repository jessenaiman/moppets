import {useState} from 'react';
import {useMoppet} from '../choir/store';
import cast from '../rehearsal/cast.json';

const bench='https://flow.google.com/project/3102c6e1-22d8-49b0-abdf-6496f5819190/tool/909ac37d-ce3e-4beb-aa19-511cad96089d';
const auditions:Record<string,string>={moonbeam:'borrowed-light',cue:'line',neon:'take-two',tabby:'tabby-solo',chip:'one-more-thing',watt:'every-socket',clank:'late-answer',gruff:'close-up',zap:'zap'};
export function CastReferences(){
  const setLesson=useMoppet(state=>state.setLesson);
  const [id,setId]=useState('cue'), [sheet,setSheet]=useState('staged-front');
  const person=cast.find(c=>c.id===id)!,base='/rehearsal/cast/'+id+'/';
  return <section className="cast-reference" aria-label="Character bible">
    <div><label>Character <select aria-label="Character" value={id} onChange={e=>{setId(e.target.value);setSheet("staged-front")}}>{cast.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
      <label>Sheet <select aria-label="Sheet" value={sheet} onChange={e=>setSheet(e.target.value)}>
        <option value="staged-front">Staging pose</option>{id==="tabby"&&<option value="front-reference">Ear construction</option>}{id!=="amplifier"&&<><option value="turnaround">Turnaround</option><option value="exposures">Rehearsal exposures</option><option value="sprites">Sprite reference</option><option value="storyboard">Storyboard</option></>}
      {id==="cue"&&<><option value="expressions">Singing expressions</option><option value="parts">Body and props</option><option value="stage-props">Stage plate and loose props</option></>}
      </select></label> {id==="cue"&&<a href={base+"rig.json"} download>Rig manifest · 15 pins</a>} <a href={bench} target="_blank" rel="noreferrer">Cue &amp; Neon Bench ↗</a> · <a href="https://flow.google.com/project/3102c6e1-22d8-49b0-abdf-6496f5819190/tool/33f56ca7-1558-436e-9e35-2b9c41b20c9b" target="_blank" rel="noreferrer">Character Bible Workshop ↗</a></div>
    <a href={base+sheet+'.webp'} target="_blank" rel="noreferrer"><img src={base+sheet+'.webp'} alt={person.name+' '+sheet}/></a>
    <h3>{person.name} · {person.role}</h3>{auditions[id]&&<button onClick={()=>setLesson(auditions[id])}>Rehearse {person.name}’s solo</button>}<p>{person.identity}</p>
    <p><strong>{person.expressiveFeatures.join(" · ")}</strong><br/>{person.actingDirection}</p>
    {["gruff","amplifier","click","thrum","clacker"].includes(id)&&<a href="/rehearsal/band/house-band.webp" target="_blank" rel="noreferrer">House band stage reference</a>}
    <ol>{person.beats.map(beat=><li key={beat}>{beat}</li>)}</ol>
    <details><summary>Image prompt and source notes</summary><p>{person.prompt}</p><p>{person.note}</p><a href={base+'bible.md'} download>Download bible</a></details>
  </section>;
}
