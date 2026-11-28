import {useState} from 'react';
import {fileOf,persistDraft} from '../choir/songs';
import {parseSongFile} from '../choir/songFile';
import {buildSong,SONGBOOK} from '../choir/songbook';
import {SKITS} from '../choir/skits';
import {useMoppet} from '../choir/store';
export function NewRehearsal(){
  const [title,setTitle]=useState(''),[kind,setKind]=useState('song'),[error,setError]=useState('');
  function create(){
    const name=title.trim().replace(/[\r\n]+/g,' ');if(!name)return;
    const id='draft-'+crypto.randomUUID(),m=useMoppet.getState(),who=m.voices[m.selected].id;
    const text=kind==='song'?`title: ${name}\nid: ${id}\nlead: ${who}\nkey: G major\nbpm: 108\nbacking:\nbass: none\nstage: ${who}\nfinale: "Here" on 0\n\n[verse]\n"Here we go" = 0 2 4/2 | I 4\n`:`kind: skit\nid: ${id}\ntitle: ${name}\nabout: Rehearsal draft\n\n[scene 1]\n${who}: "Your cue."\n${who==='neon'?'cue':'neon'}: "Ready."\n`;
    try{
      const f=parseSongFile(text);persistDraft(fileOf(id,f.kind),text);
      if(f.kind==='song')SONGBOOK.push({id,tab:name,song:f.song,make:()=>buildSong(f.song)});
      if(f.kind==='skit')SKITS.push(f.skit);
      m.setLesson(id);setTitle('');setError('');
    }catch(e){setError(String(e))}
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[#283542] bg-[#182028] p-2.5 text-xs text-[#F1F5F9]"
    >
      <select
        aria-label="New rehearsal type"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="rounded-md border border-[#283542] bg-[#11161C] px-2.5 py-1.5 text-xs font-semibold text-[#F1F5F9]"
      >
        <option value="song">Song</option>
        <option value="skit">Skit</option>
      </select>
      <input
        aria-label="New rehearsal title"
        placeholder="New title…"
        value={title}
        required
        onChange={(e) => setTitle(e.target.value)}
        className="min-w-[160px] flex-1 rounded-md border border-[#283542] bg-[#11161C] px-2.5 py-1.5 text-xs text-[#F1F5F9] placeholder:text-[#A8B8C8]"
      />
      <button
        type="submit"
        style={{ color: "#041A12" }}
        className="rounded-md bg-[#34D399] px-3 py-1.5 text-xs font-bold text-[#041A12] hover:bg-[#4ade80] cursor-pointer"
      >
        Create draft
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-rose-400">
          {error}
        </p>
      )}
    </form>
  );
}
