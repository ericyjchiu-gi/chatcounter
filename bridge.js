/* Isolated-world storage adapter: callback and Promise APIs, never a token bridge. */
(() => {
  'use strict';
  const chromeAPI=!!globalThis.chrome?.storage?.local,api=chromeAPI?globalThis.chrome:globalThis.browser;
  const allowed=k=>typeof k==='string'&&/^cmm_v(14|16|17)_/.test(k);
  const fail=(code,message)=>Object.assign(new Error(message),{code});
  function call(method,args){return new Promise((resolve,reject)=>{
    let settled=false;const done=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(value);};
    const timer=setTimeout(()=>done(fail('STORAGE_TIMEOUT',method+' did not complete.')),7500);
    try{
      const target=api?.storage?.local;if(typeof target?.[method]!=='function')throw fail('STORAGE_UNAVAILABLE','Storage API missing: '+method);
      const cb=value=>done(api.runtime?.lastError?fail('STORAGE_ERROR',api.runtime.lastError.message):null,value);
      const ret=chromeAPI?target[method](...args,cb):target[method](...args);
      if(ret?.then)ret.then(v=>done(null,v),e=>done(fail('STORAGE_ERROR',e.message||'Storage rejected.')));
      else if(!chromeAPI)done(fail('STORAGE_INVALID_RESPONSE','Expected a Promise.'));
    }catch(e){done(e);}
  });}
  api?.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&Object.keys(changes).some(allowed))window.postMessage({source:'CMM_EXT_V17',event:'changed'},location.origin);});
  window.addEventListener('message',async event=>{
    const m=event.data;if(event.source!==window||event.origin!==location.origin||m?.source!=='CMM_PAGE_V17'||!m.id)return;
    const p=m.payload||{};let result;
    try{
      if(m.op==='get'){
        if(!Array.isArray(p.keys)||!p.keys.length||!p.keys.every(allowed))throw fail('STORAGE_KEYS_INVALID','Invalid keys.');
        result=await call('get',[p.keys]);if(!result||typeof result!=='object'||Array.isArray(result))throw fail('STORAGE_INVALID_RESPONSE','Missing storage object is not an empty cache.');
      }else if(m.op==='set'){
        if(!p.items||!Object.keys(p.items).length||!Object.keys(p.items).every(allowed))throw fail('STORAGE_KEYS_INVALID','Invalid keys.');
        await call('set',[p.items]);result=true;
      }else if(m.op==='probe'){
        const k='cmm_v17_probe_'+crypto.randomUUID(),v=crypto.randomUUID();
        try{await call('set',[{[k]:v}]);const got=await call('get',[[k]]);if(got?.[k]!==v)throw fail('STORAGE_READBACK_FAILED','Local cache write/read verification failed.');result=true;}
        finally{await call('remove',[[k]]).catch(()=>{});}
      }else throw fail('BRIDGE_OP_INVALID','Unsupported operation.');
      window.postMessage({source:'CMM_EXT_V17',id:m.id,ok:true,result},location.origin);
    }catch(e){window.postMessage({source:'CMM_EXT_V17',id:m.id,ok:false,code:e.code||'STORAGE_ERROR',error:e.message},location.origin);}
  });
})();
