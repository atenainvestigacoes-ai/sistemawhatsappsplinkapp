import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
test('campanha não inclui números internos da equipe',()=>{
 const s=new Store(':memory:'),jid='551190000001@s.whatsapp.net';s.upsertContact('a',jid);s.patchContact('a',jid,{consent:true});
 const e=new Engine(s,async()=>{}, {},()=>({ready:true,staffNumbers:['551190000001']}));e.account='a';assert.equal(e.campaign('Mensagem de teste',[jid]).length,0);s.close();
});
test('preparação manual não agenda envio mesmo no modo automático',async()=>{
 const s=new Store(':memory:'),jid='551100000001@s.whatsapp.net';s.upsertContact('a',jid);s.patchContact('a',jid,{allowed:true});s.ingest({account:'a',jid,mid:'1',text:'Olá'});
 const e=new Engine(s,async()=>({reply:'Como podemos ajudar?',handoff:false,reason:'teste'}),{},()=>({ready:true,text:'Base sintética'}));e.account='a';e.setMode('auto');let queued=0;e.scheduleSend=()=>queued++;
 const draft=await e.generate(jid,{queue:false});assert.equal(draft.status,'pending');assert.equal(queued,0);s.close();
});
