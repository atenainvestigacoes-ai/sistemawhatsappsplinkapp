import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {Store} from '../src/store.mjs';import {Engine} from '../src/engine.mjs';import {createApp} from '../src/server.mjs';
test('HTTP protege histórico, Host, Origin e aprovação humana',async()=>{
 const s=new Store(':memory:');const transport={state:'disconnected',qr:'',connected:false};const e=new Engine(s,async()=>({reply:'Oi',handoff:false,reason:''}),transport,()=>({ready:true}));e.account='a';e.receive({account:'a',jid:'1@s.whatsapp.net',mid:'1',text:'oi'});const d=await e.generate('1@s.whatsapp.net');
 const server=createApp({engine:e,transport,secret:'test-secret',listenPort:3210});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const request=(url,body,headers={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:url,method:body?'POST':'GET',headers:{Host:'localhost:3210',...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
 try{
  assert.equal((await request('/api/status')).status,401);
  assert.equal((await request('/api/login',{token:'test-secret'},{Origin:'https://evil.test'})).status,403);
  assert.equal((await request('/health',null,{Host:'evil.test'})).status,403);
  assert.equal((await request('/api/status',null,{Authorization:'Bearer test-secret'})).status,200);
  assert.equal((await request('/api/approve',{id:d.id},{Authorization:'Bearer test-secret'})).status,403);
  const login=await request('/api/login',{token:'test-secret'});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'][0].split(';')[0];assert.equal((await request('/api/approve',{id:d.id},{Cookie:cookie})).status,200);
  assert.equal(s.draft(d.id).status,'approved');
  for(let i=0;i<10;i++)assert.equal((await request('/api/login',{token:'incorrect'})).status,401);
  assert.equal((await request('/api/login',{token:'incorrect'})).status,429);
  assert.equal((await request('/data/access-token',null,{Cookie:cookie})).status,404);
 }finally{await new Promise(r=>server.close(r));s.close();}
});
