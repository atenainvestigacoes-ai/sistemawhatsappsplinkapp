import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {parseManualContacts,ninthDigitAlternative,resolveRecipients} from '../src/contacts.mjs';
import {validateUpload,verifiedAttachment} from '../src/attachments.mjs';
import {Store} from '../src/store.mjs';import {Engine} from '../src/engine.mjs';import {WhatsApp} from '../src/whatsapp.mjs';
test('lista manual aceita nome opcional, duplicatas e número internacional',()=>{
 const r=parseManualContacts('Cliente;34999999999\n+5534999999999\nInternacional;+14155552671');assert.equal(r.length,2);assert.equal(r[0].jid,'5534999999999@s.whatsapp.net');assert.throws(()=>parseManualContacts('abc'));assert.throws(()=>parseManualContacts(''));
});
test('alternativa de nono dígito não depende do DDD e nunca altera fixo',()=>{
 assert.equal(ninthDigitAlternative('5511990000003@s.whatsapp.net'),'551190000003@s.whatsapp.net');
 assert.equal(ninthDigitAlternative('551198765432@s.whatsapp.net'),'5511998765432@s.whatsapp.net');
 assert.equal(ninthDigitAlternative('553433333333@s.whatsapp.net'),null);assert.equal(ninthDigitAlternative('14155552671@s.whatsapp.net'),null);
});
test('consulta corrige só após confirmação e deduplica destino',async()=>{
 const original='5511990000003@s.whatsapp.net',resolved='551190000003@s.whatsapp.net';let calls=[];
 const result=await resolveRecipients([{jid:original,name:'A'},{jid:resolved,name:'B'},{jid:'553433333333@s.whatsapp.net'}],async jid=>{calls.push(jid);return{exists:jid===resolved,jid};});
 assert.equal(result.valid.length,1);assert.equal(result.valid[0].jid,resolved);assert.equal(result.valid[0].original,original);assert.equal(result.excluded.length,2);assert.equal(calls.filter(j=>j.includes('33333333')).length,1);
});
test('consulta com erro exclui e não tenta inventar um destinatário',async()=>{
 const r=await resolveRecipients([{jid:'5511990000003@s.whatsapp.net'}],async()=>{throw Error('offline')});assert.equal(r.valid.length,0);assert.equal(r.excluded.length,1);
});
test('desabilitar correção preserva consulta do número original',async()=>{
 let count=0;const r=await resolveRecipients([{jid:'5511990000003@s.whatsapp.net'}],async()=>{count++;return{exists:false}},{autoNinth:false});assert.equal(count,1);assert.equal(r.valid.length,0);
});
test('upload bloqueia extensão executável, conteúdo disfarçado e limite de imagem',()=>{
 assert.throws(()=>validateUpload('arquivo.exe',Buffer.from('x')));assert.throws(()=>validateUpload('foto.png',Buffer.from('not a png')));assert.throws(()=>validateUpload('foto.jpg',Buffer.alloc(6*1024*1024)));
 assert.equal(validateUpload('arquivo.pdf',Buffer.from('%PDF-1.4\n')).kind,'document');assert.equal(validateUpload('arquivo.csv',Buffer.from('nome;telefone')).mime,'text/csv');
});
function attachmentFixture(){const dir=mkdtempSync(path.join(tmpdir(),'splink-media-')),file=path.join(dir,'doc.pdf'),bytes=Buffer.from('%PDF-1.4\nfixture');writeFileSync(file,bytes);const s=new Store(':memory:');s.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)').run('media1','a',file,'doc.pdf','document','application/pdf',bytes.length,createHash('sha256').update(bytes).digest('hex'),Date.now());return{s,file,dir,bytes};}
test('anexo de outra conta ou alterado é recusado antes de enviar',async()=>{
 const{s,file,dir}=attachmentFixture();try{await assert.rejects(verifiedAttachment(s,'media1','b'));writeFileSync(file,'changed');await assert.rejects(verifiedAttachment(s,'media1','a'),/alterado/);}finally{s.close();rmSync(dir,{recursive:true});}
});
test('campanha envia anexo uma única vez e persiste payload/intervalo',async()=>{
 const{s,dir,bytes}=attachmentFixture();let sent=0,actual;const e=new Engine(s,async()=>{}, {connected:true,send:async(...args)=>{sent++;actual=args[3];}},()=>({ready:true}));e.account='a';s.upsertContact('a','5534999999999@s.whatsapp.net','Teste');s.patchContact('a','5534999999999@s.whatsapp.net',{consent:true});
 try{const[d]=e.campaign('Legenda',undefined,{attachment:'media1',intervalSec:42});assert.equal(d.interval_s,42);s.approve(d.id);e.setMode('supervised');await e.send(d.id);assert.equal(sent,1);assert.deepEqual(actual.bytes,bytes);e.lastSend=0;await assert.rejects(e.send(d.id));assert.equal(sent,1);}finally{s.close();rmSync(dir,{recursive:true});}
});
test('intervalo configurado controla campanha, e pausa não afeta modo do agente',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});const s=new Store(':memory:');let sent=0;const e=new Engine(s,async()=>{}, {connected:true,send:async()=>sent++},()=>({ready:true}));e.account='a';s.upsertContact('a','5534999999999@s.whatsapp.net','Teste');s.patchContact('a','5534999999999@s.whatsapp.net',{consent:true});e.setMode('auto');const[d]=e.campaign('Teste',undefined,{intervalSec:30});e.lastSend=Date.now();e.startCampaign([d.id]);t.mock.timers.tick(29999);await new Promise(setImmediate);assert.equal(sent,0);s.setSetting('campaign_paused','true');t.mock.timers.tick(1);await new Promise(setImmediate);assert.equal(sent,0);assert.equal(e.mode,'auto');s.setSetting('campaign_paused','false');t.mock.timers.tick(2000);await new Promise(setImmediate);assert.equal(sent,1);s.close();
});
test('transportes de imagem, vídeo e documento usam uma única mensagem',async()=>{
 const store=new Store(':memory:');const w=new WhatsApp(store);w.connected=true;let sent=[];w.sock={sendMessage:async(jid,content,options)=>sent.push({jid,content,options})};
 for(const kind of ['image','video','document'])await w.send('test@s.whatsapp.net','Legenda','id-'+kind,{kind,bytes:Buffer.from('test'),mime:kind==='image'?'image/png':kind==='video'?'video/mp4':'application/pdf',filename:'doc.pdf'});
 assert.equal(sent.length,3);assert.equal(sent[0].content.caption,'Legenda');assert.ok(sent[1].content.video);assert.equal(sent[2].content.fileName,'doc.pdf');store.close();
});
test('legenda longa e intervalo inválido são recusados na preparação',()=>{
 const s=new Store(':memory:');const e=new Engine(s,async()=>{}, {},()=>({ready:true}));assert.throws(()=>e.campaign('x',[],{intervalSec:2}));assert.throws(()=>e.campaign('x'.repeat(1025),[],{attachment:'m'}));s.close();
});
test('pausa durante leitura do anexo bloqueia a tentativa de rede',async()=>{
 const{s,dir}=attachmentFixture();let sent=0;const e=new Engine(s,async()=>{}, {connected:true,send:async()=>sent++},()=>({ready:true}));e.account='a';s.upsertContact('a','5534999999999@s.whatsapp.net','Teste');s.patchContact('a','5534999999999@s.whatsapp.net',{consent:true});e.setMode('supervised');
 try{const[d]=e.campaign('Legenda',undefined,{attachment:'media1'});s.approve(d.id);const p=e.send(d.id);e.setMode('paused');await assert.rejects(p,/pausados/);assert.equal(sent,0);assert.equal(s.draft(d.id).status,'approved');}finally{s.close();rmSync(dir,{recursive:true});}
});
test('cancelamento e pausa em PN bloqueiam campanha no LID correspondente',()=>{
 const s=new Store(':memory:');const pn='5534999999999@s.whatsapp.net',lid='123456789@lid';s.upsertContact('a',pn,'A');s.upsertContact('a',lid,'A');s.bindAlias('a',lid,pn);s.patchContact('a',lid,{consent:true});const d=s.createDraft('a',lid,'campaign','Teste');s.approve(d.id);s.patchContact('a',pn,{optout:true,hold:true});assert.throws(()=>s.claim(d.id,'a','out'),/cancelado/);s.patchContact('a',lid,{consent:true});assert.equal(s.suppressed('a',lid),true);assert.equal(s.contact('a',lid).optout,1);s.close();
});
test('aprovação isolada não é marcada como campanha iniciada',()=>{
 const s=new Store(':memory:');s.upsertContact('a','123@lid','A');const d=s.createDraft('a','123@lid','campaign','Teste');s.approve(d.id);assert.equal(s.draft(d.id).queued,0);s.close();
});
