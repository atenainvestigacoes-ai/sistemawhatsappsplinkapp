export function profile(store,account,jid){
 const canonical=store.canonical(account,jid),known=store.db.prepare('SELECT * FROM profiles WHERE account=? AND jid=?').get(account,canonical);
 if(known)return known;
 const related=store.related(account,jid).map(c=>c.jid);let previous=null;
 for(const id of related){const p=store.db.prepare('SELECT * FROM profiles WHERE account=? AND jid=?').get(account,id);if(p&&(!previous||p.updated>previous.updated))previous=p;}
 store.db.prepare("INSERT OR IGNORE INTO profiles(account,jid,name,city,summary,stage,asked,updated) VALUES(?,?,?,?,?,'new',?,?)").run(account,canonical,previous?.name||'',previous?.city||'',previous?.summary||'',previous?.asked||0,Date.now());
 return store.db.prepare('SELECT * FROM profiles WHERE account=? AND jid=?').get(account,canonical);
}
const clean=s=>String(s||'').replace(/[\x00-\x1f]/g,' ').trim();
const norm=s=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function updateProfile(store,account,jid,patch){
 const p=profile(store,account,jid),name=clean(patch.name??p.name).slice(0,100),city=clean(patch.city??p.city).slice(0,100),summary=clean(patch.summary??p.summary).slice(0,2000),stage=patch.stage??p.stage;
 if(!['new','active','waiting_team','completed'].includes(stage))throw Error('Etapa inválida');
 store.db.prepare('UPDATE profiles SET name=?,city=?,summary=?,stage=?,updated=? WHERE account=? AND jid=?').run(name,city,summary,stage,Date.now(),account,p.jid);return profile(store,account,p.jid);
}
export function onboard(store,account,jid,history){
 const p=profile(store,account,jid),latest=history.filter(m=>m.direction!=='outgoing').at(-1)?.text||'';
 const combined=latest.match(/^\s*([\p{L}][\p{L} ']{1,60})\s*[,;\n]\s*([\p{L}][\p{L} '\-]{1,70})\s*$/u);
 if(p.asked&&combined)updateProfile(store,account,jid,{name:combined[1],city:combined[2]});
 const name=latest.match(/(?:me chamo|meu nome [ée])\s+([\p{L}][\p{L} ']{1,60}?)(?=\s+(?:e |sou |moro |de |da |do )|[,;.!?]|$)/iu),city=latest.match(/(?:sou de|moro em|minha cidade [ée])\s+([\p{L}][\p{L} '\-]{1,70}?)(?=[,;.!?]|$)/iu);
 if(name||city)updateProfile(store,account,jid,{...(name?{name:name[1]}:{}),...(city?{city:city[1]}:{})});
 const count=store.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE account=? AND jid=? AND direction='incoming'").get(account,jid).n;
 const now=profile(store,account,jid);
  if(count>=1&&!now.asked&&(!now.name||!now.city)){
  store.db.prepare('UPDATE profiles SET asked=1 WHERE account=? AND jid=?').run(account,now.jid);
  return {reply:now.name?'Para te atender melhor, de qual cidade você fala?':'Olá! Para te atender melhor, qual seu nome e sua cidade?',handoff:false,reason:''};
 }
 return null;
}
export function remember(store,account,jid,history,result){
 const p=profile(store,account,jid),incoming=history.filter(m=>m.direction!=='outgoing').at(-1)?.text||'',patch={};
 for(const[key,field]of [['name','customerName'],['city','customerCity']]){const value=clean(result[field]);if(value&&value.length<=100&&norm(incoming).includes(norm(value)))patch[key]=value;}
 patch.summary=typeof result.summary==='string'&&result.summary.trim()?result.summary.slice(0,1800):('Último pedido: '+incoming.slice(0,600)+' | Última resposta: '+result.reply.slice(0,600));
 patch.stage=result.handoff?'waiting_team':'active';return updateProfile(store,account,p.jid,patch);
}
export function listProfiles(store,account){
 const all=store.db.prepare('SELECT * FROM profiles WHERE account=? ORDER BY updated DESC').all(account),seen=new Set(),result=[];
 for(const p of all){const id=store.canonical(account,p.jid);if(seen.has(id))continue;seen.add(id);const c=store.contact(account,p.jid)||store.contact(account,id);result.push({...p,jid:id,displayName:p.name||c?.name||id,messages:store.related(account,id).reduce((n,c)=>n+store.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE account=? AND jid=?').get(account,c.jid).n,0)});}
 return result;
}
