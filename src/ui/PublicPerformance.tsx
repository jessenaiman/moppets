import { lazy, Suspense, memo, useEffect, useRef, useState } from "react";
import { renderWav } from "../choir/ensemble";
import { useMoppet } from "../choir/store";
import { beatSeconds, LEAD_IN } from "../choir/timeline";
import { vocalLevelAt, type VocalTiming } from "../choir/vocalTiming";
import { ShotcraftStage } from "../stage/ShotcraftStage";
import type { WorldLens } from "../stage/worlds";
import type { Piece } from "../choir/music";
import type { MoppetVoice } from "../choir/voices";
import { PerformancePicker } from "./PerformancePicker";
import { preferPlaybackSession } from "@chimera/audio/session.ts";

const Picker = memo(PerformancePicker);
const Score = memo(lazy(() => import("./PerformanceScore").then(m => ({ default: m.PerformanceScore }))));

function Performance({ piece, voices, world, setWorld }: {
  piece: Piece; voices: MoppetVoice[]; world: WorldLens; setWorld: (world: WorldLens) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [take, setTake] = useState<{ url: string; timing: VocalTiming }>();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [retry, setRetry] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setProgress(0);
    setError("");
    setTake(undefined);
    setSeconds(0);
    setPlaying(false);
    void renderWav(piece, voices, { signal: controller.signal, onProgress: value => setProgress(Math.round(value * 100)) }).then(result => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(new Blob([result.bytes], { type: "audio/wav" }));
      setTake({ url, timing: result.vocalTiming });
    }).catch(reason => {
      if (!controller.signal.aborted) setError(String(reason));
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [piece, voices, retry]);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let last = -1;
    const draw = () => {
      const t = audio.current?.currentTime ?? 0;
      const index = Math.floor(t * 30);
      if (index !== last) { last = index; setSeconds(t); }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const poses = voices.map(voice => {
    const level = vocalLevelAt(take?.timing, voice.id, seconds) ?? 0;
    return { level, open: level, singing: level > 0, viseme: level > 0 ? 4 : 0 };
  });
  return <>
    <section aria-label={piece.title} className="relative aspect-video overflow-hidden rounded-xl bg-[#211814]">
      <ShotcraftStage piece={piece} voices={voices} studio404 beat={Math.max(0,(seconds - LEAD_IN)/beatSeconds(piece))}
        timeSec={seconds} performing={playing || seconds > 0} dancing={playing} poses={poses} neonDioramaMotion
        still={window.matchMedia("(prefers-reduced-motion: reduce)").matches}
        selectedIndex={selected} onSelectActor={setSelected} interactive neonLens={world}
        onNeonLensChange={setWorld} showInternalLensBar={false} />
    </section>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold sm:text-2xl">{piece.title}</h1>
      {take ? <audio ref={audio} src={take.url} controls preload="auto" className="max-w-full grow sm:max-w-md"
        aria-label={`Play ${piece.title}`} onPointerDown={() => preferPlaybackSession()}
        onPlaying={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
        onTimeUpdate={e=>setSeconds(e.currentTarget.currentTime)} onSeeked={e=>setSeconds(e.currentTarget.currentTime)}
        onError={()=>setError("The browser could not play this performance.")}/> :
        !error && <span role="status" className="text-sm">Preparing CHIMERA audio · {progress}%</span>}
      {error && <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
    </div>
    <Picker world={world} onWorldChange={setWorld}/>
    <Suspense fallback={<p>Opening score…</p>}><Score piece={piece} timeSec={Math.floor(seconds * 12) / 12}/></Suspense>
  </>;
}

const clips = import.meta.glob<string>("../../watch/videos/*.mp4", { eager:true, query:"?url", import:"default" });
const clipNames: Record<string,string> = { "found-things-preview":"Found Things", "right-on-cue":"Right on Cue", "line":"Line?", "take-two":"Take Two", "borrowed-light":"Borrowed Light" };

export function PublicPerformance() {
  const piece = useMoppet(s=>s.piece);
  const voices = useMoppet(s=>s.voices);
  const [world,setWorld] = useState<WorldLens>("diorama");
  const [videos,setVideos] = useState(false);
  return <main className="mx-auto grid w-full max-w-[1280px] gap-3 px-3 pb-12 text-stone-100 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="font-serif text-2xl">The Moppets</span>
      <nav className="flex items-center gap-1" aria-label="Views">
        <button className="min-h-11 rounded-md px-3 aria-pressed:bg-stone-700" aria-pressed={!videos} onClick={()=>setVideos(false)}>Stage</button>
        <button className="min-h-11 rounded-md px-3 aria-pressed:bg-stone-700" aria-pressed={videos} onClick={()=>setVideos(true)}>Clips</button>
        {import.meta.env.DEV && <a className="px-3" href="/admin">Create</a>}
      </nav>
    </header>
    {videos ? <section className="grid gap-5 md:grid-cols-2" aria-label="Finished performances">{Object.entries(clips).map(([path,url])=>{
      const id=path.split("/").pop()!.replace(/\.mp4$/,"");
      return <figure key={path}><video controls playsInline preload="metadata" className="w-full rounded-lg" aria-label={clipNames[id]} src={url}/><figcaption>{clipNames[id]}</figcaption></figure>;
    })}</section> : <Performance piece={piece} voices={voices} world={world} setWorld={setWorld}/>}
  </main>;
}
