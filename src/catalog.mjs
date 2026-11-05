import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import path from 'node:path';
import {root,runtime} from './config.mjs';
const normal=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stopWords=new Set('qual quais para tem voce voces quero produto produtos preco valor quanto uma com por bom dia ola disponivel disponibilidade estoque favor algum alguma preciso procura procurando gostaria saber sobre esse essa isso pode podeis vende vendem ter sao esta modelo foto imagem meu minha seu sua tudo bem'.split(' '));
const tokens=s=>[...new Set(normal(s).split(/[^a-z0-9]+/).filter(w=>w.length>2&&!stopWords.has(w)).map(w=>w.length>3&&w.endsWith('s')?w.slice(0,-1):w))];
// These are search alternatives, not assertions that two items are interchangeable.
const synonyms=[['espatula','rodinho','rodo','squeegee'],['pelicula','insulfilm'],['capa','protetor','protetora','protecao','protege'],['banco','assento','seat'],['porta','door'],['lamina','blade'],['estilete','cutter']];
function near(a,b){
 if(a===b)return true;if(a.length<5||b.length<5||/\d/.test(a+b)||Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,errors=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++errors>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return errors+(i<a.length||j<b.length?1:0)<=1;
}
function equivalent(a,b){return near(a,b)||synonyms.some(g=>g.includes(a)&&g.includes(b));}
function searchProducts(rows,query){
 const words=tokens(query),anchors=words.filter(w=>['banco','assento','seat','porta','door','soprador','parabrisa','vidro','capo'].includes(w));
 return rows.map(p=>{
  const title=tokens(p.nome+' '+p.sku),details=tokens(p.descricao||''),all=[...title,...details];
  if(anchors.some(w=>!all.some(t=>equivalent(w,t))))return{p,score:0,coverage:0};
  let hit=0,score=0;for(const w of words){if(title.includes(w)){score+=6;hit++;}else if(title.some(t=>equivalent(w,t))){score+=4;hit++;}else if(details.some(t=>equivalent(w,t))){score++;hit++;}}
  return{p,score,coverage:words.length?hit/words.length:0};
 }).filter(r=>!words.length||r.score>0).sort((a,b)=>b.score-a.score||(b.p.estoque||0)-(a.p.estoque||0));
}
export async function readCatalog(request){
 if(typeof request.base64!=='string'||request.base64.length>7*1024*1024)throw Error('Planilha acima de 5 MB');
 return new Promise((resolve,reject)=>{
  const p=spawn(runtime.python,[path.join(root,'src/read_catalog.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});let out='';const timer=setTimeout(()=>{p.kill();reject(Error('Tempo de leitura da planilha excedido'));},45000);
  p.stdout.on('data',d=>{out+=d;if(out.length>12*1024*1024){p.kill();reject(Error('Catálogo grande demais'));}});p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);try{const r=JSON.parse(out);if(code!==0||r.error)throw Error(r.error||'Não foi possível ler a planilha');resolve(r);}catch(e){reject(e);}});p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify(request));
 });
}
export function stageCatalog(store,account,parsed){
 const id=randomUUID();store.db.prepare('INSERT INTO catalog_imports(id,account,source,records,created) VALUES(?,?,?,?,?)').run(id,account,parsed.source,JSON.stringify(parsed.products),Date.now());
 return{id,count:parsed.products.length,preview:parsed.products.slice(0,20),source:parsed.source,sheets:parsed.sheets,sheet:parsed.sheet,generatedSkus:parsed.generatedSkus};
}
export function catalogStatus(store,account){return{count:store.db.prepare('SELECT COUNT(*) AS n FROM products WHERE account=?').get(account).n,version:store.setting('catalog_version:'+account),updated:store.setting('catalog_updated:'+account),source:store.setting('catalog_source:'+account)};}
export function commitCatalog(store,account,id,mode){
 if(!['replace','upsert'].includes(mode))throw Error('Modo de importação inválido');
 const staged=store.db.prepare('SELECT * FROM catalog_imports WHERE id=? AND account=?').get(id,account);if(!staged)throw Error('Prévia inexistente ou de outra conta');
 const rows=JSON.parse(staged.records);store.db.exec('BEGIN IMMEDIATE');
 try{
  if(mode==='replace')store.db.prepare('DELETE FROM products WHERE account=?').run(account);
  const stmt=store.db.prepare('INSERT INTO products(account,sku,record,updated) VALUES(?,?,?,?) ON CONFLICT(account,sku) DO UPDATE SET record=excluded.record,updated=excluded.updated');
  for(const r of rows)stmt.run(account,r.sku.toLowerCase(),JSON.stringify(r),Date.now());
  store.setSetting('catalog_version:'+account,randomUUID());store.setSetting('catalog_updated:'+account,Date.now());store.setSetting('catalog_source:'+account,staged.source);
  store.db.prepare("UPDATE drafts SET status='stale' WHERE account=? AND source='reply' AND status IN ('pending','approved')").run(account);
  store.db.prepare('DELETE FROM catalog_imports WHERE id=?').run(id);store.log('catalog_import',{account,count:rows.length,mode,source:staged.source});store.db.exec('COMMIT');
 }catch(e){store.db.exec('ROLLBACK');throw e;}return catalogStatus(store,account);
}
export function catalogContext(store,account,history,jid){
 const status=catalogStatus(store,account);if(!status.count)return{...status,products:[]};
 const query=history.filter(m=>m.direction!=='outgoing').at(-1)?.text||'';
 const rows=store.db.prepare('SELECT record FROM products WHERE account=?').all(account).map(r=>JSON.parse(r.record));
 const ranked=searchProducts(rows,query);
 const menuRow=jid?store.db.prepare('SELECT record,created FROM conversation_menu WHERE account=? AND jid=?').get(account,jid):null,menu=menuRow&&Date.now()-menuRow.created<86400000?JSON.parse(menuRow.record):null;
 const selected=menu?.kind==='selected'?rows.filter(p=>menu.items.some(i=>i.sku===p.sku)):[];
 return{...status,matched:ranked.length,selection:menu,search:{query,approximate:true,note:'Resultados são candidatos por nome, sinônimos e finalidade. Confirme diferenças de uso/modelo antes de afirmar equivalência. Ausência de correspondência não comprova ausência no catálogo.'},products:[...selected,...ranked.map(r=>r.p).filter(p=>!selected.some(s=>s.sku===p.sku))].slice(0,12)};
}
const groups=[['Borrachas e feltros',/borracha|feltro|refil/],['Lâminas e corte',/lamina|estilete|corte|olfa|blade|tesoura/],['Espátulas e rodos',/espatula|rodo|rodinho|squeegee|raspador|bulldozer/],['Proteção e acessórios',/protetor|capa|bolsa|luva|avental|magnet|cabo/],['Kits e limpeza',/kit|limpa|pulveriz|spray|pano/],['Outras ferramentas',/.*/]];
const families=[['Rodos e rodinhos',/rodo|rodinho|squeegee/],['Ferramentas para PPF',/ppf/],['Lâminas',/lamina|olfa|blade/],['Linhas de corte',/linha.*corte|designlina/],['Kits de ferramentas',/kit.*(?:ferrament|detalhamento)/],['Espátulas',/espatula|bulldozer/],['Borrachas',/borracha|refil/],['Feltros',/feltro/],['Capas de proteção',/capa/]];
const familyProducts=(products,index)=>products.filter(p=>{const name=normal(p.nome);return families[index][1].test(name)&&!(index===0&&/borracha|refil|afia|cabo/.test(name))&&!(index===5&&/afia/.test(name));});
export function catalogInteraction(store,account,jid,history,{hasCart=false}={}){
 const text=normal(history.filter(m=>m.direction!=='outgoing').at(-1)?.text||'').trim().replace(/\bcatalago\b/g,'catalogo');
 if(/atendente|humano|pessoa|negoci|desconto|reembolso|cancelamento|reclam|pagamento|nota fiscal|defeito|quebrad|nao funciona|suporte|troca|garantia|problema|como (?:usar|utilizar)|diferenca|\bnao (?:quero|preciso|procuro)\b/.test(text))return null;
 if(/^(?:voltar|menu|inicio)$/.test(text))return catalogInteraction(store,account,jid,[{direction:'incoming',text:'catálogo'}],{hasCart});
 const allProducts=store.db.prepare('SELECT record FROM products WHERE account=?').all(account).map(r=>JSON.parse(r.record)),products=allProducts.filter(p=>p.ativo!==false&&(p.estoque||0)>0);
 const previous=store.db.prepare('SELECT * FROM conversation_menu WHERE account=? AND jid=?').get(account,jid);
 const save=record=>store.db.prepare('INSERT INTO conversation_menu(account,jid,record,created) VALUES(?,?,?,?) ON CONFLICT(account,jid) DO UPDATE SET record=excluded.record,created=excluded.created').run(account,jid,JSON.stringify(record),Date.now());
 const productMenu=(items,title,offset=0)=>{const page=items.slice(offset,offset+6);save({kind:'products',title,items:page.map(p=>({sku:p.sku})),all:items.map(p=>({sku:p.sku})),offset});return{reply:`${title}:\n\n`+page.map((p,i)=>`${i+1}. ${p.nome}\n   ${p.preco!=null?Number(p.preco).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Preço sob consulta'} · Código: ${p.sku}`).join('\n\n')+`\n\nResponda com o número do modelo.${items.length>offset+6?' Para outros modelos, diga “mais”.':''}`,handoff:false,reason:'Menu de produtos disponíveis',menu:true};};
 if(/^mais(?: modelos| opcoes)?$/.test(text)&&previous){const menu=JSON.parse(previous.record);if(menu.kind==='products'&&menu.all)return productMenu(menu.all.map(i=>products.find(p=>p.sku===i.sku)).filter(Boolean),menu.title,(menu.offset||0)+6);}
 if(!/catalogo/.test(text)&&families.some(([,regex])=>regex.test(text))){
  const requested=families.map(([name,regex],index)=>({name,regex,index})).filter(f=>f.regex.test(text));
  const available=requested.filter(f=>familyProducts(products,f.index).length);
  if(available.length>1){save({kind:'families',items:available.map(f=>({name:f.name,index:f.index}))});return{reply:'Vamos escolher os modelos do seu pedido. Qual tipo você quer ver primeiro?\n\n'+available.map((f,i)=>`${i+1}. ${f.name}`).join('\n')+'\n\nDepois seguimos com os outros itens que você pediu.',handoff:false,reason:'Seleção por tipos solicitados',menu:true};}
  if(available.length===1){const candidates=familyProducts(products,available[0].index),matches=searchProducts(candidates,text),best=matches[0];if(!best){const old=previous?JSON.parse(previous.record):null;if(old?.kind==='clarify'&&old.query===text)return null;save({kind:'clarify',query:text,items:[]});return{reply:'Para localizar o modelo certo, pode explicar onde vai usar ou enviar uma foto do produto?',handoff:false,reason:'Confirmar finalidade antes de sugerir outro tipo de produto'};}const items=best.coverage>=0.8?matches.filter(m=>m.score===best.score).map(m=>m.p):matches.map(m=>m.p);return productMenu(items,available[0].name);}
 }
 if(/catalogo|conhecer (?:os )?produtos|ver (?:os )?produtos/.test(text)&&products.length){
  const available=groups.map(([name,regex],index)=>({name,index,products:products.filter(p=>groups.findIndex(([,r])=>r.test(normal(p.nome)))===index)})).filter(g=>g.products.length);
  save({kind:'categories',items:available.map(g=>({name:g.name,index:g.index}))});
  return{reply:'Claro! Qual categoria você quer ver?\n\n'+available.map((g,i)=>`${i+1}. ${g.name}`).join('\n')+(/^https:\/\//.test(process.env.SPLINK_CATALOG_URL||'')?'\n\nCatálogo completo: '+process.env.SPLINK_CATALOG_URL.slice(0,500):''),handoff:false,reason:'',menu:true};
 }
 const choice=text.match(/^(?:opcao\s*)?([1-9])(?:\s*por favor)?$/);
 if(choice&&previous&&Date.now()-previous.created<86400000){
  const menu=JSON.parse(previous.record);if(menu.kind==='selected')return null;const item=menu.items[Number(choice[1])-1];if(!item)return{reply:'Qual dessas opções você quer conhecer? Pode me dizer o nome do produto também.',handoff:false,reason:''};
  if(menu.kind==='families')return productMenu(familyProducts(products,item.index),item.name);
  if(menu.kind==='categories'){
   return productMenu(products.filter(p=>groups.findIndex(([,r])=>r.test(normal(p.nome)))===item.index),item.name);
  }
  const product=products.find(p=>p.sku===item.sku);if(product){save({kind:'selected',items:[{sku:product.sku}]});return{reply:`${product.nome}\nCódigo: ${product.sku}\n${product.preco!=null?Number(product.preco).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Preço sob consulta'} por unidade.\n\nQuantas unidades deseja?`,handoff:false,reason:'Modelo selecionado; aguardar quantidade',menu:true};}
 }
 if(/\btem\b|disponiv|estoque/.test(text)){
   const matches=searchProducts(allProducts,text);
   if(matches.length&&matches[0].coverage>=0.75&&(!matches[1]||matches[0].score>matches[1].score)&&((matches[0].p.estoque??1)<=0||matches[0].p.ativo===false))return{reply:`${matches[0].p.nome} está indisponível na última atualização do estoque. Quer que eu veja outra opção para você?`,handoff:false,reason:''};
 }
 if(!hasCart&&/\b(?:tem|quero|preciso|procuro|procurando|voces vendem)\b/.test(text)&&tokens(text).length&&allProducts.length){
  const matches=searchProducts(allProducts,text),needsClarification=!matches.length||matches[0].coverage<0.65;
  if(needsClarification){
   const menu=previous?JSON.parse(previous.record):null;
   if(menu?.kind!=='clarify'||menu.query!==text||Date.now()-previous.created>=86400000){
    save({kind:'clarify',items:[],query:text});
    return{reply:'Para eu localizar o item certo, pode me dizer como você vai usar ou enviar uma foto dele?',handoff:false,reason:'Identificação do produto pendente; esclarecer nome ou finalidade antes de escalar'};
   }
  }
 }
 if(/^[a-z]{1,3}$/.test(text)&&!['oi','ola','sim','nao','ok'].includes(text))return{reply:'Me conta qual produto você precisa ou como posso te ajudar?',handoff:false,reason:''};
 return null;
}
