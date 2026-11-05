import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {unlink} from 'node:fs/promises';
import {Store} from '../src/store.mjs';import {Engine} from '../src/engine.mjs';import {createApp} from '../src/server.mjs';
test('prévia manual com anexo e intervalo não envia nem aprova campanha',async()=>{
 const s=new Store(':memory:');let sent=0;
 const transport={connected:true,state:'connected',qr:'',send:async()=>sent++,lookup:async jid=>({exists:true,jid}),canonical:async j=>j};
 const e=new Engine(s,async()=>{},transport,()=>({ready:true}));e.account='test-account';e.setMode('auto');
 const server=createApp({engine:e,transport,secret:'fixture',listenPort:3210});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;let cookie='',mediaPath='';
 const req=(url,body)=>new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port,path:url,method:'POST',headers:{Host:'localhost:3210','Content-Type':'application/json',Cookie:cookie}},res=>{let txt='';res.on('data',d=>txt+=d);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(txt),cookie:res.headers['set-cookie']}));});q.on('error',reject);q.end(JSON.stringify(body));});
 try{
  const login=await req('/api/login',{token:'fixture'});cookie=login.cookie[0].split(';')[0];
  const upload=await req('/api/attachment',{name:'teste.pdf',base64:Buffer.from('%PDF-1.4\nfixture').toString('base64')});assert.equal(upload.status,200);const id=upload.data.id;mediaPath=s.db.prepare('SELECT path FROM attachments WHERE id=?').get(id).path;
  const body={target:'manual',manual:'Cliente;+5534999999999',consent:true,text:'Teste de documento',attachment:id,intervalSec:45};
  const preview=await req('/api/campaign',body);assert.equal(preview.status,200);assert.equal(preview.data.drafts.length,1);assert.equal(preview.data.drafts[0].status,'pending');assert.equal(preview.data.drafts[0].attachment,id);assert.equal(preview.data.intervalSec,45);assert.match(preview.data.text,/SAIR/);assert.equal(sent,0);
  assert.equal((await req('/api/campaign',{...body,consent:false})).status,400);
  assert.equal((await req('/api/campaign',{...body,intervalSec:1})).status,400);
  for(let i=0;i<601;i++)s.markChat(e.account,'551198'+String(i).padStart(7,'0')+'@s.whatsapp.net');
  transport.lookup=async()=>{throw Error('Conversa já identificada pelo WhatsApp não exige consultar telefone');};
  const conversations=await req('/api/campaign',{...body,target:'conversations',attachment:''});assert.equal(conversations.status,200);assert.equal(conversations.data.recipients.length,601);assert.equal(sent,0);assert.equal(conversations.data.drafts.every(d=>d.status==='pending'),true);
  s.upsertContact(e.account,'5511977777777@s.whatsapp.net','Apenas agenda');assert.equal(s.chatContacts(e.account).some(c=>c.jid==='5511977777777@s.whatsapp.net'),false);
  e.account='another-account';assert.equal((await req('/api/campaign',body)).status,400);assert.equal(sent,0);
 }finally{await new Promise(r=>server.close(r));s.close();if(mediaPath)await unlink(mediaPath).catch(()=>{});}
});
