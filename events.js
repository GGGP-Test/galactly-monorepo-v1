// Include this script after your main JS. Requires a global API(path) that returns your API base + path.
(function(){
function uid(){ let id=localStorage.getItem('galactly_uid'); if(!id){ id='u-'+Math.random().toString(36).slice(2); localStorage.setItem('galactly_uid', id);} return id; }
async function post(type, lead, meta){
if(!lead||!lead.id) return; const userId=uid();
try{ await fetch(API('/api/v1/events'),{method:'POST',headers:{'content-type':'application/json','x-galactly-user':userId},body:JSON.stringify({leadId:lead.id,type,meta:meta||{}})});}catch(e){}
}
function openLead(lead){ post('click', lead, { url: lead?.source_url }); try{ window.open(lead?.source_url,'_blank','noopener'); }catch(e){} }
function like(lead){ post('like', lead); }
function dislike(lead){ post('dislike', lead); }
function mute(lead){ let host=''; try{host=new URL(lead?.source_url||'').hostname;}catch(e){} post('mute_domain', lead, { domain: host }); }
window.Events = { open: openLead, like, dislike, mute };
})();
