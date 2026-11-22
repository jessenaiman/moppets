/** Render the Launchkey's default pair of octaves, one native MIDI note per recording. */
import { existsSync } from "node:fs";
import { mkdir,rename } from "node:fs/promises";
import { CAST } from "../src/choir/voices.ts";
import { instrumentNote,partKey } from "../src/choir/pluginScore.ts";
import { bouncePart } from "./plugin-host.ts";
const folder="public/plugin-vocals";await mkdir(folder,{recursive:true});
const jobs=CAST.flatMap(v=>Array.from({length:49},(_,i)=>instrumentNote(v,36+i,"la")));
async function worker(){while(jobs.length){const part=jobs.shift()!, key=await partKey(part), dest=folder+"/"+key+".ogg";
  if(existsSync(dest))continue;await bouncePart(part,dest+".tmp.ogg");await rename(dest+".tmp.ogg",dest);
}}
await Promise.all(Array.from({length:5},worker));
