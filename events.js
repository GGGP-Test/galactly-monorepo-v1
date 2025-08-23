// File: frontend/events.js (NEW helper you can include in your page)
// -------------------------------------------------
// Usage: include this script after your existing frontend code, then call
// Events.post('like', lead)
// Events.post('dislike', lead)
// Events.open(lead) // logs click then opens the URL
// Events.mute(lead) // logs mute_domain with host
// It assumes a function API(path) → baseURL+path exists in your page.


window.Events = (function(){
function uid(){
let id = localStorage.getItem('galactly_uid');
if (!id){ id = 'u-' + Math.random().toString(36).slice(2); localStorage.setItem('galactly_uid', id); }
return id;
}
async function post(type, lead, meta={}){
if (!lead || !lead.id) return;
const userId = uid();
try {
await fetch(API('/api/v1/events'), {
method: 'POST',
headers: { 'content-type': 'application/json', 'x-galactly-user': userId },
body: JSON.stringify({ leadId: lead.id, type, meta })
});
} catch (e) { /* ignore */ }
}
function open(lead){
post('click', lead, { url: lead?.source_url });
try { window.open(lead?.source_url, '_blank', 'noopener'); } catch {}
}
function mute(lead){
let host = '';
try { host = new URL(lead?.source_url||'').hostname; } catch {}
post('mute_domain', lead, { domain: host });
}
return { post, open, mute };
})();
