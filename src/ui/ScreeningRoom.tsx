import borrowedLight from "../../watch/videos/borrowed-light.mp4";
import foundThings from "../../watch/videos/found-things-preview.mp4";
import line from "../../watch/videos/line.mp4";
import rightOnCue from "../../watch/videos/right-on-cue.mp4";
import takeTwo from "../../watch/videos/take-two.mp4";

const films = [
  {id:"take-two", title:"Take Two", cast:"Neon", src:takeTwo},
  {id:"right-on-cue", title:"Right on Cue", cast:"Cue & Neon", src:rightOnCue},
  {id:"line", title:"Line?", cast:"Cue", src:line},
  {id:"borrowed-light", title:"Borrowed Light", cast:"Moonbeam", src:borrowedLight},
  {id:"found", title:"Found Things", cast:"Company · preview", src:foundThings},
];

export function ScreeningRoom({id}: {id:string}) {
  const film = films.find(f => f.id === id) ?? films[0];
  return <main className="min-h-screen bg-[#17110f] px-3 py-4 text-[#fff4df] sm:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">{film.title}</h1>
        <a className="rounded px-2 py-2 text-sm underline" href={'?act='+film.id}>Rehearse this act</a>
      </header>
      <video key={film.id} className="block aspect-video w-full rounded-lg bg-black" src={film.src}
        aria-label={film.title} controls playsInline preload="metadata" />
      <nav aria-label="Animated performances" className="mt-4 flex flex-wrap gap-2">
        {films.map(item => <a key={item.id} href={'?watch='+item.id}
          aria-current={item.id === film.id ? 'page' : undefined}
          className="rounded-md border border-[#775846] px-3 py-2 aria-[current=page]:border-[#70d7b8] aria-[current=page]:bg-[#263c32]">
          <strong className="block">{item.title}</strong><small>{item.cast}</small>
        </a>)}
      </nav>
    </div>
  </main>;
}
