/* 2.0.1: native popup controller + single background history engine.
 * UI closure cannot cancel a scan. Work yields at checkpoints; alarms resume it.
 * Authentication tokens and raw responses exist in memory only. */
importScripts('src/shared/webext.js','src/shared/core.js','src/shared/i18n.js','src/shared/limits.js','src/shared/api.js','src/shared/tasks.js','src/shared/policy.js','src/background/worker-store.js','src/shared/sync.js');
const C=globalThis.ChatCounter,N=globalThis.CMMNative,API=N.api().root;
const PREFIX='cmm_v17_state_',SELECTED='cmm_v17_selected_scope',RUNTIME='cmm_v17_runtime_201';
const WAKE='cmm-201-wake',TICK='cmm-201-maintenance';
let relayTab=null,shortTimer=null,iconTimer=null,iconQueue=Promise.resolve(),lastIconKey='',launchPending=false;
const safePath=p=>typeof p==='string'&&(p==='/api/auth/session'||/^\/backend-api\/(?:conversations?(?:[/?]|$)|gizmos\/)/.test(p))&&!p.includes('://')&&!p.includes('\\');
const errorStatus=async e=>{
  const status={code:e.code||'BACKGROUND_ERROR',message:String(e.message||e).slice(0,220),at:C.now()};
  await N.call('storage.local','set',{[RUNTIME]:status});return status;
};
async function indexes(){
  const all=await N.call('storage.local','get',null);
  if(!all||typeof all!=='object'||Array.isArray(all))throw C.error('STORAGE_INVALID_RESPONSE','Cannot read local storage. No index was reset.');
  const keys=Object.keys(all).filter(k=>/^cmm_v17_state_[0-9a-f]{16}$/.test(k));
  let scope=all[SELECTED]||null;
  if(scope&&!keys.includes(PREFIX+scope))scope=null;
  // Do not silently combine accounts or guess based on the newest watermark.
  if(!scope&&keys.length===1)scope=keys[0].slice(PREFIX.length);
  const selected=scope?all[PREFIX+scope]:null;
  if(selected&&selected.schema!==3)throw C.error('STORAGE_SCHEMA','Unsupported saved index. Export it before changing versions.');
  return {scope,state:selected?C.normalize(structuredClone(selected)):C.normalize(C.fresh()),accounts:keys.map(k=>({scope:k.slice(PREFIX.length),label:all[k]?.plan?.label||'Unknown',updatedAt:all[k]?.watermark||0})),runtime:all[RUNTIME]||null};
}
async function relay(path,init={},tabId){
  const response=await N.call('tabs','sendMessage',tabId,{channel:'CMM_TRANSPORT_201',path,headers:init.headers||{}});
  if(!response?.ok)throw C.error(response?.code||'PAGE_TRANSPORT_ERROR',response?.message||'Refresh the ChatGPT tab to reconnect.');
  return new Response(response.body,{status:response.status,headers:response.headers});
}
C.fetchTransport=async(path,init={})=>{
  if(!safePath(path))throw C.error('ENDPOINT_BLOCKED','Only ChatGPT session and read-only history endpoints are allowed.');
  if(path!=='/api/auth/session'&&relayTab!==null)return relay(path,init,relayTab);
  let direct,networkError;
  try {direct=await fetch(new URL(path,'https://chatgpt.com'),{...init,method:'GET'});}
  catch(e){networkError=e;}
  // Only authentication selects a fallback route. Never retry a 429 via another route.
  if(path!=='/api/auth/session'){if(networkError)throw networkError;return direct;}
  if(direct?.ok){
    try{const j=await direct.clone().json();if(j.accessToken||j.access_token){relayTab=null;return direct;}}catch(_){}
  }
  let tabs=[];try{tabs=await N.call('tabs','query',{url:'https://chatgpt.com/*'});}catch(_){}
  tabs.sort((a,b)=>Number(b.active)-Number(a.active));
  // An active tab is preferable. Do not make history calls during this check.
  for(const tab of tabs.slice(0,3)){
    try{const r=await relay(path,init,tab.id);if(r.ok){const j=await r.clone().json();if(j.accessToken||j.access_token){relayTab=tab.id;return r;}}}catch(_){}
  }
  if(direct)return direct;
  throw C.error('AUTH_REQUIRED','Sign in to ChatGPT, then retry. Cached data remains available.');
};
C.onConnected=async who=>{
  await N.call('storage.local','set',{[SELECTED]:who.scope,[RUNTIME]:{code:'',message:'',at:C.now(),transport:relayTab===null?'extension':'ChatGPT tab'}});
};
function availableWork(s){
  if(!s.baseline.startedAt||s.paused||s.blocked)return false;
  const j=C.firstStage(s);
  if(s.recent&&!C.stageTerminal(s.recent))return true;
  if(s.needsRecent)return true;
  if(s.runRequested&&(!C.fullyComplete(s)||(s.recent&&!C.stageTerminal(s.recent))))return true;
  if(s.settings.auto&&s.watermark&&C.now()-s.watermark>=s.settings.interval*60000)return true;
  return s.settings.autoResume&&(!s.baseline.stages.length||!!j||C.warnings(s).some(t=>t.status!=='blocked_source'&&t.status!=='unavailable'));
}
const legacyActive=s=>s.worker&&s.worker.engine!=='background-201'&&s.worker.expiresAt>C.now();
async function schedule(){
  const {scope,state:s,runtime}=await indexes();if(!scope)return;
  if(s.paused||s.blocked||/AUTH_REQUIRED|ACCOUNT_CHANGED/.test(runtime?.code||'')){await N.call('alarms','clear',WAKE);return;}
  let when=C.now()+1000;
  if(availableWork(s)){
    const future=C.jobs(s).flatMap(C.entries).filter(t=>!['done','unchanged','blocked_source','unavailable'].includes(t.status));
    const activeStage=C.firstStage(s);
    const eligible=future.some(t=>!t.nextAt||t.nextAt<=C.now());
    if(!eligible&&future.length)when=Math.max(when,Math.min(...future.map(t=>t.nextAt||Infinity)));
    const stageWait=activeStage&&!C.nextPriorOptional(s,activeStage)&&(!s.recent||C.stageTerminal(s.recent))?s.governor?.stageDelayUntil||0:0;
    when=Math.max(when,s.cooldownUntil||0,s.governor?.softPauseUntil||0,stageWait,(s.governor?.lastRequestAt||0)+C.requestGap(s,activeStage?.key||'recent'));
  }else if(s.settings.auto&&s.watermark){when=Math.max(when,s.watermark+s.settings.interval*60000);}
  else {await N.call('alarms','clear',WAKE);return;}
  if(legacyActive(s))when=Math.max(when,s.worker.expiresAt+1000);
  await N.call('alarms','create',WAKE,{when});
  clearTimeout(shortTimer);shortTimer=null;
  if(when-C.now()<20000)shortTimer=setTimeout(()=>kick().catch(errorStatus),Math.max(50,when-C.now()));
}
async function kick(){
  if(C.running||launchPending)return;
  const {scope,state:s,runtime}=await indexes();
  if(legacyActive(s))return schedule();
  if(!scope||!availableWork(s)||s.cooldownUntil>C.now()||(s.governor?.softPauseUntil||0)>C.now())return schedule();
  if(/AUTH_REQUIRED|ACCOUNT_CHANGED/.test(runtime?.code||''))return;
  C.expectedScope=scope;
  const result=await C.run('scheduled');
  if(result?.error)await errorStatus({code:result.error.split(':')[0],message:result.error});
  await schedule();
}
function badgeEstimate(s){
  if(!C.fullyComplete(s)||!s.baseline.stages.every(j=>C.counts(j).fullDiscoveryDone))return null;
  const usage=C.advancedUsage(s,Object.values(s.events||{}));
  if(!usage.config||!usage.cards.length)return null;
  // Shared-model contributions must not be mistaken for independent allowances.
  const cards=usage.config.mode==='separate'?usage.cards:usage.cards.filter(c=>c.key==='total');
  const best=cards.reduce((a,b)=>b.count/b.cap>a.count/a.cap?b:a);
  return {percent:Math.min(100,Math.max(0,Math.round(best.count/best.cap*100))),card:best,label:usage.config.label};
}
function progressIcon(size,percent){
  const cv=new OffscreenCanvas(size,size),ctx=cv.getContext('2d');ctx.scale(size/128,size/128);
  // A toolbar variant must spend pixels on the number, not on the app tile margins.
  ctx.fillStyle='#2786e7';ctx.beginPath();ctx.roundRect(21,24,105,94,22);ctx.fill();
  ctx.fillStyle='#eff8ff';ctx.beginPath();ctx.roundRect(2,3,117,94,20);ctx.fill();
  ctx.save();ctx.beginPath();ctx.roundRect(2,3,117,94,20);ctx.clip();
  const g=ctx.createLinearGradient(2,0,120,90);g.addColorStop(0,'#9be9da');g.addColorStop(1,'#74bcff');ctx.fillStyle=g;ctx.fillRect(2,3,117*percent/100,94);ctx.restore();
  ctx.fillStyle='#123348';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`800 ${percent===100?40:49}px sans-serif`;ctx.fillText(percent+'%',61,53,112);
  return cv.getContext('2d').getImageData(0,0,size,size);
}
async function pickState(){return indexes();}
async function refreshIcon(){
  const {scope,state}=await indexes(),e=scope?badgeEstimate(state):null,key=scope+'|'+(e?.percent??'neutral')+'|'+(state.watermark||0);
  if(key===lastIconKey)return;
  const neutral={16:'icons/icon16.png',32:'icons/icon32.png',48:'icons/icon48.png',128:'icons/icon128.png'};
  if(e&&typeof OffscreenCanvas==='function')await N.call('action','setIcon',{imageData:Object.fromEntries([16,32,48,128].map(n=>[n,progressIcon(n,e.percent)]))});
  else await N.call('action','setIcon',{path:neutral});
  // Platform badge stays readable at normal toolbar scale, unlike 2.0's ~2.5px font.
  await N.call('action','setBadgeBackgroundColor',{color:e?.percent>=90?'#9b3b20':'#155879'});
  if(API.action?.setBadgeTextColor)await N.call('action','setBadgeTextColor',{color:'#ffffff'});
  await N.call('action','setBadgeText',{text:e?e.percent+'%':''});
  const title=e?`ChatGPT Message Meter — ${e.percent}% estimated used · ${e.card.key} / ${e.card.period} · saved-history estimate; synced ${state.watermark?new Date(state.watermark).toLocaleString():'unknown'}`:'ChatGPT Message Meter — open dashboard; percentage requires fully indexed history and a supported allowance';
  await N.call('action','setTitle',{title});lastIconKey=key;
}
function queueIcon(){clearTimeout(iconTimer);iconTimer=setTimeout(()=>{iconQueue=iconQueue.then(refreshIcon).catch(()=>{});},180);}
function validateSettings(patch){
  const clean={};
  for(const k of ['live','auto','autoResume','onOpen'])if(k in patch){if(typeof patch[k]!=='boolean')throw C.error('SETTING_INVALID',k);clean[k]=patch[k];}
  if('interval' in patch){if(![15,30,60].includes(patch.interval))throw C.error('SETTING_INVALID','Invalid interval.');clean.interval=patch.interval;}
  if('resetDay' in patch){if(!['','0','1','2','3','4','5','6'].includes(String(patch.resetDay)))throw C.error('SETTING_INVALID','Invalid reset day.');clean.resetDay=String(patch.resetDay);}
  if('resetTime' in patch){if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(patch.resetTime))throw C.error('SETTING_INVALID','Invalid reset time.');clean.resetTime=patch.resetTime;}
  if('resetTz' in patch){new Intl.DateTimeFormat('en',{timeZone:patch.resetTz}).format();clean.resetTz=patch.resetTz;}
  return clean;
}
async function command(action,requestedScope){
  const {scope,state}=await indexes();
  if(requestedScope&&scope!==requestedScope)throw C.error('ACCOUNT_CHANGED','Selected account changed. Reopen the dashboard.');
  if(!['start','resume','pause','reconcile','reauth','retry','rebuild','start-now'].includes(action))throw C.error('COMMAND_INVALID','Unknown command.');
  if(action==='pause'){
    if(scope)await C.write(scope,s=>{s.paused=true;s.runRequested=false;C.log(s,'pause');});C.abortScan();await schedule();return {outcome:'paused'};
  }
  if(legacyActive(state))throw C.error('LEGACY_TAB_ACTIVE','An older ChatGPT tab still owns a scan. Refresh all ChatGPT tabs before continuing. Your index is retained.');
  if(C.running||launchPending)return {outcome:'running'};
  // Reject destructive commands while another scan is active, including stale page copies.
  if(action==='rebuild'&&state.worker?.expiresAt>C.now())throw C.error('SYNC_ACTIVE','Pause the active scan before rebuilding.');
  if(state.cooldownUntil>C.now())return {outcome:'waiting',message:'Server cooldown is active; cached data retained.'};
  if(action==='reconcile'&&!state.baseline.startedAt)throw C.error('NOT_INITIALISED','Click Start indexing first.');
  launchPending=true;C.expectedScope=scope;
  await N.call('storage.local','set',{[RUNTIME]:{code:'',message:'Connecting…',at:C.now()}});
  // Acknowledge before work begins; closing the popup must not cancel indexing.
  (async()=>{
    try{const result=await C.control(action);if(result?.error)throw C.error(result.error.split(':')[0],result.error);}
    catch(e){await errorStatus(e);}
    finally{launchPending=false;await schedule();queueIcon();}
  })().catch(errorStatus);
  return {outcome:'accepted'};
}
async function restore(payload){
  if(C.running||launchPending)throw C.error('SYNC_ACTIVE','Pause the scanner before importing.');
  if(!payload||payload.format!=='chatcounter-index-backup'||payload.formatVersion!==1||payload.state?.schema!==3)throw C.error('BACKUP_INVALID','Unsupported index backup.');
  const current=await indexes();C.expectedScope=current.scope;
  const who=await C.connect(true);
  if(payload.scope!==who.scope)throw C.error('BACKUP_ACCOUNT','This backup belongs to another ChatGPT account.');
  const s=payload.state;
  if(!s.events||Array.isArray(s.events)||!s.conversations||!Array.isArray(s.baseline?.stages))throw C.error('BACKUP_INVALID','Invalid index structure.');
  if(Object.keys(s.events).length>250000)throw C.error('BACKUP_INVALID','Backup is too large.');
  const clean=structuredClone(s);clean.events={};
  for(const [id,e] of Object.entries(s.events)){
    if(!e||typeof e.id!=='string'||e.id!==id||!Number.isFinite(e.t)||typeof e.model!=='string'||typeof e.effort!=='string')throw C.error('BACKUP_INVALID','Invalid event metadata.');
    clean.events[id]={id:e.id,t:e.t,model:e.model,effort:e.effort,cid:typeof e.cid==='string'?e.cid:''};
  }
  // Import never clears an already active server cooldown or starts background work.
  const prior=await C.read(who.scope);await C.replace(who.scope,clean,who.plan);
  await C.write(who.scope,x=>{x.paused=true;x.cooldownUntil=Math.max(prior.cooldownUntil||0,clean.cooldownUntil||0);});
  queueIcon();return indexes();
}
async function dispatch(m){
  if(m.op==='snapshot')return indexes();
  if(m.op==='prefs')return C.readUIPrefs();
  if(m.op==='save-prefs')return C.writeUIPrefs(m.patch||{});
  if(m.op==='bind-account'){if(C.running||launchPending)throw C.error('SYNC_ACTIVE','Pause the scanner before switching accounts.');C.expectedScope=null;C.session=null;await C.connect(true);queueIcon();return indexes();}
  if(m.op==='select'){
    if(C.running||launchPending)throw C.error('SYNC_ACTIVE','Pause indexing before switching accounts.');
    const list=await indexes();if(!list.accounts.some(a=>a.scope===m.scope))throw C.error('ACCOUNT_UNKNOWN','Unknown cached index.');
    await N.call('storage.local','set',{[SELECTED]:m.scope,[RUNTIME]:{code:'',message:'',at:C.now()}});C.session=null;lastIconKey='';queueIcon();return indexes();
  }
  if(m.op==='settings'){
    const {scope}=await indexes();if(!scope)throw C.error('NOT_INITIALISED','Sign in and start indexing before changing account settings.');
    if(m.scope&&scope!==m.scope)throw C.error('ACCOUNT_CHANGED','Selected account changed.');
    const patch=validateSettings(m.patch||{});await C.write(scope,s=>Object.assign(s.settings,patch));await schedule();queueIcon();return indexes();
  }
  if(m.op==='pace'){C.setPace(m.pace);return {pace:C.sessionPace};}
  if(m.op==='command')return command(m.action,m.scope);
  if(m.op==='restore')return restore(m.payload);
  if(m.op==='open-chatgpt'){await N.call('tabs','create',{url:'https://chatgpt.com/'});return true;}
  if(m.op==='diagnostics'){const {state}=await indexes();return {...C.diagnostics(state),background:{version:C.version,transport:relayTab===null?'extension':'ChatGPT tab',lastError:C.lastError||'',popupConfigured:true}};}
  if(m.op==='live-events'){
    const {scope}=await indexes();if(!scope||scope!==m.scope)return false;
    const s=await C.read(scope);if(!s.settings.live)return false;
    if(!Array.isArray(m.events)||m.events.length>100)throw C.error('EVENT_INVALID','Invalid live event batch.');
    await C.write(scope,x=>{for(const e of m.events)if(e&&typeof e.id==='string'&&typeof e.model==='string')C.merge(x,e,e.cid||'');x.lastLive=C.now();});return true;
  }
  throw C.error('COMMAND_INVALID','Unsupported extension command.');
}
API.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.channel!=='CMM_APP_201'||sender.id!==API.runtime.id)return false;
  const own=(sender.url||'').startsWith(API.runtime.getURL(''));
  const page=!!sender.tab&&/^https:\/\/chatgpt\.com\//.test(sender.url||'');
  if(!own&&!page){reply({ok:false,code:'SENDER_DENIED',message:'Invalid extension context.'});return false;}
  if(m.op==='live-events'&&!page){reply({ok:false,code:'SENDER_DENIED',message:'Live capture must originate from a ChatGPT tab.'});return false;}
  dispatch(m).then(value=>reply({ok:true,value}),e=>reply({ok:false,code:e.code||'BACKGROUND_ERROR',message:e.message}));return true;
});
API.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&Object.keys(changes).some(k=>k.startsWith(PREFIX)||k===SELECTED))queueIcon();});
API.alarms.onAlarm.addListener(a=>{if(a.name===WAKE||a.name===TICK){queueIcon();kick().catch(errorStatus);}});
async function boot(){
  const cached=await indexes();
  if(cached.scope&&cached.state.runtimeVersion!==201){
    await C.rpc('probe');
    await C.write(cached.scope,s=>{if(/^(?:BRIDGE_.*|STORAGE_ERROR|STORAGE_UNAVAILABLE|STORAGE_TIMEOUT|STORAGE_READBACK_FAILED)$/.test(s.blocked||'')){s.blocked='';C.log(s,'storage-adapter-recovered');}s.runtimeVersion=201;});
  }
  if(!await N.call('alarms','get',TICK))await N.call('alarms','create',TICK,{periodInMinutes:1});
  await refreshIcon();await schedule();
}
API.runtime.onInstalled.addListener(()=>boot().catch(errorStatus));API.runtime.onStartup.addListener(()=>boot().catch(errorStatus));
globalThis.CMM201={indexes,badgeEstimate,progressIcon,refreshIcon,schedule,kick,dispatch};
boot().catch(errorStatus);
