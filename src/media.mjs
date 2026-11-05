import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {runtime,root} from './config.mjs';
export const MAX_BYTES=15*1024*1024;
export async function saveLimited(stream,file,limit=MAX_BYTES) {
  let size=0;
  const cap=new Transform({transform(chunk,_enc,cb){size+=chunk.length;cb(size>limit?new Error('Anexo acima de 15 MB'):null,chunk);}});
  try {await pipeline(stream,cap,createWriteStream(file,{flags:'wx'}),{signal:AbortSignal.timeout(45000)});return size;}
  catch(e){await unlink(file).catch(()=>{});throw e;}
}
export async function extract(kind,file) {
 return new Promise((resolve,reject)=>{
   const proc=spawn(runtime.python,[root+'/src/transcribe.py',kind,file],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']});
   let text='',error='';const timer=setTimeout(()=>{proc.kill();reject(new Error('Tempo de processamento do anexo excedido'));},180000);
   proc.stdout.on('data',d=>{if(text.length<200000)text+=d;});proc.stderr.on('data',d=>{if(error.length<2000)error+=d;});
   proc.on('error',e=>{clearTimeout(timer);reject(e);});
   proc.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('Não consegui interpretar o anexo. Requer revisão humana.'));try{resolve(JSON.parse(text).text);}catch{reject(new Error('Extração sem conteúdo válido'));}});
 });
}
