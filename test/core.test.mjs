import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
const account='account1',jid='5511999999999@s.whatsapp.net';
function setup(agent=async()=>({reply:'Olá! Como posso ajudar?',handoff:false,reason:''}),send=async()=>{}) {
 const s=new Store(':memory:');const e=new Engine(s,agent,{connected:true,send},()=>({text:'Conhecimento válido',ready:true}));e.account=account;
 const msg={account,jid,mid:'a',text:'Olá',name:'Teste'};e.receive(msg);return{s,e,msg};
}
test('deduplica por conta e conversa, ignora grupos e conta diferente',()=>{const{s,e,msg}=setup();assert.equal(e.receive(msg),false);assert.equal(e.receive({...msg,jid:'g@g.us'}),false);assert.equal(e.receive({...msg,account:'other'}),false);assert.equal(s.history(account,jid).length,1);s.close();});
test('nunca envia pausado nem sem aprovação',async()=>{const{s,e}=setup();const d=await e.generate(jid);await assert.rejects(e.send(d.id),/pausados/);e.setMode('supervised');await assert.rejects(e.send(d.id),/Aprovação/);s.close();});
test('nova mensagem invalida aprovação e impede envio antigo',async()=>{const{s,e,msg}=setup();const d=await e.generate(jid);s.approve(d.id);e.receive({...msg,mid:'b',text:'Mais uma pergunta'});e.setMode('supervised');await assert.rejects(e.send(d.id),/Aprovação|nova mensagem/);s.close();});
test('mensagem durante geração torna resultado obsoleto',async()=>{let release;const{s,e,msg}=setup(()=>new Promise(r=>release=r));const p=e.generate(jid);e.receive({...msg,mid:'b'});release({reply:'velha',handoff:false,reason:''});assert.equal((await p).status,'stale');s.close();});
test('envio duplicado e concorrente não chegam duas vezes ao transporte',async()=>{let sends=0;const{s,e}=setup(undefined,async()=>{sends++});const d=await e.generate(jid);s.approve(d.id);e.setMode('supervised');await e.send(d.id);e.lastSend=0;await assert.rejects(e.send(d.id));assert.equal(sends,1);s.close();});
test('falha de envio é incerta e não pode ser repetida',async()=>{const{s,e}=setup(undefined,async()=>{throw Error('timeout')});const d=await e.generate(jid);s.approve(d.id);e.setMode('supervised');await assert.rejects(e.send(d.id),/incerto/);assert.equal(s.draft(d.id).status,'uncertain');e.lastSend=0;await assert.rejects(e.send(d.id),/Aprovação/);s.close();});
test('cancelamento bloqueia campanha preparada anteriormente',async()=>{const{s,e,msg}=setup();s.patchContact(account,jid,{consent:true});const[d]=e.campaign('Oferta');s.approve(d.id);e.receive({...msg,mid:'b',text:'PARAR'});e.setMode('supervised');await assert.rejects(e.send(d.id),/cancelado/);assert.equal(e.campaign('Outra').length,0);s.close();});
test('consentimento de campanha rechecado no envio',async()=>{const{s,e}=setup();assert.equal(e.campaign('Oferta').length,0);s.patchContact(account,jid,{consent:true});const[d]=e.campaign('Oferta');s.approve(d.id);s.patchContact(account,jid,{consent:false});e.setMode('supervised');await assert.rejects(e.send(d.id),/Consentimento/);s.close();});
test('handoff não é enviado automaticamente',async()=>{let count=0;const{s,e}=setup(async()=>({reply:'',reason:'precisa humano',handoff:true}),async()=>count++);s.patchContact(account,jid,{allowed:true});e.setMode('auto');const d=await e.generate(jid);assert.equal(d.status,'handoff');assert.equal(count,0);s.close();});
