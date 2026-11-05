import http from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from './store.mjs';
import {Engine} from './engine.mjs';
import {codexAgent} from './agent.mjs';
import {WhatsApp} from './whatsapp.mjs';
import {root,data,token,port,knowledge} from './config.mjs';
import {parseContactsCSV,parseManualContacts,resolveRecipients} from './contacts.mjs';
import {saveUpload,verifiedAttachment} from './attachments.mjs';
import {readCatalog,stageCatalog,commitCatalog,catalogStatus} from './catalog.mjs';
import {listCampaigns,campaignDetail,campaignCSV} from './campaigns.mjs';
import {randomUUID} from 'node:crypto';
import {listProfiles,updateProfile,profile} from './crm.mjs';
import {listOrders} from './orders.mjs';

function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
export function createApp({engine,transport,secret=token,listenPort=port,getKnowledge=knowledge,saveKnowledge}={}) {
 const hosts=new Set(['localhost:'+listenPort,'127.0.0.1:'+listenPort]);
 let loginWindow=Date.now(),loginFailures=0;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; media-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try{
   if(!hosts.has(req.headers.host))return json(403,{error:'Host não permitido'});
   if(req.headers.origin&&!['http://localhost:'+listenPort,'http://127.0.0.1:'+listenPort].includes(req.headers.origin))return json(403,{error:'Origem não permitida'});
   const url=new URL(req.url,'http://localhost:'+listenPort);
   const bearer=equal(req.headers.authorization,'Bearer '+secret);
   const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
   const human=equal(cookies.session,secret);let body={};
   if(req.method==='POST'){
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(415,{error:'Use JSON'});
    const limit=url.pathname==='/api/attachment'?24*1024*1024:url.pathname==='/api/catalog/preview'?7*1024*1024:131072;
    let size=0,raw='';for await(const chunk of req){size+=chunk.length;if(size>limit)return json(413,{error:'Requisição grande demais'});raw+=chunk;}
    try{body=JSON.parse(raw||'{}');}catch{return json(400,{error:'JSON inválido'});}
   }
   if(req.method==='POST'&&url.pathname==='/api/login'){
    if(Date.now()-loginWindow>=60000){loginWindow=Date.now();loginFailures=0;}
    if(loginFailures>=10){res.setHeader('Retry-After','60');return json(429,{error:'Muitas tentativas. Aguarde um minuto.'});}
    if(!equal(body.token,secret)){loginFailures++;return json(401,{error:'Código de acesso inválido'});}
    loginFailures=0;
    res.setHeader('Set-Cookie',`session=${secret}; HttpOnly; SameSite=Strict; Path=/`);return json(200,{ok:true});
   }
   if(url.pathname==='/health')return json(200,{ok:true,service:'splink-codex'});
   const staticFiles={'/':['public/index.html','text/html; charset=utf-8'],'/app.js':['public/app.js','text/javascript; charset=utf-8'],'/style.css':['public/style.css','text/css; charset=utf-8']};
   if(req.method==='GET'&&staticFiles[url.pathname]){const[file,type]=staticFiles[url.pathname];res.writeHead(200,{'Content-Type':type});return res.end(readFileSync(path.join(root,file)));}
   if(!human&&!bearer)return json(401,{error:'Faça login no painel local'});
   if(req.method==='GET'&&url.pathname==='/api/status')return json(200,{mode:engine.mode,account:engine.account,connection:transport.state,qr:transport.qr,knowledgeReady:getKnowledge().ready,allowAll:engine.store.setting('allow_all')==='true',campaignPaused:engine.store.setting('campaign_paused')==='true',contacts:engine.store.contacts(engine.account),drafts:engine.store.drafts(engine.account),busy:engine.busy,conversationCount:engine.store.chatContacts(engine.account).length,catalog:catalogStatus(engine.store,engine.account),campaigns:listCampaigns(engine.store,engine.account),replyWait:Number(engine.store.setting('reply_wait_s','6')),replyGap:Number(engine.store.setting('reply_gap_s','3')),replySplit:engine.store.setting('reply_split','true')==='true'});
   if(req.method==='GET'&&url.pathname==='/api/campaign/detail')return json(200,campaignDetail(engine.store,engine.account,url.searchParams.get('id')));
   if(req.method==='GET'&&url.pathname==='/api/crm')return json(200,{customers:listProfiles(engine.store,engine.account)});
   if(req.method==='GET'&&url.pathname==='/api/orders')return json(200,{orders:listOrders(engine.store,engine.account)});
   if(req.method==='GET'&&url.pathname==='/api/crm/history'){
    const jid=url.searchParams.get('jid'),related=engine.store.related(engine.account,jid).map(c=>c.jid),ids=related.length?related:[jid];
    const messages=engine.store.db.prepare('SELECT direction,text,kind,created FROM messages WHERE account=? AND jid IN ('+ids.map(()=>'?').join(',')+') ORDER BY created DESC,seq DESC LIMIT 200').all(engine.account,...ids).reverse();return json(200,{profile:profile(engine.store,engine.account,jid),messages});
   }
   if(req.method==='GET'&&url.pathname==='/api/campaign/report'){
    const detail=campaignDetail(engine.store,engine.account,url.searchParams.get('id'));res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="relatorio-campanha.csv"'});return res.end(campaignCSV(detail));
   }
   if(req.method==='GET'&&url.pathname==='/api/attachment'){
    const a=await verifiedAttachment(engine.store,url.searchParams.get('id'),engine.account);if(!a)throw Error('Anexo inexistente');
    res.writeHead(200,{'Content-Type':a.mime,'Content-Disposition':`${a.kind==='document'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`});return res.end(a.bytes);
   }
   if(req.method==='GET'&&url.pathname==='/api/history')return json(200,{messages:engine.store.history(engine.account,url.searchParams.get('jid')).map(({path,...m})=>m)});
   if(req.method==='GET'&&url.pathname==='/api/knowledge'){if(!human)return json(403,{error:'Somente painel'});return json(200,getKnowledge());}
   if(req.method!=='POST')return json(404,{error:'Rota não encontrada'});
   const humanRoutes=['/api/connect','/api/disconnect','/api/relink','/api/mode','/api/contact','/api/all-contacts','/api/approve','/api/knowledge','/api/campaign','/api/campaign/start','/api/campaign/pause','/api/campaign/control','/api/import','/api/import/preview','/api/attachment','/api/catalog/preview','/api/catalog/commit','/api/reply-settings','/api/crm/update','/api/product/photo'];
   if((humanRoutes.includes(url.pathname)||['/api/staff/test','/api/chats/sync'].includes(url.pathname))&&!human)return json(403,{error:'Esta ação requer o operador no painel'});
   if(url.pathname==='/api/chats/sync'){await transport.syncChats();return json(200,{ok:true,count:engine.store.chatContacts(engine.account).length});}
   if(url.pathname==='/api/staff/test'){
    if(engine.mode==='paused'||!transport.connected)throw Error('Conecte o WhatsApp e ative os envios primeiro');
    if(!engine.store.contact(engine.account,body.jid))throw Error('Cliente não encontrado');
    const event='test-'+randomUUID();
    await engine.notifyStaff({id:event,account:engine.account,jid:body.jid,latest:engine.store.latest(engine.account,body.jid),test:true});
    return json(200,{event,alerts:engine.store.db.prepare('SELECT recipient,status,draft FROM staff_alerts WHERE event=?').all(event)});
   }
   if(url.pathname==='/api/connect'){await transport.connect();return json(200,{ok:true});}
   if(url.pathname==='/api/disconnect'){engine.setMode('paused');transport.stop();return json(200,{ok:true});}
   if(url.pathname==='/api/relink'){await transport.relink();return json(200,{ok:true});}
   if(url.pathname==='/api/mode'){engine.setMode(body.mode);return json(200,{ok:true});}
   if(url.pathname==='/api/all-contacts'){
    if(typeof body.enabled!=='boolean')throw Error('Seleção inválida');
    engine.store.setSetting('allow_all',body.enabled);
    engine.store.db.prepare('UPDATE contacts SET allowed=? WHERE account=?').run(+body.enabled,engine.account);
    engine.store.log('all_contacts',{account:engine.account,enabled:body.enabled});return json(200,{ok:true});
   }
   if(url.pathname==='/api/contact'){
    const patch={};for(const k of ['allowed','hold','consent'])if(typeof body[k]==='boolean')patch[k]=body[k];
    engine.store.patchContact(engine.account,body.jid,patch);return json(200,{ok:true});
   }
   if(url.pathname==='/api/knowledge'){
    if(typeof body.text!=='string'||body.text.length>24000)throw Error('Base deve conter até 24000 caracteres');
    if(saveKnowledge)saveKnowledge(body.text);else writeFileSync(path.join(data,'empresa.md'),body.text,'utf8');
    engine.store.db.prepare("UPDATE drafts SET status='stale' WHERE source='reply' AND status IN ('pending','approved')").run();return json(200,{ok:true});
   }
   if(url.pathname==='/api/generate'){const result=await engine.generate(body.jid,{queue:false});return json(200,result);}
   if(url.pathname==='/api/crm/update'){if(!engine.store.contact(engine.account,body.jid))throw Error('Contato não encontrado');return json(200,updateProfile(engine.store,engine.account,body.jid,body));}
   if(url.pathname==='/api/reply-settings'){
    if(!Number.isInteger(body.wait)||body.wait<3||body.wait>30||!Number.isInteger(body.gap)||body.gap<2||body.gap>10||typeof body.split!=='boolean')throw Error('Espera: 3–30s; intervalo entre partes: 2–10s');
    engine.store.setSetting('reply_wait_s',body.wait);engine.store.setSetting('reply_gap_s',body.gap);engine.store.setSetting('reply_split',body.split);return json(200,{ok:true});
   }
   if(url.pathname==='/api/catalog/preview'){
    const account=engine.account;if(!account)throw Error('Conecte o WhatsApp');const parsed=await readCatalog(body);if(engine.account!==account)throw Error('A conta mudou');return json(200,stageCatalog(engine.store,account,parsed));
   }
   if(url.pathname==='/api/catalog/commit')return json(200,commitCatalog(engine.store,engine.account,body.id,body.mode));
   if(url.pathname==='/api/product/photo'){
    const account=engine.account,sku=String(body.sku||'').trim().toLowerCase(),p=engine.store.db.prepare('SELECT * FROM products WHERE account=? AND sku=?').get(account,sku);if(!p)throw Error('Código de produto não encontrado');
    const a=await verifiedAttachment(engine.store,body.attachment,account);if(account!==engine.account)throw Error('A conta mudou');if(a?.kind!=='image')throw Error('Use foto JPEG/PNG');const record=JSON.parse(p.record);record.image_attachment=a.id;
    engine.store.db.prepare('UPDATE products SET record=?,updated=? WHERE account=? AND sku=?').run(JSON.stringify(record),Date.now(),account,sku);engine.store.setSetting('catalog_version:'+account,randomUUID());engine.store.log('product_photo',{sku,attachment:a.id});return json(200,{ok:true});
   }
   if(url.pathname==='/api/attachment')return json(200,await saveUpload(engine.store,engine.account,body));
   if(url.pathname==='/api/approve'){
    const d=engine.store.draft(body.id);if(!d||d.account!==engine.account)throw Error('Rascunho inválido');
    if(typeof body.text==='string'&&body.text!==d.text){if(d.status!=='pending')throw Error('Rascunho não editável');engine.store.finish(d.id,body.text,d.reason);}
    engine.store.approve(body.id);return json(200,{ok:true});
   }
   if(url.pathname==='/api/send'){const d=await engine.send(body.id);return json(200,d);}
   if(url.pathname==='/api/import/preview'||url.pathname==='/api/import'){
    if(!engine.account)throw Error('Conecte o WhatsApp primeiro');const rows=parseContactsCSV(body.csv);
    if(url.pathname==='/api/import/preview')return json(200,{count:rows.length,contacts:rows});
    if(body.consent!==true||typeof body.source!=='string'||!body.source.trim()||body.source.length>200)throw Error('Informe a origem da captação e confirme o consentimento');
    for(const c of rows){engine.store.upsertContact(engine.account,c.jid,c.name);engine.store.patchContact(engine.account,c.jid,{consent:true});engine.store.db.prepare('UPDATE contacts SET origin=? WHERE account=? AND jid=?').run(body.source,engine.account,c.jid);}
    engine.store.log('consented_import',{source:body.source,account:engine.account,jids:rows.map(c=>c.jid)});return json(200,{count:rows.length});
   }
   if(url.pathname==='/api/campaign'){
    const account=engine.account;if(!account||!transport.connected)throw Error('Conecte o WhatsApp antes de preparar a campanha');
    if(body.consent!==true)throw Error('Confirme que os destinatários autorizaram esta campanha');
    const interval=body.intervalSec??30;if(!Number.isInteger(interval)||interval<10||interval>3600)throw Error('Intervalo deve ser de 10 a 3600 segundos');
    const attachment=await verifiedAttachment(engine.store,body.attachment||'',account);
    if(typeof body.text!=='string'||(!body.text.trim()&&!attachment))throw Error('Escreva uma mensagem ou escolha um anexo');
    const text=body.text.trim()+'\n\nPara não receber mais mensagens, responda SAIR.';
    if(text.length>(attachment?1024:4000))throw Error(attachment?'Legenda, incluindo instrução de saída, deve ter até 1024 caracteres':'Texto, incluindo instrução de saída, deve ter até 4000 caracteres');
    let contacts=body.target==='manual'?parseManualContacts(body.manual):engine.store.contacts(account);
    if(['conversations','all'].includes(body.target))contacts=engine.store.chatContacts(account);
    else if(body.target==='external')contacts=contacts.filter(c=>c.origin!=='whatsapp');
    else if(!['all','manual'].includes(body.target))throw Error('Público inválido');
    if(contacts.length>5000)throw Error('Selecione até 5000 conversas por campanha');
    if(!contacts.length)throw Error('Nenhuma conversa sincronizada para esse público. Clique em “Sincronizar conversas do WhatsApp” e aguarde a atualização.');
    const excludedRecipient=c=>engine.store.suppressed(account,c.jid)||engine.isStaff(c.jid)||engine.store.canonical(account,c.jid)===account;
    const suppressed=contacts.filter(excludedRecipient).map(c=>({...c,reason:engine.store.suppressed(account,c.jid)?'Contato pausado ou cancelado':'Número interno/equipe'}));
    const checked=await resolveRecipients(contacts.filter(c=>!excludedRecipient(c)),jid=>transport.lookup(jid),{autoNinth:body.autoNinth!==false,trusted:()=>['conversations','all'].includes(body.target),canonical:async jid=>{const canonical=await transport.canonical?.(jid)||jid;engine.store.bindAlias(account,jid,canonical);return canonical;}});checked.excluded.push(...suppressed);
    if(account!==engine.account||!transport.connected)throw Error('A conexão mudou; prepare novamente');
    const accepted=checked.valid.filter(c=>{
      if(c.original!==c.jid)engine.store.bindAlias(account,c.original,c.jid);
      if(engine.store.suppressed(account,c.jid)){checked.excluded.push({...c,reason:'Contato ou identidade vinculada pausada/cancelada'});return false;}return true;
    });
    for(const c of accepted){engine.store.upsertContact(account,c.jid,c.name);engine.store.patchContact(account,c.jid,{consent:true});}
    engine.store.log('campaign_resolution',{account,valid:accepted.map(c=>({original:c.original,jid:c.jid})),excluded:checked.excluded});
    const drafts=engine.campaign(text,accepted.map(c=>c.jid),{attachment:attachment?.id||'',intervalSec:interval}),campaignId=randomUUID(),title=String(body.title||'Campanha '+new Date().toISOString().slice(0,16)).slice(0,120);
    engine.store.db.prepare("INSERT INTO campaigns(id,account,title,created,state,excluded) VALUES(?,?,?,?,'prepared',?)").run(campaignId,account,title,Date.now(),JSON.stringify(checked.excluded));
    for(const d of drafts)engine.store.db.prepare('UPDATE drafts SET campaign_id=? WHERE id=?').run(campaignId,d.id);
    return json(200,{campaignId,drafts,recipients:accepted,excluded:checked.excluded,text,attachment:attachment?{id:attachment.id,filename:attachment.filename,kind:attachment.kind,size:attachment.size}:null,intervalSec:interval});
   }
   if(url.pathname==='/api/campaign/pause'){
    if(typeof body.paused!=='boolean')throw Error('Seleção inválida');engine.store.setSetting('campaign_paused',body.paused);
    if(!body.paused)for(const d of engine.store.db.prepare("SELECT id FROM drafts WHERE account=? AND source='campaign' AND status='approved' AND queued=1").all(engine.account))engine.scheduleSend(d.id,false);
    engine.store.log('campaign_pause',{paused:body.paused});return json(200,{ok:true});
   }
   if(url.pathname==='/api/campaign/start'){
    const ids=body.campaignId?engine.store.db.prepare('SELECT id FROM drafts WHERE campaign_id=? AND account=?').all(body.campaignId,engine.account).map(d=>d.id):body.ids;
    const queued=engine.startCampaign(ids);const groups=[...new Set(ids.map(id=>engine.store.draft(id).campaign_id).filter(Boolean))];
    for(const id of groups)engine.store.db.prepare("UPDATE campaigns SET state='running',started=? WHERE id=? AND account=?").run(Date.now(),id,engine.account);return json(200,{queued});
   }
   if(url.pathname==='/api/campaign/control'){
    const detail=campaignDetail(engine.store,engine.account,body.id);if(!['pause','resume','cancel'].includes(body.action))throw Error('Ação inválida');
    if(detail.finished)throw Error('Campanha já finalizada');
    if(body.action==='cancel'){engine.store.db.prepare("UPDATE drafts SET status='cancelled',queued=0 WHERE account=? AND campaign_id=? AND status IN ('pending','approved')").run(engine.account,body.id);engine.store.db.prepare('UPDATE campaigns SET state=?,finished=? WHERE id=?').run(detail.counts.sending?'cancelling':'cancelled',detail.counts.sending?null:Date.now(),body.id);}
    else{engine.store.db.prepare('UPDATE campaigns SET state=? WHERE id=?').run(body.action==='pause'?'paused':'running',body.id);if(body.action==='resume')for(const d of detail.rows.filter(d=>d.queued&&d.status==='approved'))engine.scheduleSend(d.id,false);}
    return json(200,{ok:true});
   }
   return json(404,{error:'Rota não encontrada'});
  }catch(e){if(!res.headersSent)json(400,{error:e.message});else res.end();}
 });
 server.requestTimeout=200000;server.headersTimeout=15000;
 return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const store=new Store(path.join(data,'crm.sqlite'));const transport=new WhatsApp(store);const engine=new Engine(store,codexAgent,transport,knowledge);transport.engine=engine;
 const server=createApp({engine,transport});
 server.on('error',e=>{console.error('Não foi possível abrir o painel:',e.message);process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>{
   console.log(`Painel: http://localhost:${port}/`);console.log('Acesso local em data/access-token. Modo:',engine.mode);
   try{if(JSON.parse(readFileSync(path.join(data,'whatsapp-auth','creds.json'),'utf8')).me)void transport.connect().catch(e=>store.log('connect_error',{message:e.message}));}catch{}
 });
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{transport.stop();server.close(()=>{store.close();process.exit(0);});});
 process.on('unhandledRejection',e=>{store.log('unhandled_error',{message:String(e?.message||e)});engine.mode='paused';});
}
