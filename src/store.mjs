import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS contacts(account TEXT,jid TEXT,name TEXT,allowed INTEGER DEFAULT 0,hold INTEGER DEFAULT 0,consent INTEGER DEFAULT 0,optout INTEGER DEFAULT 0,PRIMARY KEY(account,jid));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,account TEXT,jid TEXT,mid TEXT,text TEXT,kind TEXT,path TEXT,issue TEXT,created INTEGER,UNIQUE(account,jid,mid));
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,account TEXT,jid TEXT,latest INTEGER,text TEXT,reason TEXT,status TEXT,source TEXT,created INTEGER,outgoing TEXT);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER,event TEXT,detail TEXT);
      CREATE TABLE IF NOT EXISTS outgoing(account TEXT,mid TEXT,PRIMARY KEY(account,mid));`);
    this.db.exec('CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,account TEXT,path TEXT,filename TEXT,kind TEXT,mime TEXT,size INTEGER,hash TEXT,created INTEGER)');
    this.db.exec('CREATE TABLE IF NOT EXISTS aliases(account TEXT,alias TEXT,canonical TEXT,PRIMARY KEY(account,alias))');
    this.db.exec('CREATE TABLE IF NOT EXISTS products(account TEXT,sku TEXT,record TEXT,updated INTEGER,PRIMARY KEY(account,sku)); CREATE TABLE IF NOT EXISTS catalog_imports(id TEXT PRIMARY KEY,account TEXT,source TEXT,records TEXT,created INTEGER)');
    this.db.exec("CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,account TEXT,title TEXT,created INTEGER,started INTEGER,finished INTEGER,state TEXT,excluded TEXT)");
    this.db.exec("CREATE TABLE IF NOT EXISTS conversation_menu(account TEXT,jid TEXT,record TEXT,created INTEGER,PRIMARY KEY(account,jid)); CREATE TABLE IF NOT EXISTS staff_alerts(event TEXT,recipient TEXT,status TEXT,draft TEXT,PRIMARY KEY(event,recipient)); UPDATE campaigns SET state='paused' WHERE state='running'");
    this.db.exec("CREATE TABLE IF NOT EXISTS profiles(account TEXT,jid TEXT,name TEXT,city TEXT,summary TEXT,stage TEXT,asked INTEGER DEFAULT 0,updated INTEGER,PRIMARY KEY(account,jid)); CREATE TABLE IF NOT EXISTS staff_identities(account TEXT,jid TEXT,PRIMARY KEY(account,jid))");
    this.db.exec("CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,account TEXT,jid TEXT,status TEXT,record TEXT,created INTEGER,updated INTEGER); CREATE INDEX IF NOT EXISTS orders_customer ON orders(account,jid,updated)");
    this.db.exec("CREATE TABLE IF NOT EXISTS chats(account TEXT,jid TEXT,updated INTEGER,PRIMARY KEY(account,jid)); INSERT OR IGNORE INTO chats(account,jid,updated) SELECT account,jid,MAX(created) FROM messages GROUP BY account,jid");
    const draftColumns=this.db.prepare('PRAGMA table_info(drafts)').all().map(c=>c.name);
    if(!draftColumns.includes('attachment'))this.db.exec("ALTER TABLE drafts ADD COLUMN attachment TEXT DEFAULT ''");
    if(!draftColumns.includes('interval_s'))this.db.exec('ALTER TABLE drafts ADD COLUMN interval_s INTEGER DEFAULT 10');
    if(!draftColumns.includes('queued'))this.db.exec('ALTER TABLE drafts ADD COLUMN queued INTEGER DEFAULT 0');
    if(!draftColumns.includes('reply_group'))this.db.exec("ALTER TABLE drafts ADD COLUMN reply_group TEXT DEFAULT ''");
    if(!draftColumns.includes('part_index'))this.db.exec('ALTER TABLE drafts ADD COLUMN part_index INTEGER DEFAULT 0');
    if(!draftColumns.includes('campaign_id'))this.db.exec("ALTER TABLE drafts ADD COLUMN campaign_id TEXT DEFAULT ''");
    if(!draftColumns.includes('order_id'))this.db.exec("ALTER TABLE drafts ADD COLUMN order_id TEXT DEFAULT ''");
    if(!draftColumns.includes('order_revision'))this.db.exec("ALTER TABLE drafts ADD COLUMN order_revision TEXT DEFAULT ''");
    if(!this.db.prepare('PRAGMA table_info(messages)').all().some(c=>c.name==='direction'))this.db.exec("ALTER TABLE messages ADD COLUMN direction TEXT DEFAULT 'incoming'");
    if(!this.db.prepare('PRAGMA table_info(messages)').all().some(c=>c.name==='historical'))this.db.exec('ALTER TABLE messages ADD COLUMN historical INTEGER DEFAULT 0');
    if(!this.db.prepare('PRAGMA table_info(contacts)').all().some(c=>c.name==='origin'))this.db.exec("ALTER TABLE contacts ADD COLUMN origin TEXT DEFAULT 'whatsapp'");
    this.db.exec("UPDATE drafts SET status='uncertain' WHERE status='sending'; UPDATE drafts SET status='error',reason='Execução interrompida; gere novamente.' WHERE status='generating';");
    this.db.exec("UPDATE messages SET kind='unsupported',issue='Processamento interrompido; requer revisão humana' WHERE kind='processing'");
  }
  log(event, detail) { this.db.prepare('INSERT INTO audit(at,event,detail) VALUES(?,?,?)').run(Date.now(), event, JSON.stringify(detail)); }
  setting(key,fallback=''){return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value??fallback;}
  setSetting(key,value){this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));}
  upsertContact(account,jid,name){
    if(!/@(s\.whatsapp\.net|lid)$/.test(jid))return;
    this.db.prepare('INSERT INTO contacts(account,jid,name,allowed) VALUES(?,?,?,?) ON CONFLICT(account,jid) DO UPDATE SET name=CASE WHEN excluded.name<>excluded.jid THEN excluded.name ELSE contacts.name END').run(account,jid,name||jid,+(this.setting('allow_all')==='true'));
  }
  contact(account,jid) { return this.db.prepare('SELECT * FROM contacts WHERE account=? AND jid=?').get(account,jid); }
  canonical(account,jid){return this.db.prepare('SELECT canonical FROM aliases WHERE account=? AND alias=?').get(account,jid)?.canonical||jid;}
  bindAlias(account,alias,canonical){
    if(!alias||!canonical)return;const previous=this.canonical(account,alias),next=this.canonical(account,canonical);
    this.db.prepare('UPDATE aliases SET canonical=? WHERE account=? AND canonical=?').run(next,account,previous);
    for(const id of [alias,previous,canonical])this.db.prepare('INSERT INTO aliases(account,alias,canonical) VALUES(?,?,?) ON CONFLICT(account,alias) DO UPDATE SET canonical=excluded.canonical').run(account,id,next);
  }
  related(account,jid){const canonical=this.canonical(account,jid);return this.db.prepare('SELECT * FROM contacts WHERE account=? AND (jid=? OR jid=? OR jid IN (SELECT alias FROM aliases WHERE account=? AND canonical=?))').all(account,jid,canonical,account,canonical);}
  suppressed(account,jid){return this.related(account,jid).some(c=>c.hold||c.optout);}
  contacts(account) { return this.db.prepare('SELECT * FROM contacts WHERE account=? ORDER BY name').all(account); }
  patchContact(account,jid,patch) {
    const old=this.contact(account,jid); if(!old) throw new Error('Contato não encontrado');
    const related=this.related(account,jid);
    for(const key of ['allowed','hold','consent','optout'])if(Object.hasOwn(patch,key))for(const c of related)this.db.prepare(`UPDATE contacts SET ${key}=? WHERE account=? AND jid=?`).run(+!!patch[key],account,c.jid);
    this.log('contact_change',{account,jid,patch});
  }
  ingest({account,jid,mid,name,text='',kind='text',path='',issue=''}) {
    this.upsertContact(account,jid,name);
    this.markChat(account,jid);
    const r=this.db.prepare('INSERT OR IGNORE INTO messages(account,jid,mid,text,kind,path,issue,created) VALUES(?,?,?,?,?,?,?,?)').run(account,jid,mid,text,kind,path,issue,Date.now());
    if(r.changes) this.db.prepare("UPDATE drafts SET status='stale' WHERE account=? AND jid=? AND source='reply' AND status IN ('pending','approved')").run(account,jid);
    return !!r.changes;
  }
  latest(account,jid) { return this.db.prepare("SELECT MAX(seq) AS n FROM messages WHERE account=? AND jid=? AND direction='incoming' AND historical=0").get(account,jid).n||0; }
  processing(account,jid){return !!this.db.prepare("SELECT 1 FROM messages WHERE account=? AND jid=? AND kind='processing'").get(account,jid);}
  recordOutgoing(account,jid,mid,text){
    this.markChat(account,jid);
    this.db.prepare("INSERT OR IGNORE INTO messages(account,jid,mid,text,kind,path,issue,created,direction) VALUES(?,?,?,?,'text','','',?,'outgoing')").run(account,jid,mid,text,Date.now());
  }
  history(account,jid) { return this.db.prepare('SELECT * FROM (SELECT * FROM messages WHERE account=? AND jid=? ORDER BY created DESC,seq DESC LIMIT 12) ORDER BY created,seq').all(account,jid); }
  markChat(account,jid){if(!account||!/@(s\.whatsapp\.net|lid)$/.test(jid||''))return;this.upsertContact(account,jid);this.db.prepare('INSERT INTO chats(account,jid,updated) VALUES(?,?,?) ON CONFLICT(account,jid) DO UPDATE SET updated=excluded.updated').run(account,jid,Date.now());}
  chatContacts(account){const ids=new Set(this.db.prepare('SELECT jid FROM chats WHERE account=?').all(account).map(c=>this.canonical(account,c.jid)));return this.contacts(account).filter(c=>ids.has(this.canonical(account,c.jid)));}
  recordHistorical({account,jid,mid,text,kind='text',direction,created}){this.upsertContact(account,jid);this.db.prepare("INSERT OR IGNORE INTO messages(account,jid,mid,text,kind,path,issue,created,direction,historical) VALUES(?,?,?,?,?,'','',?,?,1)").run(account,jid,mid,text,kind,created,direction);}
  createDraft(account,jid,source='reply',text='',options={}) {
    const id=randomUUID();
    this.db.prepare('INSERT INTO drafts(id,account,jid,latest,text,reason,status,source,created,attachment,interval_s) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,account,jid,this.latest(account,jid),text,'',text||options.attachment?'pending':'generating',source,Date.now(),options.attachment||'',options.intervalSec||10);
    return this.draft(id);
  }
  draft(id) { return this.db.prepare('SELECT * FROM drafts WHERE id=?').get(id); }
  priorParts(d){return d.reply_group?this.db.prepare('SELECT status FROM drafts WHERE account=? AND reply_group=? AND part_index<?').all(d.account,d.reply_group,d.part_index):[];}
  campaignPaused(d){return d.source==='campaign'&&(this.setting('campaign_paused')==='true'||(d.campaign_id&&this.db.prepare('SELECT state FROM campaigns WHERE id=? AND account=?').get(d.campaign_id,d.account)?.state==='paused'));}
  drafts(account) { return this.db.prepare('SELECT * FROM drafts WHERE account=? ORDER BY created DESC LIMIT 100').all(account); }
  finish(id,text,reason,status='pending') { this.db.prepare('UPDATE drafts SET text=?,reason=?,status=? WHERE id=?').run(text,reason,status,id); }
  approve(id) {
    const d=this.draft(id); if(!d||d.status!=='pending') throw new Error('Rascunho não está aguardando aprovação');
    this.db.prepare("UPDATE drafts SET status='approved' WHERE id=? AND status='pending'").run(id); this.log('human_approval',{id,text:d.text,attachment:d.attachment,interval_s:d.interval_s});
  }
  claim(id,account,mid,{automatic=false}={}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const d=this.draft(id), c=d&&this.contact(account,d.jid);
      if(!d||d.account!==account||!c) throw new Error('Rascunho de outra conta ou inexistente');
      if(!(d.status==='approved'||(automatic&&d.status==='pending'&&d.source==='reply'))) throw new Error('Aprovação humana necessária');
      if(d.source==='staff'?this.related(account,d.jid).some(c=>c.optout):this.suppressed(account,d.jid)) throw new Error('Contato pausado ou cancelado');
      if(this.campaignPaused(d))throw Error('Campanha pausada');
      if(automatic&&!c.allowed) throw new Error('IA não habilitada para este contato');
      if(d.source==='campaign'&&!c.consent) throw new Error('Consentimento de campanha ausente');
      if(d.source==='reply'&&d.latest!==this.latest(account,d.jid)) throw new Error('Chegou nova mensagem; gere outra resposta');
      if((!d.text.trim()&&!d.attachment)||d.text.length>(d.attachment?1024:4000)) throw new Error('Texto vazio ou longo demais para este envio');
      this.db.prepare("UPDATE drafts SET status='sending',outgoing=?,queued=0 WHERE id=?").run(mid,id);
      this.db.prepare('INSERT INTO outgoing(account,mid) VALUES(?,?)').run(account,mid);
      this.log('sending',{id,mid,automatic}); this.db.exec('COMMIT'); return d;
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  isOwn(account,mid) { return !!this.db.prepare('SELECT 1 FROM outgoing WHERE account=? AND mid=?').get(account,mid); }
  close() { this.db.close(); }
}
