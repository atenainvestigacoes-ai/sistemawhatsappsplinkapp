import {randomUUID} from 'node:crypto';
const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const paymentLabels={pix:'Pix',credito:'cartão de crédito',debito:'cartão de débito',boleto:'boleto',link:'link de pagamento',shopee:'Shopee',mercadolivre:'Mercado Livre'};
const enabledPayments=store=>String(store.setting('payment_methods',process.env.SPLINK_PAYMENT_METHODS||'pix')).split(',').map(s=>s.trim()).filter(s=>paymentLabels[s]);
export function listOrders(store,account){return store.db.prepare('SELECT * FROM orders WHERE account=? ORDER BY updated DESC LIMIT 200').all(account).map(r=>({...JSON.parse(r.record),id:r.id,jid:r.jid,status:r.status}));}
export function cartContext(store,account,jid){
 const ids=[...new Set([jid,store.canonical(account,jid),...store.related(account,jid).map(c=>c.jid)])];
 const row=store.db.prepare('SELECT * FROM orders WHERE account=? AND jid IN ('+ids.map(()=>'?').join(',')+') ORDER BY updated DESC LIMIT 1').get(account,...ids);
 return row?{...JSON.parse(row.record),id:row.id,status:row.status}:{items:[],subtotalCents:0,customer:{},payment:'',status:'empty',paid:false};
}
function priced(store,account,items){
 if(!Array.isArray(items)||!items.length||items.length>20)throw Error('Escolha de 1 a 20 itens para o pedido.');
 const seen=new Set();return items.map(i=>{
  const sku=String(i.sku||'').trim().toLowerCase();if(seen.has(sku))throw Error('Confirme a quantidade total de cada produto.');seen.add(sku);
  const row=store.db.prepare('SELECT record FROM products WHERE account=? AND sku=?').get(account,sku);if(!row)throw Error('Não identifiquei esse produto no catálogo. Pode confirmar o modelo ou enviar uma foto?');
  const p=JSON.parse(row.record),q=i.quantity;if(!Number.isInteger(q)||q<1||q>10000)throw Error('Qual quantidade você deseja desse produto?');
  if(!Number.isFinite(p.estoque))throw Object.assign(Error(`O estoque de ${p.nome} precisa ser confirmado pela equipe.`),{handoff:true});
  if(p.ativo===false||p.estoque<q)throw Error(`A quantidade solicitada de ${p.nome} não está disponível na última atualização. Quer ajustar a quantidade?`);
  if(!Number.isFinite(p.preco)||p.preco<=0)throw Object.assign(Error(`O preço de ${p.nome} precisa ser confirmado pela equipe.`),{handoff:true});
  const unitCents=Math.round(p.preco*100);return{sku:p.sku,name:p.nome,quantity:q,unitCents,lineCents:unitCents*q};
 });
}
export function postalCode(text){return String(text||'').match(/(?<!\d)\d{5}-?\d{3}(?!\d)/)?.[0].replace(/\D/g,'')||'';}
export function recentCustomerTurn(history){let i=history.length-1;while(i>=0&&history[i].direction!=='outgoing')i--;return history.slice(i+1).filter(m=>m.direction==='incoming').map(m=>m.text||'').join('\n');}
export function missingOrderData(cart){const c=cart.customer||{};return [!c.name&&'nome completo',![11,14].includes(digits(c.taxId).length)&&'CPF ou CNPJ',!c.address&&'rua ou avenida, número e bairro',!c.city&&'cidade e estado',!(c.postalCode||postalCode(c.address))&&'CEP (8 números)',!c.contact&&'telefone de contato',!c.email&&'e-mail',!cart.payment&&'forma de pagamento'].filter(Boolean);}
export function orderSummary(cart){return `Pedido ${cart.id.slice(0,8)}:\n`+cart.items.map(i=>`${i.quantity}x ${i.name.slice(0,80)} — ${money(i.lineCents)}`).join('\n')+`\nSubtotal dos produtos: ${money(cart.subtotalCents)}. Frete a confirmar; sem reserva de estoque.`;}
function paymentOptions(store){return enabledPayments(store).map(m=>paymentLabels[m]).join(', ')||'confirmar com a equipe';}
export function applyOrder(store,account,jid,action,{latest,text,city='',name=''}={}){
 if(!action||action.action==='none')return null;
 let cart=cartContext(store,account,jid);
 if(action.action==='confirm'){
  if(!cart.id)throw Error('Primeiro vamos escolher os produtos do pedido.');
  if(!/^(?:sim[,.! ]*)?(?:confirmo(?: o pedido| esse pedido| a compra)?|pode fechar(?: o pedido)?|fechar pedido|pode confirmar(?: o pedido)?|sim|confirmado)[.! ]*$/i.test(norm(text)))throw Error('Quer confirmar este pedido? Responda “confirmo o pedido”.');
  if(cart.status==='awaiting_payment')return{reply:`O pedido ${cart.id.slice(0,8)} já está registrado e aguardando a equipe concluir pagamento e entrega.`,orderId:cart.id,confirmed:false};
  const review=Number(store.setting('order_review_sent:'+cart.id,'0'));
  if(!review||latest<=review||store.setting('order_review_revision:'+cart.id)!==cart.revision)throw Error('Primeiro confira o resumo atualizado do pedido. Se não o recebeu completo, peça “resumo do pedido”.');
  const missing=missingOrderData(cart);if(missing.length)throw Error('Para fechar o pedido, preciso de '+missing[0]+'.');
  const current=priced(store,account,cart.items);if(JSON.stringify(current)!==JSON.stringify(cart.items))throw Error('O preço do catálogo mudou. Precisamos conferir um novo resumo antes de confirmar.');
  cart.status='awaiting_payment';cart.confirmedAt=Date.now();cart.paid=false;
  store.db.prepare('UPDATE orders SET status=?,record=?,updated=? WHERE account=? AND id=?').run(cart.status,JSON.stringify(cart),Date.now(),account,cart.id);
  store.log('order_confirmed',{account,jid,id:cart.id,subtotalCents:cart.subtotalCents});
  return{reply:`Pedido ${cart.id.slice(0,8)} registrado! Nossa equipe vai concluir o pagamento e combinar a entrega com você. O pagamento ainda está pendente.`,orderId:cart.id,confirmed:true};
 }
 if(action.action!=='set')return null;
 // A customer introducing themselves is CRM data, not a request to create an empty cart.
 if(!action.items?.length&&!cart.items?.length)return null;
 if(cart.status==='awaiting_payment')throw Error('Seu pedido já está registrado. Nossa equipe vai ajudar com alterações ou uma nova compra.');
 const items=priced(store,account,action.items?.length?action.items:cart.items);
 cart={...cart,id:cart.id||randomUUID(),revision:randomUUID(),status:'collecting',items,subtotalCents:items.reduce((n,i)=>n+i.lineCents,0),paid:false,customer:{...cart.customer},payment:cart.payment||''};
 const input=action.customer||{},normalized=norm(text);
 for(const key of ['name','email','city']){const v=String(input[key]||'').trim();if(v&&v.length<=400&&normalized.includes(norm(v))){if(key==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))continue;cart.customer[key]=v;}}
 const cep=postalCode(text);if(cep)cart.customer.postalCode=cep;
 const supplied=String(input.address||'').trim();
 if(supplied&&supplied.length<=400&&normalized.includes(norm(supplied))&&/[a-zÀ-ÿ]/i.test(supplied)&&/\d/.test(supplied)&&!/^cep\b/i.test(supplied))cart.customer.address=supplied;
 // Preserve the customer's exact street spelling; never normalize it into an invented address.
 const street=String(text||'').split(/\n/).map(t=>t.trim()).find(t=>/^(?:rua|r\.|avenida|av\.?|travessa|alameda|rodovia|estrada|praça)\s+.+\d/i.test(t));
 if(street&&street.length<=400)cart.customer.address=street;
 if(!cart.customer.city&&city)cart.customer.city=city;
 if(!cart.customer.name&&name)cart.customer.name=name;
 for(const key of ['taxId','contact']){const v=digits(input[key]);if(v&&digits(text).includes(v)&&((key==='taxId'&&[11,14].includes(v.length))||(key==='contact'&&v.length>=10&&v.length<=13)))cart.customer[key]=v;}
 if(!cart.customer.contact&&jid.endsWith('@s.whatsapp.net'))cart.customer.contact=jid.split('@')[0];
 const method=norm(action.payment);const aliases={pix:['pix'],credito:['credito','credit'],debito:['debito','debit'],boleto:['boleto'],link:['link'],shopee:['shopee','shoope'],mercadolivre:['mercado livre','mercadolivre']};
 if(aliases[method]?.some(a=>normalized.includes(a))){if(enabledPayments(store).includes(method))cart.payment=method;}
 const missing=missingOrderData(cart);cart.status=missing.length?'collecting':'review';cart.updated=Date.now();
 store.db.prepare('INSERT INTO orders(id,account,jid,status,record,created,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,record=excluded.record,updated=excluded.updated').run(cart.id,account,store.canonical(account,jid),cart.status,JSON.stringify(cart),Date.now(),Date.now());
 store.setSetting('order_review_sent:'+cart.id,'0');
 const question=missing.length?(missing[0]==='forma de pagamento'?`Qual forma de pagamento prefere: ${paymentOptions(store)}?`:`Para continuar, pode informar ${missing[0]}?`):`Dados: ${cart.customer.name}; CPF/CNPJ: ${cart.customer.taxId}; ${cart.customer.address}, ${cart.customer.city}; CEP: ${cart.customer.postalCode||postalCode(cart.customer.address)}; contato: ${cart.customer.contact}; e-mail: ${cart.customer.email}; pagamento: ${cart.payment}.\nSe estiver tudo certo, responda “confirmo o pedido”.`;
 return{reply:(missing.length&&!action.items?.length?'Obrigado!':orderSummary(cart))+'\n'+question,orderId:cart.id,confirmed:false,review:!missing.length};
}
