import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import type {Plugin} from 'vite';

// One writable Studio per dev server. Studio chooses a free port and reports it.
export function rehearsalStudio():Plugin{
  let child:ChildProcess|null=null, starting:Promise<number>|null=null;
  function start(){
    if(starting)return starting;
    starting=new Promise<number>((ok,fail)=>{
      const proc=spawn(resolve('node_modules/.bin/remotion'),['studio','src/rehearsal/StudioEntry.tsx','--port=3470','--force-new','--no-open'],{stdio:['ignore','pipe','pipe']});
      child=proc;
      const timeout=setTimeout(()=>{proc.kill();fail(new Error('Studio startup timed out'))},30000);
      let log='';
      proc.stdout.on('data',chunk=>{
        log=(log+chunk.toString()).slice(-4096);
        const port=log.match(/Local:.*?localhost:(\d+)/);
        if(port){clearTimeout(timeout);ok(Number(port[1]))}
      });
      proc.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-4096)});
      const ended=()=>{clearTimeout(timeout);starting=null;child=null;fail(new Error('Studio exited during startup'))};
      proc.once('exit',ended);proc.once('error',ended);
    });
    return starting;
  }
  return {name:'rehearsal-studio',apply:'serve',configureServer(server){
    server.httpServer?.once('close',()=>child?.kill());
    server.middlewares.use('/__rehearsal/studio',async(req,res)=>{
      if(req.method!=='POST'||req.headers.origin!==`http://${req.headers.host}`||
        !['127.0.0.1','localhost','[::1]'].includes(new URL(req.headers.origin).hostname)){
        res.statusCode=403;res.end();return;
      }
      try{const port=await start();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({port}))}
      catch{res.statusCode=503;res.end('Rehearsal Studio unavailable')}
    });
  }};
}
