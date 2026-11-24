import { manifestForCharacter } from "../choir/characterClips";
import cast from "../rehearsal/cast.json";
import {SONGBOOK} from "../choir/songbook";

const bibles = import.meta.glob<string>("../../docs/design/bibles/*.designcraft", {
  eager:true, import:"default", query:"?url",
});

const acts: Record<string, {id:string; scene?:string}> = {
  cue:{id:"line"}, neon:{id:"take-two"}, tabby:{id:"tabby-solo"}, gruff:{id:"close-up"},
  chip:{id:"one-more-thing"}, clank:{id:"late-answer"}, watt:{id:"every-socket"}, zap:{id:"zap"},
  tracking:{id:"good-bit"}, hertz:{id:"good-bit"}, moonbeam:{id:"borrowed-light"},
  amplifier:{id:"quiet-bar",scene:"the held chord"}, click:{id:"quiet-bar",scene:"the extra tick"},
  thrum:{id:"quiet-bar",scene:"the long return"}, clacker:{id:"quiet-bar",scene:"the last key"},
  latch:{id:"latch"},
};

export function CastGallery() {
  const company = [...cast,{id:"latch",name:"Latch",role:"Talkback pedal"}];
  return <main className="min-h-screen bg-[#17110f] px-4 py-5 text-[#fff4df] sm:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold">Studio 404 cast</h1>
        <a href="?watch=take-two" className="text-sm underline">All performances</a>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {company.map(actor=>{
          const act=acts[actor.id];
          const url=new URLSearchParams({watch:act.id});
          if (act.scene) url.set("scene",act.scene);
          const bible=bibles[`../../docs/design/bibles/${actor.id}.designcraft`];
          const animations = manifestForCharacter(actor.id, true);
          const title=SONGBOOK.find(song=>song.id===act.id)?.song.title ?? act.id;
          return <article key={actor.id} className="flex flex-col overflow-hidden rounded-lg border border-[#705342] bg-[#271e19]">
            <a href={'?'+url} aria-label={`Watch ${actor.name} in ${title}`} className="block flex-1 p-3">
              <img src={`/rehearsal/cast/${actor.id}/staged-front.${actor.id==="latch"?"png":"webp"}`}
                alt="" loading="lazy" className="mx-auto aspect-square w-full object-contain"/>
              <h2 className="mt-2 text-xl font-bold">{actor.name}</h2>
              <span className="text-sm text-[#efd8a6]">▶ {title}</span>
            </a>
            {bible && <a href={bible} download={actor.id+'.designcraft'} aria-label={'Download '+actor.name+'’s DesignCraft story bible'}
              className="border-t border-[#59473d] px-3 py-2 text-xs text-[#cbd9c8] underline">DesignCraft story bible</a>}
            {animations && <details className="border-t border-[#59473d] px-3 py-2 text-xs">
              <summary className="cursor-pointer">Animation files</summary>
              <ul className="mt-2 space-y-2">
                {Object.entries(animations.clips).map(([action, url]) => url && <li key={action}>
                  <a href={url} download className="underline">{action} WebM</a>
                </li>)}
                <li><a href={`/clips/${animations.artKey}/manifest.json`} download className="underline">Clip manifest</a></li>
              </ul>
            </details>}
          </article>;
        })}
      </div>
    </div>
  </main>;
}
