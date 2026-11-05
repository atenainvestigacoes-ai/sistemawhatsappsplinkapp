import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {root,data,runtime} from './config.mjs';

const TYPES={'.jpg':['image','image/jpeg'],'.jpeg':['image','image/jpeg'],'.png':['image','image/png'],'.mp4':['video','video/mp4'],'.pdf':['document','application/pdf'],'.txt':['document','text/plain'],'.csv':['document','text/csv'],'.doc':['document','application/msword'],'.docx':['document','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],'.xls':['document','application/vnd.ms-excel'],'.xlsx':['document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],'.ppt':['document','application/vnd.ms-powerpoint'],'.pptx':['document','application/vnd.openxmlformats-officedocument.presentationml.presentation']};
export function validateUpload(name,bytes){
 const filename=path.basename(String(name||'')).replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').slice(0,120),ext=path.extname(filename).toLowerCase(),type=TYPES[ext];
 if(!type)throw Error('Formato não permitido. Use JPEG/PNG, MP4 ou documento PDF/Office/TXT/CSV.');
 const[kind,mime]=type,limit=(kind==='image'?5:16)*1024*1024;
 if(!bytes.length||bytes.length>limit)throw Error(kind==='image'?'Imagem deve ter até 5 MB':'Vídeo/documento deve ter até 16 MB');
 const begins=hex=>bytes.subarray(0,hex.length/2).equals(Buffer.from(hex,'hex'));
 if((ext==='.jpg'||ext==='.jpeg')&&!begins('ffd8ff'))throw Error('Conteúdo não corresponde a JPEG');
 if(ext==='.png'&&!begins('89504e470d0a1a0a'))throw Error('Conteúdo não corresponde a PNG');
 if(ext==='.pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Conteúdo não corresponde a PDF');
 if(['.docx','.xlsx','.pptx'].includes(ext)&&!begins('504b0304'))throw Error('Documento Office inválido');
 if(['.doc','.xls','.ppt'].includes(ext)&&!begins('d0cf11e0a1b11e0'))throw Error('Documento Office inválido');
 if(ext==='.mp4'&&(bytes.length<12||bytes.subarray(4,8).toString()!=='ftyp'))throw Error('Conteúdo não corresponde a MP4');
 if(['.txt','.csv'].includes(ext)){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('TXT/CSV deve usar codificação UTF-8');}}
 return{filename,ext,kind,mime,size:bytes.length,hash:createHash('sha256').update(bytes).digest('hex')};
}
export function inspectVideo(file){return new Promise((resolve,reject)=>{
 const p=spawn(runtime.python,[path.join(root,'src/inspect_video.py'),file],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});let out='';const timer=setTimeout(()=>{p.kill();reject(Error('Tempo de validação do vídeo excedido'));},30000);
 p.stdout.on('data',d=>{if(out.length<4000)out+=d;});p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('MP4 precisa de vídeo H.264 e áudio AAC, quando houver áudio.'));try{resolve(JSON.parse(out));}catch{reject(Error('Não foi possível validar vídeo'));}});
});}
export async function saveUpload(store,account,{name,base64}){
 if(!account)throw Error('Conecte o WhatsApp primeiro');
 if(typeof base64!=='string'||!base64.length||base64.length>24*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)||base64.length%4)throw Error('Arquivo codificado inválido');
 const bytes=Buffer.from(base64,'base64'),meta=validateUpload(name,bytes),id=randomUUID();
 const folder=path.join(data,'outgoing-media');await mkdir(folder,{recursive:true});const file=path.join(folder,id+meta.ext);
 await writeFile(file,bytes,{flag:'wx'});
 try{if(meta.kind==='video')await inspectVideo(file);store.db.prepare('INSERT INTO attachments(id,account,path,filename,kind,mime,size,hash,created) VALUES(?,?,?,?,?,?,?,?,?)').run(id,account,file,meta.filename,meta.kind,meta.mime,meta.size,meta.hash,Date.now());}
 catch(e){await unlink(file).catch(()=>{});throw e;}
 store.log('attachment_uploaded',{id,account,filename:meta.filename,size:meta.size});return{id,...meta};
}
export async function verifiedAttachment(store,id,account){
 if(!id)return null;const a=store.db.prepare('SELECT * FROM attachments WHERE id=? AND account=?').get(id,account);
 if(!a)throw Error('Anexo inexistente ou de outra conta');const bytes=await readFile(a.path);
 if(createHash('sha256').update(bytes).digest('hex')!==a.hash)throw Error('Anexo alterado; prepare nova campanha');
 return {...a,bytes};
}
