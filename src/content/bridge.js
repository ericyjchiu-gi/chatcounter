/* Isolated-world, read-only same-origin fallback transport. No storage or token
 * ever crosses window.postMessage. Accept only this extension's runtime calls. */
(() => {
  'use strict';
  const N=globalThis.CMMNative;
  let root;try{root=N.api().root;}catch(_){return;}
  const allowed=path=>typeof path==='string'&&(path==='/api/auth/session'||/^\/backend-api\/(?:conversations?(?:[/?]|$)|gizmos\/)/.test(path))&&!path.includes('://')&&!path.includes('\\');
  root.runtime.onMessage.addListener((m,sender,reply)=>{
    if(sender.id!==root.runtime.id||m?.channel!=='CMM_TRANSPORT_201')return false;
    if(!allowed(m.path)){reply({ok:false,code:'ENDPOINT_BLOCKED',message:'Only read-only ChatGPT history requests are permitted.'});return false;}
    const headers={accept:'application/json'};
    for(const key of ['authorization','ChatGPT-Account-Id'])if(typeof m.headers?.[key]==='string')headers[key]=m.headers[key];
    (async()=>{
      const r=await fetch(new URL(m.path,'https://chatgpt.com'),{method:'GET',credentials:'include',cache:'no-store',headers,signal:AbortSignal.timeout(25000)});
      const body=await r.text();if(body.length>32*1024*1024)throw new Error('History response exceeded 32 MB.');
      reply({ok:true,status:r.status,body,headers:{'content-type':r.headers.get('content-type')||'application/json','retry-after':r.headers.get('retry-after')||''}});
    })().catch(e=>reply({ok:false,code:'PAGE_TRANSPORT_ERROR',message:e.name==='TimeoutError'?'Page request timed out.':'Page transport is unavailable. Refresh this ChatGPT tab.'}));
    return true;
  });
})();
