/** Build the stock stage's vocal stems with the CHIMERA CLAP instrument in SoundCraft. */
import { existsSync } from "node:fs";
import { mkdir,rename } from "node:fs/promises";
import { initEngine } from "../tests/harness.ts";
import { instrumentPart, partKey } from "../src/choir/pluginScore.ts";
import { bouncePart } from "./plugin-host.ts";
await initEngine();
const { SONGBOOK } = await import("../src/choir/songbook.ts");
const { CAST } = await import("../src/choir/voices.ts");
const { SKITS,makeSkit } = await import("../src/choir/skits.ts");
const { makeRound,makeSolo,makeChipSong,makeTabbySong,makeGruffShanty,makeIntroduction,invent,DEFAULT_INVENTION } = await import("../src/choir/music.ts");
const { voicesForMode } = await import("../src/choir/studio404.ts");
const pieces=[...SONGBOOK.map(s=>s.make()),...SKITS.map(s=>makeSkit(s)),makeRound(),makeChipSong(),makeTabbySong(),makeGruffShanty(),invent(DEFAULT_INVENTION),
  ...[false,true].flatMap(mode=>{const voices=voicesForMode(CAST,mode);return [makeIntroduction(voices),...voices.map(v=>makeSolo(v))];})];
const folder="public/plugin-vocals";
await mkdir(folder,{recursive:true});await mkdir("out/chimera-plugin/sessions",{recursive:true});
const jobs = new Map<string,ReturnType<typeof instrumentPart>>();
for(const piece of pieces) for(const track of piece.tracks){
  if(!track.events.length)continue;
  const part=instrumentPart(piece,track,CAST.find(v=>v.id===track.id)!);
  jobs.set(await partKey(part),part);
}
const queue=[...jobs].filter(([key])=>!existsSync(folder+"/"+key+".ogg"));
console.log(queue.length,"new stems");
async function worker(){
  while(queue.length){const [key,part]=queue.shift()!;
    const out=folder+"/"+key+".ogg",temp=out+".partial.ogg";
    await bouncePart(part,temp, "out/chimera-plugin/sessions/"+key+".scraft");
    await rename(temp,out);console.log(key,part.voice,part.notes.length,queue.length,"left");
  }
}
await Promise.all(Array.from({length:6},worker));
