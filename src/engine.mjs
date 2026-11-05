import { randomUUID } from 'node:crypto';
import {verifiedAttachment} from './attachments.mjs';
import {catalogContext,catalogStatus,catalogInteraction} from './catalog.mjs';
import {phoneJid,ninthDigitAlternative} from './contacts.mjs';
import {profile,onboard,remember} from './crm.mjs';
import {cartContext,applyOrder,orderSummary,recentCustomerTurn} from './orders.mjs';

export function splitReply(text,limit=240){
 const words=text.trim().match(/\S+\s*/g)||[],parts=[];let part='';
 for(const word of words){if(part&&(part+word).trimEnd().length>limit&&parts.length<2){parts.push(part.trim());part=word;}else part+=word;}
 if(part.trim())parts.push(part.trim());return parts;
}
export function sendInterval(d){return d?.source==='campaign'?Math.max(10,d.interval_s||10)*1000:Math.max(2,d?.interval_s||10)*1000;}

export function optedOut(text) { return /^(sair|parar|cancelar|stop|não quero|nao quero)(\b|$)/iu.test(text.trim()); }
export class Engine {
  constructor(store,agent,transport,knowledge) {
    Object.assign(this,{store,agent,transport,knowledge}); this.account=''; this.mode=knowledge().ready?store.setting('mode','paused'):'paused'; this.busy=false; this.lastSend=Number(store.setting('last_send_at','0'))||0; this.generating=new Set(); this.tail=Promise.resolve();this.autoTimers=new Map();this.waitTimers=new Map();this.waitVersions=new Map();
  }
  receive(msg,{schedule=true}={}) {
    if(msg.account!==this.account||!msg.jid||!/@(s\.whatsapp\.net|lid)$/.test(msg.jid)) return false;
    if(!this.store.ingest(msg)) return false;
    if(this.isStaff(msg.jid,msg.account))return true;
    if(optedOut(msg.text||'')) this.store.patchContact(msg.account,msg.jid,{optout:true,hold:true,consent:false});
    if(schedule)this.schedule(msg.jid);
    return true;
  }
  schedule(jid){
    const account=this.account,c=this.store.contact(account,jid);
    if(this.isStaff(jid,account))return;
    const key=account+':'+jid;clearTimeout(this.waitTimers.get(key));const version=(this.waitVersions.get(key)||0)+1;this.waitVersions.set(key,version);
    if(this.mode!=='paused'&&c?.allowed&&!this.store.suppressed(account,jid)){
      const seconds=Math.min(30,Math.max(3,Number(this.store.setting('reply_wait_s','6'))||6));
      const timer=setTimeout(()=>{
        this.waitTimers.delete(key);
        this.tail=this.tail.then(()=>{if(this.waitVersions.get(key)!==version)return;if(this.generating.size){this.schedule(jid);return;}if(this.account===account&&this.mode!=='paused')return this.generate(jid);}).catch(e=>this.store.log('queue_error',{message:e.message}));
      },seconds*1000);timer.unref();this.waitTimers.set(key,timer);
    }
  }
  async generate(jid,{queue=true}={}) {
    if(!this.account) throw new Error('WhatsApp não conectado');
    const account=this.account, c=this.store.contact(account,jid);
    if(!c||c.hold||c.optout) throw new Error('Contato pausado ou cancelado');
    if(this.isStaff(jid,account))throw Error('Número da equipe: atendimento de cliente desativado');
    const key=account+':'+jid; if(this.generating.size) throw new Error('O agente está preparando outra resposta; aguarde');
    const existing=this.store.drafts(account).find(d=>d.jid===jid&&d.latest===this.store.latest(account,jid)&&d.source==='reply'&&['pending','approved','sent'].includes(d.status));
    if(existing) return existing;
    this.generating.add(key); const draft=this.store.createDraft(account,jid);
    try {
      const history=this.store.history(account,jid); const bad=this.store.processing(account,jid)?'Anexo em processamento; aguarde':history.at(-1)?.issue;
      if(bad) throw new Error(bad);
      const base=this.knowledge();base.catalog=catalogContext(this.store,account,history,jid);base.customer=profile(this.store,account,jid);base.order=cartContext(this.store,account,jid);const result=(this.store.setting('crm_onboarding')==='true'?onboard(this.store,account,jid,history):null)||catalogInteraction(this.store,account,jid,history,{hasCart:!!base.order.items.length})||await this.agent({history,knowledge:base});
      // A registration answer is not a new request to resolve an older product question.
      const lastOutgoing=history.filter(m=>m.direction==='outgoing').at(-1)?.text||'';
      const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      let registration=normalize(history.filter(m=>m.direction==='incoming').at(-1)?.text);
      const name=normalize(result.customerName),city=normalize(result.customerCity);
      if(name&&city&&/qual seu nome e sua cidade|de qual cidade você fala/i.test(lastOutgoing)&&registration.includes(name)&&registration.includes(city)){
        registration=registration.replace(name,'').replace(city,'').replace(/\b(me chamo|meu nome e|sou de|moro em|e|de|mg)\b/g,'').replace(/[\s,;.\-]/g,'');
        if(!registration){result.handoff=false;result.reply='Obrigado pelas informações! Como posso ajudar você?';result.reason='Cadastro informado; continuar atendimento sem retomar pendência antiga automaticamente';}
      }
      const stale=this.account!==account||draft.latest!==this.store.latest(account,jid)||this.knowledge().text!==base.text||catalogStatus(this.store,account).version!==base.catalog.version;
      let orderResult=null;
      if(!stale&&result.order?.action!=='none'&&result.order){
        try{orderResult=applyOrder(this.store,account,jid,result.order,{latest:draft.latest,text:recentCustomerTurn(history),city:base.customer.city,name:base.customer.name});if(orderResult){result.reply=orderResult.reply;result.handoff=false;result.reason=orderResult.confirmed?'[Pedido confirmado] Aguardando pagamento e entrega':'Carrinho local atualizado';}}
        catch(e){result.reply=e.message;result.handoff=!!e.handoff;result.reason=e.handoff?e.message:'Pedido precisa de conferência';}
      }
      const fallback=result.handoff?base.handoffReply:'';
      const status=stale?'stale':result.handoff&&!fallback?'handoff':'pending';
      const text=fallback||result.reply,parts=status==='pending'&&!result.menu&&!orderResult&&this.store.setting('reply_split','true')==='true'?splitReply(text):[text];
      if(!stale)remember(this.store,account,jid,history,{...result,reply:text});
      this.store.finish(draft.id,parts[0]||'',(result.handoff?'[Precisa de humano] ':'')+result.reason,status);
      if(!stale&&!result.handoff&&/foto|imagem/.test(history.filter(m=>m.direction!=='outgoing').at(-1)?.text.toLowerCase()||'')){
        const candidates=base.catalog.products;if(candidates.length===1&&candidates[0].image_attachment)this.store.db.prepare('UPDATE drafts SET attachment=? WHERE id=?').run(candidates[0].image_attachment,draft.id);
      }
      const ids=[draft.id];
      if(parts.length>1){
        this.store.db.prepare('UPDATE drafts SET reply_group=? WHERE id=?').run(draft.id,draft.id);
        const gap=Math.max(2,Math.min(10,Number(this.store.setting('reply_gap_s','3'))||3));
        for(let i=1;i<parts.length;i++){const child=this.store.createDraft(account,jid,'reply',parts[i],{intervalSec:gap});this.store.db.prepare('UPDATE drafts SET reply_group=?,part_index=? WHERE id=?').run(draft.id,i,child.id);ids.push(child.id);}
      }
      if(orderResult?.orderId)this.store.db.prepare('UPDATE drafts SET order_id=?,order_revision=? WHERE id=?').run(orderResult.orderId,cartContext(this.store,account,jid).revision||'',ids.at(-1));
      if(queue&&this.mode==='auto'&&status==='pending'&&this.knowledge().ready)for(const id of ids)this.scheduleSend(id);
    } catch(e) {
      // Never overwrite the durable result of an attempted network send.
      if(this.store.draft(draft.id).status==='generating') this.store.finish(draft.id,'',e.message,'error');
      else this.store.log('auto_send_blocked',{id:draft.id,message:e.message});
    } finally { this.generating.delete(key); }
    return this.store.draft(draft.id);
  }
  scheduleSend(id,automatic=true){
    if(this.autoTimers.has(id))return;
    const timer=setTimeout(async()=>{
      this.autoTimers.delete(id);
      if(this.mode==='paused'||(automatic&&this.mode!=='auto')||this.store.draft(id)?.status!==(automatic?'pending':'approved'))return;
      const draft=this.store.draft(id),interval=sendInterval(draft),prior=this.store.priorParts(draft);
      if(prior.some(p=>['uncertain','error','stale','handoff'].includes(p.status))){this.store.finish(id,draft.text,'Parte anterior interrompida; aguardar nova mensagem','stale');return;}
      if(prior.some(p=>p.status!=='sent')){this.scheduleSend(id,automatic);return;}
      if(this.busy||!this.transport.connected||this.store.campaignPaused(draft)||(this.lastSend&&Date.now()-this.lastSend<interval)){this.scheduleSend(id,automatic);return;}
      try{await this.send(id,automatic);}catch(e){
        if(draft.source==='campaign'&&this.store.draft(id)?.status==='approved')this.store.finish(id,draft.text,e.message,this.store.suppressed(draft.account,draft.jid)?'blocked':'failed');
        this.store.log('queued_send_blocked',{id,message:e.message});
      }
    },Math.max(this.transport.connected&&this.store.setting('campaign_paused')!=='true'?100:2000,this.lastSend?this.lastSend+sendInterval(this.store.draft(id))-Date.now():0));
    timer.unref();this.autoTimers.set(id,timer);
  }
  setMode(mode) {
    if(!['paused','supervised','auto'].includes(mode)) throw new Error('Modo inválido');
    if(mode==='auto'&&!this.knowledge().ready) throw new Error('Preencha a base da empresa antes de ativar automático');
    this.mode=mode;this.store.setSetting('mode',mode); this.store.log('mode',{mode});
    if(mode!=='paused')this.restoreStaffAlerts();
  }
  async send(id,automatic=false) {
    if(this.busy) throw new Error('Já existe envio em andamento');
    if(this.mode==='paused') throw new Error('Envios pausados');
    if(automatic&&this.mode!=='auto') throw new Error('Automático desativado');
    if(automatic&&!this.knowledge().ready)throw new Error('Base da empresa não preenchida');
    if(!this.transport.connected) throw new Error('WhatsApp desconectado');
    const draft=this.store.draft(id),interval=sendInterval(draft);
    if(draft?.source==='campaign'&&(this.isStaff(draft.jid)||this.store.canonical(this.account,draft.jid)===this.account))throw Error('Número interno excluído de campanhas');
    if(draft&&this.store.priorParts(draft).some(p=>p.status!=='sent'))throw Error('Aguarde a parte anterior desta resposta');
    if(draft&&this.store.campaignPaused(draft))throw Error('Campanhas pausadas');
    if(this.lastSend&&Date.now()-this.lastSend<interval) throw new Error('Aguarde o intervalo de '+interval/1000+' segundos entre envios');
    this.busy=true;
    try {
      const account=this.account;const attachment=await verifiedAttachment(this.store,draft?.attachment,account);
      // Reading/hash-checking media yields the event loop: honour changes made meanwhile.
      if(this.account!==account||!this.transport.connected)throw Error('A conexão mudou; envio bloqueado');
      if(this.mode==='paused'||(automatic&&this.mode!=='auto'))throw Error('Envios pausados');
      if(draft&&this.store.campaignPaused(draft))throw Error('Campanhas pausadas');
      if(this.lastSend&&Date.now()-this.lastSend<interval)throw Error('Aguarde o intervalo de envio');
      const mid=this.transport.messageId?.()||randomUUID();
      const d=this.store.claim(id,this.account,mid,{automatic});
      this.lastSend=Date.now();this.store.setSetting('last_send_at',this.lastSend);
      try {
        await this.transport.send(d.jid,d.text,mid,attachment);
        this.store.recordOutgoing(d.account,d.jid,mid,d.text+(attachment?'\n[Anexo enviado: '+attachment.filename+']':''));this.store.finish(id,d.text,d.reason,'sent'); this.store.log('sent',{id,mid,attachment:d.attachment});
        if(d.source==='staff')this.store.db.prepare("UPDATE staff_alerts SET status='sent' WHERE draft=?").run(id);
        if(d.source==='reply'&&d.reason.startsWith('[Precisa de humano]')&&d.part_index===0)void this.notifyStaff(d).catch(e=>this.store.log('staff_notification_error',{id:d.id,message:e.message}));
        if(d.source==='reply'&&d.order_id){const cart=cartContext(this.store,d.account,d.jid);if(cart.id===d.order_id&&cart.status==='review'&&cart.revision===d.order_revision){this.store.setSetting('order_review_sent:'+cart.id,d.latest);this.store.setSetting('order_review_revision:'+cart.id,cart.revision);}if(cart.id===d.order_id&&cart.status==='awaiting_payment')void this.notifyStaff({...d,order_id:cart.id}).catch(e=>this.store.log('staff_notification_error',{id:d.id,message:e.message}));}
      } catch(e) { this.store.finish(id,d.text,'Envio incerto. Confira no celular antes de qualquer novo envio.','uncertain');if(d.source==='staff')this.store.db.prepare("UPDATE staff_alerts SET status='uncertain' WHERE draft=?").run(id); this.store.log('uncertain',{id,message:e.message}); throw new Error('Resultado do envio incerto; confira no celular'); }
      return this.store.draft(id);
    } finally { this.busy=false; }
  }
  campaign(text,jids,options={}) {
    const interval=options.intervalSec??30;
    if(!Number.isInteger(interval)||interval<10||interval>3600)throw Error('Intervalo deve ser de 10 a 3600 segundos');
    if((!text?.trim()&&!options.attachment)||(text||'').length>(options.attachment?1024:4000)) throw new Error('Use até 4000 caracteres em texto ou 1024 na legenda do anexo');
    const contacts=this.store.contacts(this.account).filter(c=>c.consent&&!this.store.suppressed(this.account,c.jid)&&!this.isStaff(c.jid)&&this.store.canonical(this.account,c.jid)!==this.account&&(!jids||jids.includes(c.jid)));
    if(contacts.length>5000) throw new Error('Selecione até 5000 destinatários por campanha');
    const drafts=contacts.map(c=>this.store.createDraft(this.account,c.jid,'campaign',text||'',{...options,intervalSec:interval}));
    this.store.log('campaign_prepared',{count:drafts.length}); return drafts;
  }
  async notifyStaff(d){
    const account=d.account,event=d.order_id?'order:'+d.order_id:d.reply_group||d.id,numbers=this.knowledge().staffNumbers||[];
    for(const number of [...new Set(numbers)]){
      if(this.store.db.prepare('SELECT 1 FROM staff_alerts WHERE event=? AND recipient=?').get(event,number))continue;
      this.store.db.prepare("INSERT INTO staff_alerts(event,recipient,status) VALUES(?,?,'preparing')").run(event,number);
      try{
        const requested=phoneJid(number);let found=await this.transport.lookup(requested);if(!found?.exists&&ninthDigitAlternative(requested))found=await this.transport.lookup(ninthDigitAlternative(requested));if(!found?.exists||!found.jid)throw Error('Número da equipe não encontrado no WhatsApp');
        if(this.account!==account)throw Error('Conta alterada');
        const contact=this.store.contact(account,d.jid),canonical=await this.transport.canonical?.(d.jid)||d.jid;
        const client=canonical.endsWith('@s.whatsapp.net')?'https://wa.me/'+canonical.split('@')[0]:'Contato no painel: '+d.jid;
        const incoming=this.store.history(account,d.jid).filter(m=>m.direction==='incoming'&&(!d.latest||m.seq<=d.latest)).at(-1);
        const question=(incoming?.text||`[${incoming?.kind||'Mensagem sem texto'}]`).slice(0,1800);
        const clientNumber=canonical.endsWith('@s.whatsapp.net')?canonical.split('@')[0]:d.jid;
        const cart=d.order_id?cartContext(this.store,account,d.jid):null;
        const message=(cart?`PEDIDO EM ESPERA — pagamento e entrega pendentes.\n${orderSummary(cart)}\nCliente: ${cart.customer.name}\nContato: ${clientNumber}\n${client}\nCPF/CNPJ: ${cart.customer.taxId}\nEndereço: ${cart.customer.address}, ${cart.customer.city}\nE-mail: ${cart.customer.email}\nPagamento escolhido: ${cart.payment}`:`${d.test?'TESTE DE AVISO — ':''}Cliente aguardando atendimento humano.\nNome: ${contact?.name||'Cliente'}\nNúmero: ${clientNumber}\n${client}\nPergunta do cliente: ${question}\nO cliente foi orientado a aguardar alguém do time.`).slice(0,3900);
        this.store.db.prepare('INSERT OR IGNORE INTO staff_identities(account,jid) VALUES(?,?)').run(account,found.jid);
        this.store.upsertContact(account,found.jid,'Equipe');const notification=this.store.createDraft(account,found.jid,'staff',message);
        this.store.db.prepare("UPDATE drafts SET status='approved',queued=1 WHERE id=?").run(notification.id);
        this.store.db.prepare("UPDATE staff_alerts SET status='queued',draft=? WHERE event=? AND recipient=?").run(notification.id,event,number);
        this.store.log('staff_alert_authorized',{event,recipient:found.jid,source:'operator-configured notification'});this.scheduleSend(notification.id,false);
      }catch(e){this.store.db.prepare("UPDATE staff_alerts SET status='failed' WHERE event=? AND recipient=?").run(event,number);this.store.log('staff_alert_failed',{event,message:e.message});}
    }
  }
  isStaff(jid,account=this.account){
    const ids=new Set([jid,this.store.canonical(account,jid),...this.store.related(account,jid).map(c=>c.jid)]);
    for(const n of this.knowledge().staffNumbers||[]){try{const p=phoneJid(n);if(ids.has(p)||ids.has(ninthDigitAlternative(p)))return true;}catch{}}
    return [...ids].some(id=>this.store.db.prepare('SELECT 1 FROM staff_identities WHERE account=? AND jid=?').get(account,id));
  }
  restoreStaffAlerts(){if(this.mode==='paused'||!this.account)return;for(const d of this.store.db.prepare("SELECT id FROM drafts WHERE account=? AND source='staff' AND status='approved' AND queued=1").all(this.account))this.scheduleSend(d.id,false);}
  startCampaign(ids){
    if(this.mode==='paused')throw Error('Envios estão pausados');
    if(!Array.isArray(ids)||!ids.length||ids.length>5000)throw Error('Seleção inválida');
    const unique=[...new Set(ids)];
    for(const id of unique){const d=this.store.draft(id);if(!d||d.account!==this.account||d.source!=='campaign'||d.status!=='pending')throw Error('Campanha alterada; prepare uma nova prévia');}
    for(const id of unique){this.store.approve(id);this.store.db.prepare('UPDATE drafts SET queued=1 WHERE id=?').run(id);this.scheduleSend(id,false);}
    return unique.length;
  }
}
