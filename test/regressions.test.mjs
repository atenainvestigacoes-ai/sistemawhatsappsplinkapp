import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';import {Engine} from '../src/engine.mjs';
const account='a',jid='1@s.whatsapp.net';
function setup(agent=async()=>({reply:'Olá',handoff:false,reason:''}),send=async()=>{}){const s=new Store(':memory:');const e=new Engine(s,agent,{connected:true,send},()=>({text:'Base',ready:true}));e.account=account;e.receive({account,jid,mid:'1',text:'oi'});return{s,e};}
test('automático aguarda intervalo sem perder a resposta nem repetir envio',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:20000});let sends=0;const{s,e}=setup(undefined,async()=>{sends++});s.patchContact(account,jid,{allowed:true});e.setMode('auto');e.lastSend=Date.now();const d=await e.generate(jid);assert.equal(sends,0);assert.equal(d.status,'pending');assert.equal(e.autoTimers.size,1);t.mock.timers.tick(10000);await new Promise(setImmediate);assert.equal(sends,1);assert.equal(s.draft(d.id).status,'sent');t.mock.timers.tick(10000);await new Promise(setImmediate);assert.equal(sends,1);s.close();
});
test('anexo anterior em processamento bloqueia geração mesmo após texto novo',async()=>{
 let calls=0;const{s,e}=setup(async()=>{calls++;return{reply:'Oi',handoff:false,reason:''}});e.receive({account,jid,mid:'2',kind:'processing',issue:'Anexo em processamento'});e.receive({account,jid,mid:'3',text:'veja acima'});const d=await e.generate(jid);assert.equal(calls,0);assert.equal(d.status,'error');assert.match(d.reason,/processamento/);s.close();
});
test('histórico inclui respostas enviadas sem invalidar versão recebida',async()=>{
 const{s,e}=setup();const latest=s.latest(account,jid);const d=await e.generate(jid);s.approve(d.id);e.setMode('supervised');await e.send(d.id);const h=s.history(account,jid);assert.equal(h.length,2);assert.equal(h[1].direction,'outgoing');assert.equal(h[1].text,'Olá');assert.equal(s.latest(account,jid),latest);s.close();
});
test('alteração da base durante geração invalida a resposta',async()=>{
 let release;const{s,e}=setup(()=>new Promise(r=>release=r));let base='antiga';e.knowledge=()=>({ready:true,text:base});const p=e.generate(jid);base='nova';release({reply:'Oi',handoff:false,reason:''});assert.equal((await p).status,'stale');s.close();
});
test('encaminhamento usa texto fixo autorizado sem enviar motivo interno',async()=>{
 const{s,e}=setup(async()=>({reply:'',handoff:true,reason:'motivo interno'}));e.knowledge=()=>({ready:true,text:'Base',handoffReply:'Fale com nosso suporte.'});const d=await e.generate(jid);assert.equal(d.status,'pending');assert.equal(d.text,'Fale com nosso suporte.');assert.equal(d.text.includes('interno'),false);s.close();
});
