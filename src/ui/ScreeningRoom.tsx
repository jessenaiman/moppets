import {Player, type PlayerRef} from "@remotion/player";
import {useEffect, useMemo, useRef} from "react";
import {useMoppet} from "../choir/store";
import {buildVideoProject, totalDurationFrames} from "../choir/videoProject";
import {beatSeconds, LEAD_IN} from "../choir/timeline";
import {useEnsemble} from "../choir/ensemble";
import {MoppetComposition} from "../remotion/MoppetComposition";
import {useRehearsalTransport} from "./useRehearsalTransport";
import {buildCatalog} from "./SongNavigator";

const movies = import.meta.glob<string>("../../watch/videos/*.mp4", {eager:true, import:"default", query:"?url"});
function filmFor(id:string) {
  return movies[`../../watch/videos/${id === "found" ? "found-things-preview" : id}.mp4`];
}

function LivePerformance({id}: {id:string}) {
  const piece = useMoppet(s => s.piece);
  const voices = useMoppet(s => s.voices);
  const studio = useMoppet(s => s.studio404);
  const vocalTiming = useEnsemble(s => s.vocalTiming);
  useEffect(() => {useMoppet.getState().setLesson(id);}, [id]);
  const project = useMemo(() => {
    const video = buildVideoProject(piece, voices, studio);
    video.intro.enabled = video.outro.enabled = false;
    video.worldLens = id === "cardboard-horse" ? "caravan" : "archive";
    return {...video, vocalTiming};
  }, [piece, voices, studio, id, vocalTiming]);
  const player = useRef<PlayerRef>(null);
  const total = totalDurationFrames(project);
  const transport = useRehearsalTransport(player,true,project.fps,0,total,total,false,id);
  const scene = useRef(new URLSearchParams(window.location.search).get("scene"));
  useEffect(() => {
    if (!scene.current || piece !== useMoppet.getState().piece) return;
    const section = piece.sections?.find(s=>s.name===scene.current);
    if (!section) return;
    scene.current = null;
    transport.seekTo(Math.ceil((LEAD_IN+beatSeconds(piece)*section.beat)*project.fps));
  }, [piece, project.fps, transport]);
  const message = useEnsemble(s => s.message);
  return <>
    <Player ref={player} component={MoppetComposition} inputProps={project} fps={project.fps}
      durationInFrames={total} compositionWidth={1280} compositionHeight={720} style={{width:"100%"}}/>
    <div className="flex items-center gap-3 rounded-b-lg bg-black px-3 py-2">
      <button type="button" className="rounded border px-3 py-1" onClick={transport.toggle}>
        {transport.playing || transport.busy ? "Pause" : "Play"}
      </button>
      <input aria-label="Seek performance" type="range" className="flex-1" min={0} max={total-1}
        value={transport.frame} onChange={e=>transport.seekTo(Number(e.target.value))}/>
    </div>
    {(transport.busy || /^(Could not|No sound)/.test(message)) && <p role="status">{message}</p>}
  </>;
}

export function ScreeningRoom({id}: {id:string}) {
  const catalog = useMemo(() => buildCatalog(true), []);
  const act = catalog.find(entry => entry.id === id) ?? catalog.find(entry => entry.id === "take-two")!;
  const src = filmFor(act.id);
  return <main className="min-h-screen bg-[#17110f] px-3 py-4 text-[#fff4df] sm:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">{act.title}</h1>
        <div className="flex gap-2 text-sm underline"><a className="p-2" href="?cast">Cast</a><a className="p-2" href={'?act='+act.id}>Rehearse this act</a></div>
      </header>
      {src ? <video className="block aspect-video w-full rounded-lg bg-black" src={src}
        aria-label={act.title} controls playsInline preload="metadata"/> : <LivePerformance id={act.id}/>}
      <nav aria-label="Animated performances" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {catalog.map(item => <a key={item.id} href={'?watch='+item.id}
          aria-current={item.id === act.id ? 'page' : undefined}
          className="rounded-md border border-[#775846] px-3 py-2 aria-[current=page]:border-[#70d7b8] aria-[current=page]:bg-[#263c32]">
          <strong className="block">{item.title}</strong><small>{item.id==="found"?"Film preview":filmFor(item.id)?"Film":"Live animation"}</small>
        </a>)}
      </nav>
    </div>
  </main>;
}
