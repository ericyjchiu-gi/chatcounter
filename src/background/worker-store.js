/* All mutation is executed by the background engine, not by popup/page copies.
 * The v17 storage namespace and schema 3 are retained verbatim. */
(() => {
  'use strict';
  const C=globalThis.ChatCounter,N=globalThis.CMMNative;
  const valid=k=>typeof k==='string'&&/^cmm_v(14|16|17)_/.test(k);
  C.rpc=async(op,p={})=>{
    if(op==='get'){
      if(!Array.isArray(p.keys)||!p.keys.length||!p.keys.every(valid))throw C.error('STORAGE_KEYS_INVALID','Invalid storage keys.');
      const result=await N.call('storage.local','get',p.keys);
      if(!result||typeof result!=='object'||Array.isArray(result))throw C.error('STORAGE_INVALID_RESPONSE','Missing storage response is not an empty index.');
      return result;
    }
    if(op==='set'){
      if(!p.items||!Object.keys(p.items).length||!Object.keys(p.items).every(valid))throw C.error('STORAGE_KEYS_INVALID','Invalid storage keys.');
      await N.call('storage.local','set',p.items);return true;
    }
    if(op==='probe'){
      const k='cmm_v17_probe_'+crypto.randomUUID(),v=crypto.randomUUID();
      try{await N.call('storage.local','set',{[k]:v});const r=await N.call('storage.local','get',[k]);if(r[k]!==v)throw C.error('STORAGE_READBACK_FAILED','Storage write/read verification failed.');return true;}
      finally{await N.call('storage.local','remove',[k]).catch(()=>{});}
    }
    throw C.error('STORAGE_OP_INVALID','Unsupported storage operation.');
  };
  // Single-writer fallback for browsers without Web Locks. Never used by views.
  const locks=new Map();
  C.lock=async(name,work,available=false)=>{
    if(typeof navigator.locks?.request==='function')return navigator.locks.request(name,{mode:'exclusive',...(available?{ifAvailable:true}:{})},l=>l?work():{busy:true});
    if(available&&locks.has(name))return {busy:true};
    const previous=locks.get(name)||Promise.resolve();let unlock;
    const latch=new Promise(r=>{unlock=r;});const queued=previous.then(()=>latch);locks.set(name,queued);
    await previous;
    try{return await work();}finally{unlock();if(locks.get(name)===queued)locks.delete(name);}
  };
})();
