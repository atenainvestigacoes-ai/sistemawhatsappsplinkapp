import {spawn} from 'node:child_process';
import {openSync} from 'node:fs';
import {runtime,root,data,port} from './config.mjs';
let alive=false;
try{const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1500)});const body=await r.json();alive=body.ok===true&&(body.service==='splink-codex');}catch{}
if(!alive){
 const log=openSync(data+'/server.log','a'),error=openSync(data+'/server-error.log','a');
 const child=spawn(runtime.node,['--env-file-if-exists='+root+'/.env',root+'/src/server.mjs'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,error]});
 child.unref();
 console.log('Serviço local iniciado em segundo plano.');
}else console.log('Serviço local já está ativo.');
