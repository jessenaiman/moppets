import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { InstrumentPart } from "../src/choir/pluginScore.ts";
import preset from "./chimera-plugin-default.json";
const exec = promisify(execFile);
const plugin = "clap:com.github.jamesondh.chimera";
export async function bouncePart(part: InstrumentPart, output: string, session?: string) {
  const dir = await mkdtemp(join(tmpdir(),"moppet-clap-"));
  try {
    const state=structuredClone(preset);
    const settings=JSON.parse(state.fields.settings);
    settings.mode=part.mode;
    settings.body=part.body;
    settings.lyrics=part.lyrics;
    if(part.artic)settings.artic=part.artic;
    settings.speech.text=part.lyrics;
    state.fields.settings=JSON.stringify(settings);
    for(const [key,value] of Object.entries({...part.source,fry:0,glide:0,vibrato:0})) {
      (state.params as Record<string,unknown>)[key]={f32:value};
    }
    const data=Buffer.from(JSON.stringify(state)),len=Buffer.alloc(8);
    len.writeBigUInt64LE(BigInt(data.length));
    const commands:string[]=[];
    const cmd=(id:string,params:unknown)=>commands.push(id+" "+JSON.stringify(params));
    cmd("event.tempo",{bpm:part.bpm});
    cmd("track.new",{kind:"instrument",instrument:plugin,name:part.voice});
    cmd("mix.insert_state",{track:1,slot:"instrument",state:Buffer.concat([len,data]).toString("base64")});
    cmd("midi.new_clip",{track:1,start:0,length:Math.ceil(48000*part.duration)});
    const lead=part.lead*part.bpm/60;
    for(const [beat,length,midi,velocity=90] of part.notes)cmd("event.midi_note",{clip:2,pitch:midi,
      start_ticks:Math.round(960*(lead+beat)),length_ticks:Math.max(1,Math.round(960*length)-1),velocity});
    const script=join(dir,"render.txt"), wav=join(dir,"voice.wav");
    await writeFile(script,commands.join("\n"));
    const env={...process.env,CLAP_PATH:[resolve("out/chimera-plugin"),process.env.CLAP_PATH].filter(Boolean).join(":")};
    const {stdout}=await exec("soundcraft-cli",["script",script,"--bounce",wav,"--end",String(part.duration),
      ...(session?["--save",session]:[])],{env,maxBuffer:8e6});
    const report=stdout.split("\n").find(l=>l.includes('"peak_db"'));
    if(!report || !Number.isFinite(JSON.parse(report).peak_db) || JSON.parse(report).peak_db < -90)throw Error("CHIMERA plug-in produced no vocal signal");
    if(output.endsWith(".wav")) await copyFile(wav,output);
    else await exec("ffmpeg",["-v","error","-y","-i",wav,"-ac","1","-c:a","libopus","-b:a","48k","-application","audio",join(dir,"stem.ogg")]).then(()=>copyFile(join(dir,"stem.ogg"),output));
  } finally { await rm(dir,{recursive:true,force:true}); }
}
