/* Shared metadata store. Tokens and message content never enter this store. */
(() => {
  'use strict';
  if (window.ChatCounter) return;
  const C = window.ChatCounter = {version:'1.7.1', DAY:86400000, owner:crypto.randomUUID(), listeners:new Set()};
  C.now = () => Date.now();
  C.error = (code,message,extra={}) => Object.assign(new Error(message),{code,...extra});
  C.sleep = ms => new Promise(r=>setTimeout(r,ms));
  C.emit = () => { for (const fn of C.listeners) { try { fn(); } catch (_) {} } };
  C.rpc = (op,payload={}) => new Promise((resolve,reject) => {
    const id=crypto.randomUUID();
    const timer=setTimeout(()=>end(C.error('BRIDGE_TIMEOUT','Extension storage bridge did not respond.')),10000);
    function end(err,value){clearTimeout(timer);window.removeEventListener('message',receive);err?reject(err):resolve(value);}
    function receive(e){const m=e.data;if(e.source===window&&e.origin===location.origin&&m?.source==='CMM_EXT_V17'&&m.id===id)end(m.ok?null:C.error(m.code||'STORAGE_ERROR',m.error||'Storage failed.'),m.result);}
    window.addEventListener('message',receive);
    window.postMessage({source:'CMM_PAGE_V17',id,op,payload},location.origin);
  });
  window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin&&e.data?.source==='CMM_EXT_V17'&&e.data.event==='changed')C.emit();});
  C.key = scope=>'cmm_v17_state_'+scope;
  C.defaults = () => ({live:true,auto:true,onOpen:false,autoResume:true,interval:30,resetLocal:'',resetTz:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'});
  C.fresh = () => ({schema:3,revision:0,settings:C.defaults(),plan:{raw:'unknown',label:'Unknown',source:''},events:{},conversations:{},baseline:{startedAt:0,anchor:0,stages:[]},recent:null,watermark:0,lastAttempt:0,lastCheckpoint:0,worker:null,paused:false,cooldownUntil:0,blocked:'',errors:{},lastResult:null,lastLive:0,requests:0});
  C.hash = async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('');
  C.lock = async (name,work,available=false) => {
    if(typeof navigator.locks?.request!=='function')throw C.error('LOCK_API_UNAVAILABLE','Web Locks is unavailable. No history scan was started.');
    return navigator.locks.request(name,{mode:'exclusive',...(available?{ifAvailable:true}:{})},lock=>lock?work():{busy:true});
  };
  C.read = async scope=>{const key=C.key(scope),v=await C.rpc('get',{keys:[key]});if(v[key]!==undefined&&v[key]?.schema!==3)throw C.error('STORAGE_SCHEMA','Saved state schema is unsupported; it was not overwritten.');return C.normalize ? C.normalize(v[key]||C.fresh()) : v[key]||C.fresh();};
  C.write = (scope,fn) => C.lock('chatcounter:store:'+scope,async()=>{
    const s=await C.read(scope);const result=fn(s);if(result?.then)throw C.error('STORE_ASYNC_MUTATION','Store mutations must be synchronous.');
    s.revision++;const cutoff=C.now()-90*C.DAY;
    for(const [id,e] of Object.entries(s.events))if(e.t<cutoff)delete s.events[id];
    for(const [id,c] of Object.entries(s.conversations))if(c.u&&c.u<cutoff)delete s.conversations[id];
    try{await C.rpc('set',{items:{[C.key(scope)]:s}});}catch(e){if(!/quota|QUOTA_BYTES/i.test(e.message||''))throw e;const reduced=C.now()-45*C.DAY;for(const [id,event] of Object.entries(s.events))if(event.t<reduced)delete s.events[id];for(const c of Object.values(s.conversations))if(c.from!=null)c.from=Math.max(c.from,reduced);s.retentionDays=45;await C.rpc('set',{items:{[C.key(scope)]:s}});}C.emit();return s;
  });
  C.migrate = (scope,oldScope) => C.lock('chatcounter:store:'+scope,async()=>{
    const key=C.key(scope),keys=[key,'cmm_v14_cache_'+oldScope,'cmm_v16_live_'+oldScope,'cmm_v14_settings_'+oldScope];
    const raw=await C.rpc('get',{keys});if(raw[key]?.schema===3)return raw[key];if(raw[key]!==undefined)throw C.error('STORAGE_SCHEMA','Unsupported saved state schema; migration stopped.');
    const s=C.fresh(),old=raw[keys[1]],live=raw[keys[2]],settings=raw[keys[3]];
    for(const [cid,c] of Object.entries(old?.conversations||{})){
      s.conversations[cid]={u:Number(c.u)||0,from:null,to:0,complete:false};
      for(const e of c.events||[])C.merge(s,e,cid);
    }
    for(const e of Object.values(live?.events||{}))C.merge(s,e,e.conversationId||'');
    if(settings)Object.assign(s.settings,{live:settings.liveCapture!==false,auto:settings.autoReconcile!==false,onOpen:settings.reconcileOnOpen===true,resetLocal:settings.resetLocal||'',resetTz:settings.resetTz||s.settings.resetTz});
    if(Object.keys(s.conversations).length){s.baseline.startedAt=C.now();s.paused=true;s.migrated=true;}
    await C.rpc('set',{items:{[key]:s}});return s;
  });
  C.epoch = x => {if(x==null||x==='')return 0;const n=Number(x);if(Number.isFinite(n)&&n>1e9)return n>1e12?n:n*1000;const d=Date.parse(x);return Number.isFinite(d)?d:0;};
  C.turn = (m,fallback='') => {
    const md=m?.metadata||{};
    if(m?.author?.role!=='assistant'||m.end_turn!==true||(m.recipient&&m.recipient!=='all')||md.is_visually_hidden_from_conversation||md.is_visually_hidden||md.hidden)return null;
    const t=C.epoch(m.create_time??m.created_at??m.update_time),id=m.id||fallback;if(!id||!t)return null;
    return {id:String(id),t,model:String(md.resolved_model_slug||md.model_slug||md.requested_model_slug||md.default_model_slug||m.model_slug||'unknown'),effort:String(md.reasoning_effort||md.thinking_effort||md.effort||md.reasoning?.effort||'')};
  };
  C.merge = (s,e,cid) => {
    if(!e?.id||!Number.isFinite(e.t)||e.t<C.now()-90*C.DAY||e.t>C.now()+60000)return;
    const prior=s.events[e.id];s.events[e.id]={id:String(e.id),t:e.t,model:e.model==='unknown'&&prior?prior.model:String(e.model||'unknown'),effort:String(e.effort||prior?.effort||''),cid:String(cid||prior?.cid||'')};
  };
  C.family = model => {const m=String(model).toLowerCase().replace(/_/g,'-').replace('gpt-5.6','gpt-5-6');if(/^gpt-6-pro(?:-|$)/.test(m))return 'gpt6pro';if(/^gpt-5-6(?:-|$)/.test(m))return /(?:^|-)pro(?:-|$)/.test(m)?'gpt56pro':'gpt56';return 'other';};
  C.series=[{key:'gpt56',name:'GPT-5.6',color:'#20b486'},{key:'gpt56pro',name:'GPT-5.6 Pro',color:'#4d8dff'},{key:'gpt6pro',name:'GPT-6 Pro',color:'#aa6cff'}];
  C.jobs = s=>[...s.baseline.stages,...(s.recent?[s.recent]:[])];
  C.gaps = s=>C.jobs(s).flatMap(j=>Object.values(j.tasks||{}).concat(j.sources||[])).filter(t=>['error','unavailable'].includes(t.status));
  C.complete = s=>s.baseline.stages.length===3&&s.baseline.stages.every(j=>j.status==='complete');
})();
