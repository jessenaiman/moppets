import type { Plugin } from "vite";
import { mkdir,readFile,rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bouncePart } from "./plugin-host.ts";
import { partKey,type InstrumentPart } from "../src/choir/pluginScore.ts";

const inflight=new Map<string,Promise<void>>();
export function pluginVocalBridge(): Plugin {
  return {name:"native-chimera-vocals", apply:"serve",configureServer(server){
    server.middlewares.use("/__plugin-vocal",async(req,res)=>{
      const fail=(status:number,message:string)=>{res.statusCode=status;res.end(message);};
      if(req.method!=="POST")return fail(405,"POST required");
      if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return fail(403,"Use the local stage");
      try {
        const chunks:Buffer[]=[];let bytes=0;
        for await(const c of req){bytes+=c.length;if(bytes>512000)return fail(413,"Part too large");chunks.push(c);}
        const part:InstrumentPart=JSON.parse(Buffer.concat(chunks).toString());
        if(!["sing","speak","play"].includes(part.mode)||part.version!==1 || typeof part.lyrics!=="string"||part.lyrics.length>16000||
          !(part.duration>0 && part.duration<=600)||!(part.bpm>=20 && part.bpm<=400)||!(part.lead>=0 && part.lead<=2)||
          !Array.isArray(part.notes)||part.notes.length>4096||!part.notes.every(n=>Array.isArray(n)&&(n.length===3||(n.length===4&&Number.isInteger(n[3])&&n[3]>=1&&n[3]<=127))&&n.every(Number.isFinite)&&n[0]>=0&&n[1]>0&&Number.isInteger(n[2])&&n[2]>=0&&n[2]<=127)||
          !/^[a-z]{1,16}$/.test(part.voice)||!part.body||!part.source ||
          ![part.body.female,part.body.child].every(v=>Number.isFinite(v)&&v>=0&&v<=1) ||
          !["breath","pressed","bright","breathy","rough"].every(k=>Number.isFinite(part.source[k as keyof typeof part.source])) ||
          Object.keys(part.source).some(k=>!["breath","pressed","bright","breathy","rough"].includes(k)) ||
          (part.artic && (Object.keys(part.artic).length>17 || !Object.values(part.artic).every(Number.isFinite))))return fail(400,"Invalid vocal part");
        const id=await partKey(part),dir="out/chimera-plugin/cache",path=join(dir,id+".ogg");
        if(!existsSync(path)){
          await mkdir(dir,{recursive:true});
          if(!inflight.has(id)){
            if(inflight.size>=12)return fail(429,"Plug-in host is busy");
            await mkdir("out/chimera-plugin/sessions",{recursive:true});
            const job=bouncePart(part,path+".partial.ogg","out/chimera-plugin/sessions/"+id+".scraft").then(()=>rename(path+".partial.ogg",path)).finally(()=>inflight.delete(id));
            inflight.set(id,job);
          }
          await inflight.get(id);
        }
        res.setHeader("Content-Type","audio/ogg");res.end(await readFile(path));
      }catch(e){fail(500,e instanceof Error?e.message.slice(0,240):"Plug-in host unavailable");}
    });
  }};
}
