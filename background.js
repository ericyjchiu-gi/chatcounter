/* Optional live-event fanout and scheduled reconciliation. Never owns sync locks. */
importScripts('webext.js');
(() => {
  'use strict';
  const {api,call} = globalThis.CMMExt163;
  const ALARM='cmm_v16_background_reconcile';
  let appendQueue=Promise.resolve();
  async function broadcast(message) {
    const tabs=await call(api?.tabs,'query',[{url:['https://chatgpt.com/*']}]).catch(()=>[]);
    if (!Array.isArray(tabs)) return;
    await Promise.allSettled(tabs.filter(t=>t.id!=null).map(t=>call(api.tabs,'sendMessage',[t.id,message])));
  }
  async function appendLive(payload) {
    const scope=String(payload.scope || '');
    if (!/^[a-f0-9]{1,64}$/.test(scope)) throw new Error('Invalid account scope.');
    const key=`cmm_v16_live_${scope}`;
    const obj=await call(api.storage.local,'get',[[key]]);
    if (!obj || typeof obj!=='object') throw new Error('Invalid extension storage result.');
    const current=obj[key] || {schema:1,events:{},lastCapture:0};
    if (!current.events || typeof current.events!=='object') current.events={};
    const cutoff=Date.now()-90*86400000;
    for(const [id,e] of Object.entries(current.events)) if(!e || e.t<cutoff) delete current.events[id];
    let added=0;
    for (const e of (Array.isArray(payload.events)?payload.events:[])) {
      if (!e?.id || !Number.isFinite(Number(e.t)) || e.t<cutoff) continue;
      const id=String(e.id);
      if (!current.events[id]) added++;
      current.events[id]={id,t:Number(e.t),model:String(e.model || 'unknown'),effort:String(e.effort || '')};
    }
    current.lastCapture=Date.now();
    await call(api.storage.local,'set',[{[key]:current}]);
    await broadcast({type:'CMM_BG_EVENT_163',event:'live-updated',payload:{scope,added}});
    return {ok:true,added};
  }
  async function tick() {
    const tabs=await call(api?.tabs,'query',[{url:['https://chatgpt.com/*']}]).catch(()=>[]);
    if (!Array.isArray(tabs)) return;
    tabs.sort((a,b)=>Number(b.active)-Number(a.active));
    for(const tab of tabs) {
      if(tab.id==null) continue;
      try { await call(api.tabs,'sendMessage',[tab.id,{type:'CMM_BG_EVENT_163',event:'background-reconcile',payload:{at:Date.now()}}]); break; }
      catch (_) { /* next reachable tab */ }
    }
  }
  function schedule() {
    try {
      const ret=api?.alarms?.create(ALARM,{periodInMinutes:30});
      if(ret?.catch) ret.catch(()=>{});
    } catch (_) { /* manual history sync does not depend on alarms */ }
  }
  api?.runtime?.onInstalled?.addListener(schedule);
  api?.runtime?.onStartup?.addListener(schedule);
  api?.alarms?.onAlarm?.addListener(a=>{if(a?.name===ALARM) tick().catch(()=>{});});
  api?.runtime?.onMessage?.addListener((msg,sender,sendResponse)=>{
    if(msg?.type!=='CMM_PAGE_BG_163') return;
    if(sender?.tab?.url && !sender.tab.url.startsWith('https://chatgpt.com/')) {sendResponse({error:'Invalid page origin.'});return;}
    if(msg.action!=='append-live') {sendResponse({error:'Unsupported background action. Sync locks are browser-native.'});return;}
    const task=appendQueue.then(()=>appendLive(msg.payload || {}));
    appendQueue=task.catch(()=>{});
    task.then(sendResponse,e=>sendResponse({error:e?.message || String(e)}));
    return true;
  });
})();
