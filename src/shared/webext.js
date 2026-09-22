/* Small callback/Promise adapter. Resolve APIs per call: do not cache a missing
 * storage API at document_start or mistake the page's `chrome` object for ours. */
(() => {
  'use strict';
  const error=(code,message)=>Object.assign(new Error(message),{code});
  const api=()=>{
    if(globalThis.chrome?.runtime?.id)return {root:globalThis.chrome,callback:true};
    if(globalThis.browser?.runtime?.id)return {root:globalThis.browser,callback:false};
    throw error('EXTENSION_RELOADED','Extension connection expired. Refresh this ChatGPT tab; saved index is not deleted.');
  };
  const call=(namespace,method,...args)=>new Promise((resolve,reject)=>{
    let finished=false;
    const timer=setTimeout(()=>done(error('EXTENSION_TIMEOUT',namespace+'.'+method+' did not respond.')),30000);
    function done(e,v){if(finished)return;finished=true;clearTimeout(timer);e?reject(e):resolve(v);}
    try {
      let {root,callback}=api(),target=namespace.split('.').reduce((v,k)=>v?.[k],root);
      if(typeof target?.[method]!=='function'&&globalThis.browser?.runtime?.id){const alternative=namespace.split('.').reduce((v,k)=>v?.[k],globalThis.browser);if(typeof alternative?.[method]==='function'){root=globalThis.browser;callback=false;target=alternative;}}
      if(typeof target?.[method]!=='function')throw error('API_UNAVAILABLE','Extension API missing: '+namespace+'.'+method);
      const cb=v=>{const e=root.runtime?.lastError;done(e?error(/invalidated/i.test(e.message)?'EXTENSION_RELOADED':'EXTENSION_API_ERROR',e.message):null,v);};
      // alarms.create historically returned void and never accepted a callback.
      // Modern Chrome returns a Promise; older engines still need a synchronous path.
      const useCallback=callback&&!(namespace==='alarms'&&method==='create');
      const p=useCallback?target[method](...args,cb):target[method](...args);
      if(p?.then)p.then(v=>done(null,v),e=>done(error(/invalidated/i.test(e.message||'')?'EXTENSION_RELOADED':'EXTENSION_API_ERROR',e.message||String(e))));
      else if(!useCallback)done(null,p);
    }catch(e){done(e);}
  });
  globalThis.CMMNative={api,call,error};
})();
