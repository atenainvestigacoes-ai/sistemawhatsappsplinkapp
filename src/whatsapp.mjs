import makeWASocket,{useMultiFileAuthState,DisconnectReason,downloadContentFromMessage,normalizeMessageContent,generateMessageIDV2,jidNormalizedUser,proto,Browsers} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import {mkdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {data} from './config.mjs';
import {saveLimited,extract,MAX_BYTES} from './media.mjs';
import {optedOut} from './engine.mjs';
export const historySocketOptions={browser:Browsers.macOS('Desktop'),syncFullHistory:true};

export class WhatsApp {
 constructor(store) {this.store=store;this.connected=false;this.state='disconnected';this.qr='';this.sock=null;this.attempts=0;this.timer=null;this.stopped=true;this.mediaBusy=0;this.generation=0;}
 messageId(){return generateMessageIDV2(this.sock?.user?.id);}
 async syncChats(){
  if(!this.connected||!this.sock)throw Error('Conecte o WhatsApp primeiro');
  await this.sock.sendPeerDataOperationMessage({peerDataOperationRequestType:proto.Message.PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND,fullHistorySyncOnDemandRequest:{requestMetadata:{requestId:randomUUID()},historySyncConfig:{fullSyncDaysLimit:3650,fullSyncSizeMbLimit:64,storageQuotaMb:64,onDemandReady:true,completeOnDemandReady:true}}});
  this.store.log('chat_sync_requested',{account:this.engine.account});
 }
 async lookup(jid){
   if(!this.connected)throw Error('WhatsApp desconectado');let timer;
   try{const rows=await Promise.race([this.sock.onWhatsApp(jid),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Consulta expirou')),8000);})]);return rows?.find(r=>r.exists)||{exists:false};}finally{clearTimeout(timer);}
 }
 async canonical(jid){if(jid.endsWith('@lid'))return await this.sock?.signalRepository?.lidMapping?.getPNForLID(jid)||jid;return jid;}
 async send(jid,text,messageId,attachment=null){
   if(!this.connected)throw Error('Desconectado');
   let content={text};
   if(attachment){
     const common={caption:text,mimetype:attachment.mime};
     content=attachment.kind==='image'?{image:attachment.bytes,...common}:attachment.kind==='video'?{video:attachment.bytes,...common}:{document:attachment.bytes,fileName:attachment.filename,...common};
   }
   let timer;
   try{await Promise.race([this.sock.sendMessage(jid,content,{messageId}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout de envio')),60000);timer.unref();})]);}finally{clearTimeout(timer);}
 }
 async connect(){
   if(this.state==='logged_out')throw Error('Sessão revogada. Use Novo pareamento no painel.');
   if(['connecting','qr','connected'].includes(this.state))return;
   this.stopped=false;this.state='connecting';this.qr='';const generation=++this.generation;
   const {state,saveCreds}=await useMultiFileAuthState(path.join(data,'whatsapp-auth'));
   const browser=state.creds.me?['Atendimento Codex','Chrome','131.0.0']:historySocketOptions.browser;
   const sock=makeWASocket({auth:state,logger:pino({level:'silent'}),...historySocketOptions,browser,markOnlineOnConnect:false,shouldSyncHistoryMessage:()=>true,connectTimeoutMs:30000,defaultQueryTimeoutMs:30000});
   this.sock=sock;
   sock.ev.on('creds.update',()=>{if(generation===this.generation)saveCreds().catch(e=>this.store.log('auth_save_error',{message:e.message}));});
   sock.ev.on('connection.update',update=>{
     if(generation!==this.generation)return;
     void this.update(update,generation).catch(e=>{this.state='error';this.store.log('connection_error',{message:e.message});});
   });
   sock.ev.on('messages.upsert',batch=>{
     if(generation!==this.generation||batch.type!=='notify'||!this.connected)return;
     const account=this.engine.account;
     for(const m of batch.messages) void this.receive(m,account).catch(e=>this.store.log('receive_error',{message:e.message}));
   });
   const syncContacts=contacts=>{if(generation!==this.generation||!this.engine.account)return;for(const c of contacts){const jid=c.phoneNumber||c.id;if(jid)this.store.upsertContact(this.engine.account,jid,c.name||c.notify||c.verifiedName||c.subject||jid);}};
   sock.ev.on('contacts.upsert',syncContacts);sock.ev.on('contacts.update',syncContacts);
   const syncChats=chats=>{if(generation!==this.generation)return;syncContacts(chats);for(const c of chats){if(c.id)this.store.markChat(this.engine.account,c.id);if(c.id&&c.pnJid)this.store.bindAlias(this.engine.account,c.id,c.pnJid);}};
   sock.ev.on('chats.upsert',syncChats);sock.ev.on('chats.update',syncChats);
   sock.ev.on('messaging-history.set',batch=>{
     if(generation!==this.generation)return;syncContacts(batch.contacts||[]);syncChats(batch.chats||[]);const account=this.engine.account;
     if(account){this.store.db.exec('BEGIN');try{for(const m of batch.messages||[]){const jid=m.key?.remoteJid,mid=m.key?.id;if(!jid||!mid||!/@(s\.whatsapp\.net|lid)$/.test(jid))continue;const body=normalizeMessageContent(m.message),text=body?.conversation||body?.extendedTextMessage?.text||body?.imageMessage?.caption||body?.documentMessage?.caption||'';if(!text)continue;this.store.recordHistorical({account,jid,mid,text:text.slice(0,24000),direction:m.key.fromMe?'outgoing':'incoming',created:Number(m.messageTimestamp||0)*1000});}this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');this.store.log('history_error',{message:e.message});}}
     this.store.log('contact_sync',{contacts:batch.contacts?.length||0,chats:batch.chats?.length||0});
   });
 }
 async update({connection,qr,lastDisconnect},generation){
   if(qr){this.qr=await QRCode.toDataURL(qr,{width:320,margin:2});if(generation===this.generation)this.state='qr';}
   if(connection==='open'){
     const account=jidNormalizedUser(this.sock.user.id);this.engine.account=account;this.connected=true;this.state='connected';this.qr='';this.attempts=0;this.engine.restoreStaffAlerts();this.store.log('connected',{account});
   }
   if(connection==='close'){
     this.connected=false;this.qr='';this.state='disconnected';
     const code=lastDisconnect?.error?.output?.statusCode;
     this.store.log('connection_closed',{code,message:lastDisconnect?.error?.message||''});
     if(code===DisconnectReason.loggedOut){this.state='logged_out';this.store.log('logout',{});return;}
     if(!this.stopped&&this.attempts<6){this.attempts++;this.timer=setTimeout(()=>this.connect().catch(e=>{this.state='error';this.store.log('reconnect_error',{message:e.message});}),Math.min(30000,2000*2**this.attempts));this.timer.unref();}
     else if(!this.stopped){this.state='error';this.store.log('reconnect_exhausted',{});}
   }
 }
 stop(){this.stopped=true;this.generation++;clearTimeout(this.timer);this.sock?.end(undefined);this.connected=false;this.qr='';this.state='disconnected';}
 async relink(){
   if(this.connected)throw Error('Desconecte o serviço antes de refazer o pareamento');
   this.stop();this.engine.setMode('paused');this.engine.account='';const folder=path.join(data,'whatsapp-auth');
   if(await stat(folder).catch(()=>null))await rename(folder,path.join(data,'whatsapp-auth-archived-'+Date.now()));
   await this.connect();
 }
 async receive(m,account){
   if(account!==this.engine.account)return;
   const protocol=normalizeMessageContent(m.message)?.protocolMessage;
   if(protocol){
    const response=protocol.peerDataOperationRequestResponseMessage;
    if(response&&m.key?.fromMe)for(const result of response.peerDataOperationResult||[]){const sync=result.fullHistorySyncOnDemandRequestResponse;if(sync){const code=sync.responseCode;this.store.log('chat_sync_response',{account,code});this.store.setSetting('chat_sync_response:'+account,String(code));}}
    return;
   }
   const remote=m.key?.remoteJid;const jid=remote?.endsWith('@lid')&&m.key?.remoteJidAlt?.endsWith('@s.whatsapp.net')?m.key.remoteJidAlt:remote,mid=m.key?.id;
   if(!jid||!mid||!/@(s\.whatsapp\.net|lid)$/.test(jid))return;
   if(m.key.remoteJidAlt&&/@(s\.whatsapp\.net|lid)$/.test(m.key.remoteJidAlt)){
     const canonical=remote.endsWith('@s.whatsapp.net')?remote:m.key.remoteJidAlt;
     this.store.bindAlias(account,remote,canonical);this.store.bindAlias(account,m.key.remoteJidAlt,canonical);
   }
   if(m.key.fromMe){
     if(!this.store.isOwn(account,mid)&&this.store.contact(account,jid)){
       this.store.patchContact(account,jid,{hold:true});this.store.db.prepare("UPDATE drafts SET status='stale' WHERE account=? AND jid=? AND source='reply' AND status IN ('pending','approved')").run(account,jid);
       const body=normalizeMessageContent(m.message);this.store.recordOutgoing(account,jid,mid,body?.conversation||body?.extendedTextMessage?.text||'[Atendimento manual com anexo]');this.store.log('human_takeover',{account,jid});
     }return;
   }
   // notify includes messages received while offline; persistent IDs prevent replays.
   if(this.store.db.prepare('SELECT 1 FROM messages WHERE account=? AND jid=? AND mid=?').get(account,jid,mid))return;
   const body=normalizeMessageContent(m.message);if(!body)return;
   if(body.protocolMessage||body.reactionMessage||body.senderKeyDistributionMessage)return;
   let text=body.conversation||body.extendedTextMessage?.text||'',kind='text',file='',issue='';
   const media=body.imageMessage||body.audioMessage||body.documentMessage||body.videoMessage||body.stickerMessage;
   // Register receipt before any slow download: prior approvals become stale immediately.
   const reserved=this.engine.receive({account,jid,mid,name:m.pushName||jid,text,kind:media?'processing':'text',issue:media?'Anexo em processamento':''},{schedule:false});
   if(!reserved)return;
   if(media){
     kind=body.imageMessage?'image':body.audioMessage?'audio':media.mimetype==='application/pdf'?'pdf':'unsupported';
     text=media.caption||'';
     let acquired=false;
     try{
       if(this.mediaBusy>=2)throw Error('Muitos anexos em processamento; revisão humana');
       this.mediaBusy++;acquired=true;
       if(kind==='unsupported')throw Error('Tipo de arquivo não suportado; revisão humana');
       if(Number(media.fileLength||0)>MAX_BYTES)throw Error('Anexo acima de 15 MB');
       if(kind==='image'&&!['image/jpeg','image/png','image/webp'].includes(media.mimetype))throw Error('Formato de imagem não suportado');
       const dir=path.join(data,'media');await mkdir(dir,{recursive:true});
       const ext=kind==='image'?({ 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[media.mimetype]):kind==='pdf'?'.pdf':'.ogg';
       file=path.join(dir,randomUUID()+ext);
       const stream=await downloadContentFromMessage(media,kind==='pdf'?'document':kind);
       await saveLimited(stream,file);
       if(kind!=='image')text+='\n'+await extract(kind,file);
     }catch(e){issue=e.message;}finally{if(acquired)this.mediaBusy--;}
   }
   this.store.db.prepare('UPDATE messages SET text=?,kind=?,path=?,issue=? WHERE account=? AND jid=? AND mid=?').run(text.slice(0,24000),kind,file,issue,account,jid,mid);
   if(optedOut(text))this.store.patchContact(account,jid,{optout:true,hold:true,consent:false});
   if(account===this.engine.account)this.engine.schedule(jid);
 }
}
