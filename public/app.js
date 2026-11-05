const $=id=>document.getElementById(id);let state=null,lastRender='',campaignIds=[],campaignAttachment=null,campaignVersion=0,campaignId='',catalogImportId='',monitorSignature='',selectedCampaign='';
const labels={pending:'Aguardando aprovação',approved:'Na fila / aprovado',sent:'Enviado',stale:'Desatualizado',generating:'Codex preparando',error:'Erro',uncertain:'Envio incerto — confira no celular',handoff:'Precisa de atendente',sending:'Enviando',failed:'Falha',blocked:'Bloqueado',cancelled:'Cancelado'};
function say(text){$('notice').textContent=text;if($('campaignFeedback'))$('campaignFeedback').textContent=text;}
async function api(route,body){const r=await fetch(route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
function button(text,action){const b=document.createElement('button');b.textContent=text;b.onclick=async()=>{b.disabled=true;try{await action();await refresh();}catch(e){say(e.message);}finally{b.disabled=false;}};return b;}
function tag(text){const s=document.createElement('span');s.className='tag';s.textContent=text;return s;}
function render(){
 renderAudience();
 $('status').textContent=`WhatsApp: ${state.connection} · Modo: ${state.mode}`;$('mode').value=state.mode;
 $('allContacts').checked=state.allowAll;
 $('campaignQueueStatus').textContent=state.campaignPaused?'Campanhas pausadas':'Fila de campanhas liberada';
 const cat=state.catalog;$('catalogStatus').textContent=cat?.count?`${cat.count} produtos no catálogo · Última importação: ${new Date(Number(cat.updated)).toLocaleString('pt-BR')} · ${cat.source}`:'Nenhum catálogo importado.';
 if(document.activeElement!==$('replyWait'))$('replyWait').value=state.replyWait||6;if(document.activeElement!==$('replyGap'))$('replyGap').value=state.replyGap||3;if(document.activeElement!==$('replySplit'))$('replySplit').checked=state.replySplit;
 renderCampaignMonitor();
 $('qr').replaceChildren();if(state.qr){const img=document.createElement('img');img.src=state.qr;img.alt='QR code para conectar o WhatsApp';$('qr').append(img);}
 const signature=JSON.stringify([state.contacts,state.drafts]);if(signature===lastRender||document.activeElement?.closest('#drafts'))return;lastRender=signature;
 $('contacts').replaceChildren();
 for(const c of state.contacts){const card=document.createElement('div');card.className='card';const title=document.createElement('strong');title.textContent=`${c.name} · ${c.jid}`;card.append(title);if(c.optout)card.append(tag('Cancelou mensagens'));
  for(const[key,label]of [['allowed','Permitir IA'],['hold','Assumir atendimento / pausar IA'],['consent','Consentimento de campanha confirmado']]){const l=document.createElement('label'),ch=document.createElement('input');ch.type='checkbox';ch.checked=!!c[key];ch.onchange=async()=>{try{await api('/api/contact',{jid:c.jid,[key]:ch.checked});await refresh();}catch(e){say(e.message);}};l.append(ch,document.createTextNode(label));card.append(l);}
  card.append(button('Ver conversa',async()=>{const d=await api('/api/history?jid='+encodeURIComponent(c.jid));$('history').replaceChildren();const p=document.createElement('pre');p.textContent=d.messages.map(m=>`[${m.kind}] ${m.text}${m.issue?'\n⚠ '+m.issue:''}`).join('\n\n');$('history').append(p);}),button('Preparar resposta',async()=>{say('Codex preparando. Pode levar alguns instantes.');await api('/api/generate',{jid:c.jid});say('Rascunho atualizado. Confira antes de aprovar.');}));$('contacts').append(card);
 }
 $('drafts').replaceChildren();
 for(const d of state.drafts){const card=document.createElement('div');card.className='card';const title=document.createElement('strong');title.textContent=d.jid;card.append(title,tag(labels[d.status]||d.status),tag(d.source==='campaign'?'Campanha':d.source==='staff'?'Aviso à equipe':'Resposta'));
  const text=document.createElement('textarea');text.value=d.text;text.rows=3;text.maxLength=4000;text.disabled=d.status!=='pending';text.setAttribute('aria-label','Resposta para '+d.jid);card.append(text);if(d.reason){const p=document.createElement('p');p.textContent=d.reason;card.append(p);}
  if(d.source==='campaign')card.append(tag(`Intervalo: ${d.interval_s||10}s${d.attachment?' · Com anexo':''}`));
  if(d.status==='pending')card.append(button('Aprovar este texto',async()=>{await api('/api/approve',{id:d.id,text:text.value});say('Texto aprovado. Clique em Enviar quando estiver pronto.');}));
  if(d.status==='approved')card.append(button('Enviar resposta aprovada',async()=>{if(!confirm('Enviar esta mensagem para '+d.jid+'?\n\n'+d.text))return;await api('/api/send',{id:d.id});say('Envio registrado.');}));
  $('drafts').append(card);
 }
}
async function refresh(){try{state=await api('/api/status');$('login').hidden=true;$('main').hidden=false;render();}catch(e){$('login').hidden=false;$('main').hidden=true;}}
async function login(token){await api('/api/login',{token});history.replaceState(null,'','/');$('token').value='';await refresh();const k=await api('/api/knowledge');$('knowledge').value=k.text;}
$('loginBtn').onclick=()=>login($('token').value.trim()).catch(e=>say(e.message));
for(const[id,route,body]of [['connect','/api/connect',()=>({})],['disconnect','/api/disconnect',()=>({})],['modeBtn','/api/mode',()=>({mode:$('mode').value})],['saveKnowledge','/api/knowledge',()=>({text:$('knowledge').value})]])$(id).onclick=async()=>{const b=$(id);b.disabled=true;try{if(id==='modeBtn'&&$('mode').value==='auto'&&!confirm('Ativar envio automático para os contatos habilitados?'))return;await api(route,body());say('Alteração aplicada.');await refresh();}catch(e){say(e.message);}finally{b.disabled=false;}};
$('allContacts').onchange=async()=>{try{await api('/api/all-contacts',{enabled:$('allContacts').checked});say('Preferência aplicada às conversas atuais e novas.');await refresh();}catch(e){say(e.message);}};
$('csvFile').onchange=async()=>{const f=$('csvFile').files[0];if(f){if(f.size>50000)return say('CSV acima de 50000 bytes.');$('csv').value=await f.text();}};
$('previewImport').onclick=async()=>{try{const r=await api('/api/import/preview',{csv:$('csv').value});$('importPreview').textContent=`${r.count} contatos válidos:\n`+r.contacts.map(c=>`${c.name} · ${c.jid.split('@')[0]}`).join('\n');}catch(e){say(e.message);}};
$('importBtn').onclick=async()=>{try{const r=await api('/api/import',{csv:$('csv').value,source:$('source').value,consent:$('importConsent').checked});say(`${r.count} contatos importados. Nenhuma mensagem foi enviada.`);await refresh();}catch(e){say(e.message);}};
function invalidateCampaign(){campaignVersion++;campaignIds=[];campaignId='';$('startCampaign').disabled=true;$('campaignPreview').replaceChildren();}
function renderAttachment(){
 $('attachmentPreview').replaceChildren();if(!campaignAttachment)return;
 const p=document.createElement('p');p.textContent=`Anexo validado: ${campaignAttachment.filename} · ${(campaignAttachment.size/1024/1024).toFixed(2)} MB`;$('attachmentPreview').append(p);
 const url='/api/attachment?id='+encodeURIComponent(campaignAttachment.id);
 if(['image','video'].includes(campaignAttachment.kind)){const media=document.createElement(campaignAttachment.kind==='image'?'img':'video');media.src=url;media.style.maxWidth='360px';media.style.maxHeight='220px';if(campaignAttachment.kind==='video'){media.controls=true;media.preload='metadata';}else media.alt=campaignAttachment.filename;$('attachmentPreview').append(media);}
 else{const a=document.createElement('a');a.href=url;a.textContent='Baixar anexo para conferir';$('attachmentPreview').append(a);}
}
$('campaignFile').onchange=()=>{campaignAttachment=null;renderAttachment();invalidateCampaign();};
$('removeAttachment').onclick=()=>{campaignAttachment=null;$('campaignFile').value='';renderAttachment();invalidateCampaign();};
$('uploadAttachment').onclick=async()=>{
 const b=$('uploadAttachment');b.disabled=true;try{
  const f=$('campaignFile').files[0];if(!f)throw Error('Escolha um arquivo primeiro');if(f.size>16*1024*1024)throw Error('Arquivo acima de 16 MB');
  const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Falha ao ler arquivo'));reader.readAsDataURL(f);});
  const uploaded=await api('/api/attachment',{name:f.name,base64:encoded});if($('campaignFile').files[0]!==f)throw Error('O arquivo selecionado mudou; carregue o novo arquivo');
  campaignAttachment=uploaded;invalidateCampaign();renderAttachment();say('Anexo carregado e validado. Nenhuma mensagem foi enviada.');
 }catch(e){campaignAttachment=null;renderAttachment();say(e.message);}finally{b.disabled=false;}
};
$('campaignBtn').onclick=async()=>{
 const b=$('campaignBtn');b.disabled=true;invalidateCampaign();const version=campaignVersion;try{
  if($('campaignFile').files.length&&!campaignAttachment)throw Error('Carregue e valide o anexo selecionado primeiro');
  say('Verificando os destinatários no WhatsApp. Nenhum envio está sendo feito.');
  const r=await api('/api/campaign',{title:$('campaignTitle').value,text:$('campaign').value,target:$('target').value,manual:$('manualNumbers').value,consent:$('campaignConsent').checked,intervalSec:Number($('intervalSec').value),autoNinth:$('autoNinth').checked,attachment:campaignAttachment?.id||''});
  if(version!==campaignVersion){say('A campanha foi alterada durante a consulta. Prepare uma nova prévia.');return;}
  campaignIds=r.drafts.map(d=>d.id);campaignId=r.campaignId;const pre=document.createElement('pre');
  pre.textContent=`MENSAGEM FINAL:\n${r.text}\n\nANEXO: ${r.attachment?.filename||'nenhum'}\nINTERVALO: ${r.intervalSec} segundos\n\n${r.recipients.length} DESTINATÁRIOS:\n`+r.recipients.map(c=>`${c.name} · ${c.original} → ${c.jid} · ${c.note}`).join('\n')+`\n\n${r.excluded.length} EXCLUÍDOS:\n`+r.excluded.map(c=>`${c.jid}: ${c.reason}`).join('\n');
  $('campaignPreview').replaceChildren(pre);$('startCampaign').disabled=!campaignIds.length;say('Prévia pronta. Confira os dados e clique em 2. INICIAR DISPARO.');await refresh();
 }catch(e){say(e.message);}finally{b.disabled=false;}
};
for(const id of ['campaignTitle','campaign','target','campaignConsent','manualNumbers','intervalSec','autoNinth'])$(id).addEventListener('input',invalidateCampaign);
$('pauseCampaigns').onclick=async()=>{try{await api('/api/campaign/pause',{paused:true});say('Campanhas pausadas. O atendimento automático continua no modo escolhido.');await refresh();}catch(e){say(e.message);}};
$('resumeCampaigns').onclick=async()=>{try{await api('/api/campaign/pause',{paused:false});say('Fila de campanhas liberada. Envios globalmente pausados continuam bloqueados.');await refresh();}catch(e){say(e.message);}};
$('startCampaign').onclick=async()=>{if(!confirm(`Iniciar o disparo exibido para ${campaignIds.length} destinatários?`))return;try{const r=await api('/api/campaign/start',{campaignId,ids:campaignIds});selectedCampaign=campaignId;campaignIds=[];$('startCampaign').disabled=true;say(`${r.queued} mensagens na fila. Acompanhe em Monitoramento de disparos.`);location.hash='monitorSection';await refresh();}catch(e){say(e.message);}};
function renderCampaignMonitor(){
 const campaigns=state.campaigns||[],signature=JSON.stringify(campaigns);if(signature===monitorSignature)return;monitorSignature=signature;$('campaignMonitor').replaceChildren();
 if(!campaigns.length){const p=document.createElement('p');p.textContent='Nenhum disparo preparado. Use “Novo disparo”, prepare a prévia e clique em “INICIAR DISPARO”.';$('campaignMonitor').append(p);return;}
 const states={prepared:'Aguardando início',running:'Em andamento',paused:'Pausada',completed:'Finalizada',cancelled:'Cancelada',cancelling:'Cancelando — aguardando envio iniciado'};
 for(const c of campaigns){const card=document.createElement('div');card.className='card';const title=document.createElement('strong');title.textContent=c.title+' · '+(states[c.state]||c.state);card.append(title);
  const progress=document.createElement('progress');progress.max=100;progress.value=c.progress;progress.setAttribute('aria-label','Progresso de '+c.title);card.append(progress);
  const p=document.createElement('p');p.textContent=`${c.progress}% · Enviados ${c.counts.sent}/${c.counts.total} · Na fila ${c.counts.waiting} · Enviando ${c.counts.sending} · Falhas ${c.counts.failed} · Incertos ${c.counts.uncertain} · Cancelados ${c.counts.cancelled} · Excluídos ${c.excluded.length}`;card.append(p);
  card.append(button('Ver destinatários e resultados',async()=>{selectedCampaign=c.id;await refreshCampaignDetail();}));
  if(c.state==='prepared'&&c.counts.total)card.append(button('INICIAR DISPARO',async()=>{if(!confirm(`Iniciar “${c.title}” para ${c.counts.total} destinatários? Confira o conteúdo em detalhes antes de confirmar.`))return;await api('/api/campaign/start',{campaignId:c.id});selectedCampaign=c.id;}));
  for(const[action,label]of [['pause','Pausar'],['resume','Retomar'],['cancel','Cancelar pendentes']])if(!c.finished&&c.state!=='prepared'&&(action==='cancel'||action==='pause'&&c.state==='running'||action==='resume'&&c.state==='paused'))card.append(button(label,async()=>{if(action==='cancel'&&!confirm('Cancelar somente os envios ainda não iniciados desta campanha?'))return;await api('/api/campaign/control',{id:c.id,action});}));
  const link=document.createElement('a');link.href='/api/campaign/report?id='+encodeURIComponent(c.id);link.textContent=c.finished?'Baixar relatório final CSV':'Baixar relatório parcial CSV';card.append(link);$('campaignMonitor').append(card);
 }
 if(selectedCampaign)void refreshCampaignDetail().catch(e=>say(e.message));
}
async function refreshCampaignDetail(){
 if(!selectedCampaign)return;const c=await api('/api/campaign/detail?id='+encodeURIComponent(selectedCampaign));const wrap=document.createElement('div');wrap.className='table-wrap';const table=document.createElement('table');
 const head=document.createElement('tr');for(const label of ['Destinatário','Nome','Status','Motivo']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);
 for(const d of c.rows){const tr=document.createElement('tr');for(const value of [d.jid,d.name,labels[d.status]||d.status,d.reason]){const td=document.createElement('td');td.textContent=value||'';tr.append(td);}table.append(tr);}wrap.append(table);
 const pre=document.createElement('pre');pre.textContent='Conteúdo da campanha:\n'+(c.rows[0]?.text||'Sem destinatários válidos');$('campaignDetails').replaceChildren(pre,wrap);
}
$('saveReplySettings').onclick=async()=>{try{await api('/api/reply-settings',{wait:Number($('replyWait').value),gap:Number($('replyGap').value),split:$('replySplit').checked});say('Ritmo de atendimento salvo.');await refresh();}catch(e){say(e.message);}};
async function loadCRM(){
 const r=await api('/api/crm');$('crmList').replaceChildren();
 if(!r.customers.length){$('crmList').textContent='Os clientes aparecem aqui após receber atendimento.';return;}
 for(const c of r.customers){const card=document.createElement('div');card.className='card';const title=document.createElement('strong');title.textContent=c.displayName+' · '+(c.city||'Cidade não informada')+' · '+c.stage;const p=document.createElement('p');p.textContent=c.summary||'Sem resumo ainda';card.append(title,p,tag(c.messages+' mensagens salvas'));
 card.append(button('Editar cliente',async()=>{$('crmEditor').hidden=false;$('crmJid').value=c.jid;$('crmName').value=c.name;$('crmCity').value=c.city;$('crmStage').value=c.stage;$('crmSummary').value=c.summary;}),button('Ver histórico salvo',async()=>{const h=await api('/api/crm/history?jid='+encodeURIComponent(c.jid));$('crmHistory').textContent=h.messages.map(m=>new Date(m.created).toLocaleString('pt-BR')+' · '+(m.direction==='outgoing'?'Equipe':'Cliente')+': '+m.text).join('\n\n');}));$('crmList').append(card);}
}
$('loadCRM').onclick=()=>loadCRM().catch(e=>say(e.message));
$('saveCRM').onclick=async()=>{try{await api('/api/crm/update',{jid:$('crmJid').value,name:$('crmName').value,city:$('crmCity').value,stage:$('crmStage').value,summary:$('crmSummary').value});say('Cliente atualizado no CRM local.');await loadCRM();}catch(e){say(e.message);}};
$('saveProductPhoto').onclick=async()=>{const b=$('saveProductPhoto');b.disabled=true;try{const f=$('productPhotoFile').files[0];if(!f)throw Error('Escolha a foto do produto');if(f.size>5*1024*1024)throw Error('Foto acima de 5 MB');const sku=$('productPhotoSku').value.trim();if(!sku)throw Error('Informe o código do produto');const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});const a=await api('/api/attachment',{name:f.name,base64});await api('/api/product/photo',{sku,attachment:a.id});say('Foto vinculada ao produto '+sku+'.');}catch(e){say(e.message);}finally{b.disabled=false;}};
function renderAudience(){const manual=$('target').value==='manual';$('manualNumbers').hidden=!manual;document.querySelector('label[for="manualNumbers"]').hidden=!manual;$('audienceCount').textContent=$('target').value==='conversations'?`${state?.conversationCount||0} conversas individuais sincronizadas. Preparar a prévia não envia mensagens. Se faltarem conversas, solicite a sincronização abaixo.`:manual?'Digite os números abaixo e prepare a prévia.':`${(state?.contacts||[]).filter(c=>c.origin!=='whatsapp').length} contatos de listas importadas.`;}
$('target').addEventListener('change',renderAudience);
$('syncChats').onclick=async()=>{const b=$('syncChats');b.disabled=true;try{say('Solicitando o histórico de conversas ao WhatsApp do celular…');await api('/api/chats/sync',{});say('Sincronização solicitada. Aguarde a contagem atualizar; o celular precisa estar conectado.');await refresh();}catch(e){say(e.message);}finally{b.disabled=false;}};
async function loadOrders(){const r=await api('/api/orders');$('ordersList').replaceChildren();if(!r.orders.length){$('ordersList').textContent='Nenhum pedido montado ainda.';return;}for(const o of r.orders){const card=document.createElement('div');card.className='card';const pre=document.createElement('pre');pre.textContent=`Pedido ${o.id.slice(0,8)} · ${o.status==='awaiting_payment'?'EM ESPERA — pagamento e entrega pendentes':o.status==='review'?'Aguardando confirmação do cliente':'Coletando dados'}\nCliente: ${o.customer.name||'Não informado'} · ${o.jid}\nCPF/CNPJ: ${o.customer.taxId||'Pendente'}\nEndereço: ${o.customer.address||'Pendente'}, ${o.customer.city||''}\nContato: ${o.customer.contact||'Pendente'} · E-mail: ${o.customer.email||'Pendente'}\nPagamento: ${o.payment||'Pendente'}\n\n`+o.items.map(i=>`${i.quantity}x ${i.name} · ${i.sku} · ${(i.lineCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`).join('\n')+`\nSubtotal: ${(o.subtotalCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}\nFrete a confirmar. Não pago; sem reserva automática.`;card.append(pre);$('ordersList').append(card);}}
$('loadOrders').onclick=()=>loadOrders().catch(e=>say(e.message));
const fragment=new URLSearchParams(location.hash.slice(1));if(fragment.has('token'))login(fragment.get('token')).catch(e=>say(e.message));else{await refresh();if(state){const k=await api('/api/knowledge');$('knowledge').value=k.text;}}
$('relink').onclick=async()=>{if(!confirm('Arquivar a sessão atual e gerar um novo pareamento? As conversas do CRM serão preservadas. Primeiro desconecte o serviço.'))return;try{await api('/api/relink',{});say('Novo pareamento iniciado.');await refresh();}catch(e){say(e.message);}};
setInterval(()=>refresh(),3000);

$('previewCatalogBtn').onclick=async()=>{try{const f=$('catalogFile').files[0];if(!f)throw Error('Escolha um catálogo');if(f.size>5*1024*1024)throw Error('Catálogo acima de 5 MB');const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});const r=await api('/api/catalog/preview',{name:f.name,base64});catalogImportId=r.id;$('catalogPreview').textContent=JSON.stringify({count:r.count,source:r.source,preview:r.preview},null,2);$('commitCatalogBtn').disabled=false;say('Confira os produtos antes de importar.');}catch(e){say(e.message);}};
$('catalogFile').onchange=()=>{catalogImportId='';$('commitCatalogBtn').disabled=true;};
$('commitCatalogBtn').onclick=async()=>{try{if(!catalogImportId)throw Error('Confira o catálogo primeiro');await api('/api/catalog/commit',{id:catalogImportId,mode:'upsert'});catalogImportId='';$('commitCatalogBtn').disabled=true;await refresh();say('Catálogo atualizado por SKU. Produtos ausentes no arquivo foram preservados.');}catch(e){say(e.message);}};
