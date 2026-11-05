export function phoneJid(value){
 const international=/^\s*\+/.test(String(value));let digits=String(value).replace(/\D/g,'');
 if(!international&&(digits.length===10||digits.length===11))digits='55'+digits;
 if(!(international?/^[1-9]\d{7,14}$/:/^[1-9]\d{11,14}$/).test(digits))throw Error('Telefone inválido: use DDD e número; para outros países, use +código do país');
 return digits+'@s.whatsapp.net';
}
export function parseContactsCSV(text){
 if(typeof text!=='string'||text.length>50000)throw Error('CSV deve conter até 50000 caracteres');
 const delimiter=text.split('\n')[0].includes(';')?';':',';
 let rows=[],row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(c===delimiter||c==='\n')){row.push(cell.trim());cell='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}
  else if(c!=='\r')cell+=c;
 }
 if(quoted)throw Error('CSV com aspas incompletas');
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 const headers=(rows.shift()||[]).map(h=>h.toLowerCase().replace(/^\uFEFF/,''));
 const phone=headers.findIndex(h=>['telefone','whatsapp','numero','phone'].includes(h)),name=headers.findIndex(h=>['nome','name'].includes(h));
 if(phone<0)throw Error('CSV precisa de uma coluna telefone (e opcionalmente nome)');
 const contacts=new Map();
 for(const [index,r]of rows.entries()){try{const jid=phoneJid(r[phone]||'');contacts.set(jid,{jid,name:name>=0?r[name]||jid:jid});}catch{throw Error('Telefone inválido na linha '+(index+2));}}
 if(contacts.size>500)throw Error('Importe no máximo 500 contatos por vez');
 return [...contacts.values()];
}
export function parseManualContacts(text){
 if(typeof text!=='string'||text.length>50000)throw Error('Lista manual muito grande');
 const contacts=new Map();
 for(const [i,line] of text.split(/\r?\n/).entries()){
  if(!line.trim())continue;
  const parts=line.split(';');if(parts.length>2)throw Error('Use telefone ou nome;telefone na linha '+(i+1));
  const raw=parts.at(-1).trim();let jid;try{jid=phoneJid(raw);}catch{throw Error('Telefone inválido na linha '+(i+1));}
  contacts.set(jid,{jid,name:parts.length===2?parts[0].trim()||jid:jid});
 }
 if(!contacts.size||contacts.size>500)throw Error('Informe entre 1 e 500 telefones, um por linha');
 return [...contacts.values()];
}
export function ninthDigitAlternative(jid){
 const number=jid.split('@')[0];if(!/^55\d{10,11}$/.test(number))return null;
 const prefix=number.slice(0,4),local=number.slice(4);
 // Fixed lines (2–5) are never modified. No DDD-specific assumptions.
 if(local.length===8&&/^[6-9]\d{7}$/.test(local))return prefix+'9'+local+'@s.whatsapp.net';
 if(local.length===9&&/^9[6-9]\d{7}$/.test(local))return prefix+local.slice(1)+'@s.whatsapp.net';
 return null;
}
export async function resolveRecipients(contacts,lookup,{autoNinth=true,canonical=async j=>j,trusted=()=>false}={}){
 const seen=new Set(),valid=[],excluded=[],deadline=Date.now()+60000;
 for(const c of contacts){
  try{
   if(Date.now()>deadline)throw Error('Tempo máximo de verificação excedido');
   let resolved=c.jid,note='Contato sincronizado';
   if(!c.jid.endsWith('@lid')&&!trusted(c.jid)){
    let result=await lookup(c.jid);
    const alt=autoNinth?ninthDigitAlternative(c.jid):null;
    if(!result?.exists&&alt)result=await lookup(alt);
    if(!result?.exists||!/@(s\.whatsapp\.net|lid)$/.test(result.jid||'')){excluded.push({...c,reason:'Número não encontrado no WhatsApp'});continue;}
    resolved=result.jid;note=resolved===c.jid?'WhatsApp confirmado':'Formato corrigido/normalizado pelo WhatsApp';
   }
   const identity=await canonical(resolved);if(seen.has(identity)){excluded.push({...c,reason:'Destinatário duplicado'});continue;}
   seen.add(identity);valid.push({...c,original:c.jid,jid:resolved,note});
  }catch{excluded.push({...c,reason:'Falha ao verificar; não incluído no envio'});}
 }
 return {valid,excluded};
}
