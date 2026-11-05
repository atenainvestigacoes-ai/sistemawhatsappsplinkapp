import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';import {Engine,splitReply} from '../src/engine.mjs';
import {readCatalog,stageCatalog,commitCatalog,catalogContext,catalogInteraction} from '../src/catalog.mjs';
import {campaignDetail,campaignCSV} from '../src/campaigns.mjs';
const account='a',jid='123@lid';
function product(overrides={}){return{sku:'P1',nome:'Espátula de teste',preco:29.9,estoque:5,ativo:true,descricao:'Aplicação de película',categoria:'Ferramentas',link:'',atributos:{},...overrides};}
function importRows(s,rows){const staged=stageCatalog(s,account,{source:'teste.csv',products:rows,sheets:[],sheet:'CSV',generatedSkus:0});return commitCatalog(s,account,staged.id,'replace');}
test('leitor reconhece exportação com Descrição e não inclui custos ou fornecedor',async()=>{
 const csv='ID;Código;Descrição;Preço;Estoque;Preço de custo;Fornecedor;Situação\n99;SKU-1;Espátula;29,90;-2,00;10,00;INTERNO;Ativo';
 const r=await readCatalog({name:'produtos.csv',base64:Buffer.from(csv).toString('base64')});assert.equal(r.products[0].sku,'SKU-1');assert.equal(r.products[0].preco,29.9);assert.equal(r.products[0].estoque,-2);assert.equal(JSON.stringify(r.products).includes('INTERNO'),false);assert.equal(JSON.stringify(r.products).includes('custo'),false);
});
test('leitor recusa SKU duplicado e preserva desconhecidos',async()=>{
 await assert.rejects(readCatalog({name:'a.csv',base64:Buffer.from('sku;nome;preco\n1;A;10\n1;B;20').toString('base64')}),/duplicado/);
 const r=await readCatalog({name:'a.csv',base64:Buffer.from('sku;nome;preco;estoque\n1;A;;').toString('base64')});assert.equal(r.products[0].preco,null);assert.equal(r.products[0].estoque,null);
});
test('importação é isolada por conta e invalida rascunhos antigos',()=>{
 const s=new Store(':memory:');s.upsertContact(account,jid,'Teste');const d=s.createDraft(account,jid,'reply','Valor antigo');const staged=stageCatalog(s,account,{source:'a',products:[product()],sheets:[],sheet:'CSV',generatedSkus:0});assert.throws(()=>commitCatalog(s,'b',staged.id,'replace'));const r=commitCatalog(s,account,staged.id,'replace');assert.equal(r.count,1);assert.equal(s.draft(d.id).status,'stale');assert.equal(catalogContext(s,'b',[]).products.length,0);s.close();
});
test('catálogo responde com menu somente quando pedido e seleciona produtos',()=>{
 const s=new Store(':memory:');importRows(s,[product(),product({sku:'P2',nome:'Borracha teste',estoque:0})]);
 const history=text=>[{text,direction:'incoming'}];assert.equal(catalogInteraction(s,account,jid,history('oi')),null);
 const menu=catalogInteraction(s,account,jid,history('quero conhecer o catálogo'));assert.match(menu.reply,/1\./);assert.equal(menu.reply.includes('Borracha'),false);assert.doesNotMatch(menu.reply,/wa\.me/);
 const selected=catalogInteraction(s,account,jid,history('1'));assert.match(selected.reply,/Espátula/);assert.match(selected.reply,/29,90/);
 const random=catalogInteraction(s,account,jid,history('iu'));assert.equal(random.handoff,false);assert.equal(random.reply.includes('1.'),false);s.close();
});
test('debounce espera silêncio depois da última mensagem e gera uma vez',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});const s=new Store(':memory:');s.setSetting('allow_all','true');let calls=0;const e=new Engine(s,async()=>{calls++;return{reply:'Certo',handoff:false,reason:''};},{connected:false},()=>({ready:true,text:'Base'}));e.account=account;e.setMode('auto');e.receive({account,jid,mid:'1',text:'Quero espátula'});t.mock.timers.tick(4000);e.receive({account,jid,mid:'2',text:'teflon'});t.mock.timers.tick(5999);await new Promise(setImmediate);assert.equal(calls,0);t.mock.timers.tick(1);await new Promise(setImmediate);await e.tail;assert.equal(calls,1);s.close();
});
test('partes não perdem conteúdo e nova mensagem bloqueia as restantes',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});const s=new Store(':memory:');let sent=[];const text='Produto de teste disponível. '.repeat(22);const e=new Engine(s,async()=>({reply:text,handoff:false,reason:''}),{connected:true,send:async(_j,body)=>sent.push(body)},()=>({ready:true,text:'Base'}));e.account=account;e.receive({account,jid,mid:'1',text:'Detalhes'});s.patchContact(account,jid,{allowed:true});e.setMode('auto');await e.generate(jid);assert.equal(s.drafts(account).length,3);t.mock.timers.tick(100);await new Promise(setImmediate);assert.equal(sent.length,1);e.receive({account,jid,mid:'2',text:'Outra coisa'},{schedule:false});t.mock.timers.tick(5000);await new Promise(setImmediate);assert.equal(sent.length,1);assert.equal(splitReply(text).join(' '),text.trim());s.close();
});
test('encaminhamento cria dois avisos internos sem duplicar o evento',async()=>{
 const s=new Store(':memory:');s.upsertContact(account,jid,'Cliente');const e=new Engine(s,async()=>{}, {connected:true,lookup:async j=>({exists:true,jid:j}),canonical:async j=>j},()=>({ready:true,staffNumbers:['11990000001','11990000002']}));e.account=account;const d=s.createDraft(account,jid,'reply','Aguarde');await e.notifyStaff(d);await e.notifyStaff(d);const alerts=s.db.prepare('SELECT * FROM staff_alerts').all();assert.equal(alerts.length,2);assert.equal(s.drafts(account).filter(d=>d.source==='staff').length,2);for(const timer of e.autoTimers.values())clearTimeout(timer);s.close();
});
test('cancelamento só vira final após envio iniciado terminar e relatório é seguro',()=>{
 const s=new Store(':memory:');s.upsertContact(account,jid,'=formula');const d=s.createDraft(account,jid,'campaign','Teste');s.db.prepare("INSERT INTO campaigns(id,account,title,created,state,excluded) VALUES('c',?,'Teste',?,'cancelling','[]')").run(account,Date.now());s.db.prepare("UPDATE drafts SET campaign_id='c',status='sending' WHERE id=?").run(d.id);assert.equal(campaignDetail(s,account,'c').finished,null);s.finish(d.id,'Teste','','sent');const r=campaignDetail(s,account,'c');assert.equal(r.state,'cancelled');assert.equal(r.counts.sent,1);assert.ok(r.finished);assert.match(campaignCSV(r),/'=formula/);s.close();
});

