/* Same renderer in native popup and isolated page fallback; all mutations and
 * history work are sent to one background engine. No MAIN-world storage bridge. */
(() => {
  'use strict';const C=globalThis.ChatCounter,N=globalThis.CMMNative;
  C.isPopup=/^(?:chrome|moz|safari-web)-extension:$/.test(location.protocol);
  C.locale=C.resolveLanguage({language:'browser'});
  C.session=null;C.runtimeState=null;C.accounts=[];C.lastError='';C.lastAction='';C.connectionLost=false;C.dataUnavailable=false;
  let cachedSnapshot=null,lastLiveCheck='',liveConfig=null;
  const send=async(op,more={})=>{
    try {
      const r=await N.call('runtime','sendMessage',{channel:'CMM_APP_201',op,...more});
      if(!r?.ok)throw C.error(r?.code||'BACKGROUND_UNAVAILABLE',r?.message||'Background service did not respond. Reload the extension and refresh this tab.');
      return r.value;
    }catch(e){if(e.code==='EXTENSION_RELOADED'||/invalidated/i.test(e.message||'')){C.connectionLost=true;e.code='EXTENSION_RELOADED';}throw e;}
  };
  function apply(snapshot){
    if(!snapshot||!snapshot.state||snapshot.state.schema!==3)throw C.error('STORAGE_INVALID_RESPONSE','No valid storage response. Existing data was not cleared.');
    cachedSnapshot=snapshot;C.accounts=snapshot.accounts||[];C.runtimeState=snapshot.runtime;
    C.session={scope:snapshot.scope,plan:snapshot.state.plan};C.dataUnavailable=false;
    C.lastError=snapshot.runtime?.code?(snapshot.runtime.code+': '+snapshot.runtime.message):'';
    if(snapshot.runtime?.message&&!snapshot.runtime.code)C.lastAction=snapshot.runtime.message;
    updateLive(snapshot).catch(()=>{});return snapshot;
  }
  C.connect=async()=>{try{const snap=apply(await send('snapshot'));return {scope:snap.scope,plan:snap.state.plan};}catch(e){C.dataUnavailable=true;throw e;}};
  C.read=async scope=>{
    let snap;try{snap=apply(await send('snapshot'));}catch(e){C.dataUnavailable=true;throw e;}
    if(scope&&scope!==snap.scope){C.lastAction='Selected account changed.';}
    return C.normalize(snap.state);
  };
  C.updateSettings=async patch=>apply(await send('settings',{scope:C.session?.scope,patch}));
  C.readUIPrefs=()=>send('prefs');C.writeUIPrefs=patch=>send('save-prefs',{patch});
  C.restorePayload=async payload=>apply(await send('restore',{payload}));
  C.selectScope=async scope=>{const v=apply(await send('select',{scope}));C.emit();return v;};
  C.openChatGPT=()=>send('open-chatgpt');
  C.bindSignedIn=async()=>{const v=apply(await send('bind-account'));C.emit();return v;};
  C.control=async action=>{
    const r=await send('command',{action,scope:C.session?.scope});
    C.lastAction=r.message||(r.outcome==='accepted'?(C.locale==='zh'?'任务已交给后台；关闭弹窗不会取消。':'Work handed to background; closing the popup will not cancel it.'):r.outcome);
    C.emit();return r;
  };
  C.setPace=pace=>{
    C.sessionPace=['auto','fast','conservative'].includes(pace)?pace:'auto';
    send('pace',{pace:C.sessionPace}).catch(e=>{C.lastError=e.message;C.emit();});return C.sessionPace;
  };
  const originalDiagnostics=C.diagnostics;
  C.diagnostics=(s,status)=>({...originalDiagnostics(s,status),view:{kind:C.isPopup?'native-popup':'isolated-page',version:C.version,storage:'background-extension-storage',connectionLost:C.connectionLost,runtime:C.runtimeState}});
  // Make accidental legacy writes fail loudly rather than perform cross-origin RMW.
  C.write=()=>Promise.reject(C.error('VIEW_READ_ONLY','State mutations must go through the background controller.'));
  async function updateLive(snapshot){
    if(C.isPopup)return;
    const desired=!!snapshot.state.settings.live,scope=snapshot.scope,tag=String(desired)+':'+scope;
    if(tag===lastLiveCheck)return;lastLiveCheck=tag;
    liveConfig={enabled:false,scope:null};window.postMessage({channel:'CMM_LIVE_CONFIG_201',...liveConfig},location.origin);
    if(!desired||!scope)return;
    // Attribute passive messages only after checking this page's current account.
    try {
      const r=await fetch('/api/auth/session',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000)}),j=await r.json();
      const token=j.accessToken||j.access_token||'';let claims={};
      try{const v=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');claims=JSON.parse(atob(v))['https://api.openai.com/auth']||{};}catch(_){}
      const account=j.account?.id||j.account_id||j.user?.account_id||claims.chatgpt_account_id||'',user=j.user?.id||claims.chatgpt_user_id||j.user?.email||'';
      if(await C.hash(JSON.stringify([account,user]))!==scope)return;
      liveConfig={enabled:true,scope};window.postMessage({channel:'CMM_LIVE_CONFIG_201',...liveConfig},location.origin);
    }catch(_){}
  }
  if(!C.isPopup){
    window.addEventListener('message',e=>{
      if(e.source!==window||e.origin!==location.origin)return;
      if(e.data?.channel==='CMM_LIVE_READY_201'&&liveConfig)window.postMessage({channel:'CMM_LIVE_CONFIG_201',...liveConfig},location.origin);
      if(e.data?.channel!=='CMM_LIVE_EVENTS_201'||!liveConfig?.enabled||e.data.scope!==liveConfig.scope||!Array.isArray(e.data.events))return;
      const events=e.data.events.slice(0,100).filter(v=>v&&typeof v.id==='string'&&v.id.length<200&&Number.isFinite(v.t)&&typeof v.model==='string'&&v.model.length<200).map(v=>({id:v.id,t:v.t,model:v.model,effort:String(v.effort||'').slice(0,100),cid:String(v.cid||'').slice(0,200)}));
      send('live-events',{scope:liveConfig.scope,events}).catch(()=>{});
    });
  }
  try{N.api().root.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&Object.keys(changes).some(k=>k.startsWith('cmm_v17_')))C.emit();});}catch(_){}
  const timer=setInterval(()=>{if(C.connectionLost){clearInterval(timer);return;}C.emit();},2000);
  // Prime a page fallback's listener, without authenticating or scanning by default.
  if(!C.isPopup)C.connect().catch(()=>{});
})();
