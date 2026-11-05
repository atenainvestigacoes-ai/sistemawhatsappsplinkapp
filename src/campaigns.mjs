const terminal=new Set(['sent','uncertain','failed','blocked','cancelled','stale','error']);
export function campaignDetail(store,account,id){
 const campaign=store.db.prepare('SELECT * FROM campaigns WHERE id=? AND account=?').get(id,account);if(!campaign)throw Error('Campanha não encontrada');
 const rows=store.db.prepare('SELECT d.*,c.name FROM drafts d LEFT JOIN contacts c ON c.account=d.account AND c.jid=d.jid WHERE d.campaign_id=? AND d.account=? ORDER BY d.created,d.rowid').all(id,account);
 const counts={total:rows.length,sent:0,waiting:0,sending:0,uncertain:0,failed:0,cancelled:0};
 for(const d of rows){if(d.status==='sent')counts.sent++;else if(d.status==='sending')counts.sending++;else if(d.status==='uncertain')counts.uncertain++;else if(d.status==='cancelled')counts.cancelled++;else if(terminal.has(d.status))counts.failed++;else counts.waiting++;}
 const done=rows.length>0&&rows.every(d=>terminal.has(d.status));
 if(done&&!campaign.finished){const end=campaign.state==='cancelling'?'cancelled':'completed';store.db.prepare('UPDATE campaigns SET state=?,finished=? WHERE id=?').run(end,Date.now(),id);campaign.state=end;campaign.finished=Date.now();}
 const excluded=JSON.parse(campaign.excluded||'[]');
 return {...campaign,counts,excluded,progress:counts.total?Math.round((counts.sent+counts.failed+counts.uncertain+counts.cancelled)/counts.total*100):0,rows,nextSendAt:Math.max(Date.now(),Number(store.setting('last_send_at','0'))+(rows.find(d=>d.queued&&d.status==='approved')?.interval_s||0)*1000)};
}
export function listCampaigns(store,account){return store.db.prepare('SELECT id FROM campaigns WHERE account=? ORDER BY created DESC LIMIT 30').all(account).map(r=>{const {rows,...summary}=campaignDetail(store,account,r.id);return summary;});}
export function campaignCSV(detail){
 const cell=value=>{let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[['campanha','destinatario','nome','status','motivo','mensagem','intervalo_segundos','anexo']];
 for(const d of detail.rows)rows.push([detail.title,d.jid,d.name,d.status,d.reason,d.text,d.interval_s,d.attachment]);
 for(const d of detail.excluded)rows.push([detail.title,d.jid,d.name,'excluded',d.reason,'','','']);
 return '\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n');
}
