import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';import {Engine} from '../src/engine.mjs';
import {profile,onboard,remember,listProfiles} from '../src/crm.mjs';
const account='a',jid='5511999999999@s.whatsapp.net';
test('Cliente Teste São Paulo recebe agradecimento mesmo se o modelo tentar atualizar carrinho vazio',async()=>{
 const s=new Store(':memory:');s.ingest({account,jid,mid:'1',text:'Boa tarde'});
 s.recordOutgoing(account,jid,'out','Olá! Para te atender melhor, qual seu nome e sua cidade?');
 s.ingest({account,jid,mid:'2',text:'Cliente Teste São Paulo'});
 const e=new Engine(s,async()=>({reply:'Obrigado, Cliente Teste! Como posso ajudar?',handoff:false,reason:'Cadastro',customerName:'Cliente Teste',customerCity:'São Paulo',order:{action:'set',items:[],customer:{name:'Cliente Teste',city:'São Paulo'}}}),{},()=>({ready:true,text:'Base'}));e.account=account;
 const d=await e.generate(jid);assert.match(d.text,/Obrigado/);assert.doesNotMatch(d.text,/20 itens/);assert.equal(profile(s,account,jid).city,'São Paulo');assert.equal(s.db.prepare('SELECT count(*) n FROM orders').get().n,0);s.close();
});
test('resposta ao cadastro não escala por dúvida antiga de produto',async()=>{
 const s=new Store(':memory:');s.ingest({account,jid,mid:'1',text:'Tem protetor de banco?'});
 s.recordOutgoing(account,jid,'out','Olá! Para te atender melhor, qual seu nome e sua cidade?');
 s.ingest({account,jid,mid:'2',text:'marco matias uberlandia'});
 const e=new Engine(s,async()=>({reply:'',handoff:true,reason:'Produto antigo desconhecido',customerName:'Marco Matias',customerCity:'Uberlandia'}),{},()=>({ready:true,text:'Base',handoffReply:'Aguarde o time'}));e.account=account;
 const d=await e.generate(jid);assert.doesNotMatch(d.reason,/Precisa de humano/);assert.match(d.text,/Como posso ajudar/);assert.equal(profile(s,account,jid).name,'Marco Matias');s.close();
});
test('aviso inclui número e pergunta anterior ao encaminhamento, sem duplicar',async()=>{
 const s=new Store(':memory:');s.ingest({account,jid,mid:'1',text:'Preciso de orçamento de instalação'});
 const e=new Engine(s,async()=>{}, {connected:true,lookup:async j=>({exists:true,jid:j}),canonical:async j=>j},()=>({ready:true,staffNumbers:['11990000001','11990000002']}));e.account=account;
 const d=s.createDraft(account,jid,'reply','Aguarde');s.ingest({account,jid,mid:'2',text:'Mensagem posterior'});
 await e.notifyStaff(d);await e.notifyStaff(d);
 const alerts=s.drafts(account).filter(d=>d.source==='staff');assert.equal(alerts.length,2);
 for(const alert of alerts){assert.match(alert.text,/5511999999999/);assert.match(alert.text,/Preciso de orçamento de instalação/);assert.doesNotMatch(alert.text,/Mensagem posterior/);}
 for(const timer of e.autoTimers.values())clearTimeout(timer);s.close();
});
test('novo contato recebe pergunta uma vez e nome/cidade ficam no CRM',()=>{
 const s=new Store(':memory:');s.ingest({account,jid,mid:'1',text:'Olá',name:'Nome WhatsApp'});let r=onboard(s,account,jid,s.history(account,jid));assert.match(r.reply,/nome.*cidade/);s.ingest({account,jid,mid:'2',text:'João, Uberlândia'});assert.equal(onboard(s,account,jid,s.history(account,jid)),null);const p=profile(s,account,jid);assert.equal(p.name,'João');assert.equal(p.city,'Uberlândia');assert.equal(listProfiles(s,account).length,1);assert.equal(listProfiles(s,'outra').length,0);s.close();
});
test('memória salva resumo e rejeita nome/cidade não informados pelo cliente',()=>{
 const s=new Store(':memory:');s.ingest({account,jid,mid:'1',text:'Quero uma espátula'});remember(s,account,jid,s.history(account,jid),{reply:'Temos opções',handoff:false,customerName:'Pedro',customerCity:'São Paulo',summary:'Cliente procura espátula.'});const p=profile(s,account,jid);assert.equal(p.name,'');assert.equal(p.city,'');assert.match(p.summary,/espátula/);s.close();
});
test('números internos não entram no ciclo de respostas da IA',()=>{
 const s=new Store(':memory:');s.setSetting('allow_all','true');const e=new Engine(s,async()=>{throw Error('Não deveria chamar');},{},()=>({ready:true,staffNumbers:['11990000002']}));e.account=account;e.setMode('auto');e.receive({account,jid:'551190000002@s.whatsapp.net',mid:'1',text:'Obrigado pelo aviso'});assert.equal(e.waitTimers.size,0);assert.equal(e.isStaff('5511990000002@s.whatsapp.net'),true);s.close();
});
test('somente avisos internos ainda não tentados são recuperados',()=>{
 const s=new Store(':memory:');s.upsertContact(account,jid,'Equipe');const d=s.createDraft(account,jid,'staff','Cliente aguardando');s.db.prepare("UPDATE drafts SET status='approved',queued=1 WHERE id=?").run(d.id);const uncertain=s.createDraft(account,jid,'staff','Outro');s.db.prepare("UPDATE drafts SET status='uncertain',queued=0 WHERE id=?").run(uncertain.id);const e=new Engine(s,async()=>{}, {connected:false},()=>({ready:true}));e.account=account;e.setMode('auto');assert.equal(e.autoTimers.size,1);assert.equal(e.autoTimers.has(d.id),true);for(const t of e.autoTimers.values())clearTimeout(t);s.close();
});
test('histórico antigo não altera a versão da mensagem atual',()=>{
 const s=new Store(':memory:');s.ingest({account,jid,mid:'live',text:'Agora'});const seq=s.latest(account,jid);s.recordHistorical({account,jid,mid:'old',text:'Conversa anterior',direction:'incoming',created:1});assert.equal(s.latest(account,jid),seq);assert.equal(s.history(account,jid).length,2);assert.equal(s.history(account,jid)[0].text,'Conversa anterior');s.close();
});
