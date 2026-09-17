(() => {
  'use strict';
  const {api,call,error} = globalThis.CMMExt163;
  const PAGE='CMM_PAGE_V163', EXT='CMM_EXT_V163';
  const allowed = key => typeof key === 'string' && /^(cmm_v14_|cmm_v16_)/.test(key);
  const replyEvent = (event,payload={}) => window.postMessage({source:EXT,type:'event',event,payload},location.origin);
  if (api?.runtime?.onMessage?.addListener) api.runtime.onMessage.addListener(msg => {
    if (msg?.type === 'CMM_BG_EVENT_163') replyEvent(msg.event,msg.payload);
  });
  if (api?.storage?.onChanged?.addListener) api.storage.onChanged.addListener((changes,area) => {
    if (area === 'local' && Object.keys(changes || {}).some(allowed)) replyEvent('cache-updated');
  });
  const filteredKeys = keys => {
    if (keys == null) return null;
    const arr=(Array.isArray(keys)?keys:[keys]).filter(allowed);
    if (!arr.length) throw error('STORAGE_KEYS_INVALID','No allowed cache keys requested.');
    return arr;
  };
  async function get(keys) {
    const value=await call(api?.storage?.local,'get',[keys]);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('STORAGE_INVALID_RESPONSE','Extension storage returned no data object; this is not an empty cache.');
    return Object.fromEntries(Object.entries(value).filter(([k])=>allowed(k)));
  }
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg=event.data;
    if (msg?.source !== PAGE || !msg.id) return;
    const reply=(ok,result,err)=>window.postMessage({source:EXT,id:msg.id,ok,result,error:err?.message,code:err?.code},location.origin);
    try {
      const p=msg.payload || {};
      switch(msg.op) {
        case 'get': reply(true,await get(filteredKeys(p.keys))); break;
        case 'set': {
          const items=Object.fromEntries(Object.entries(p.items || {}).filter(([k])=>allowed(k)));
          await call(api?.storage?.local,'set',[items]); reply(true,true); break;
        }
        case 'remove': await call(api?.storage?.local,'remove',[filteredKeys(p.keys) || []]); reply(true,true); break;
        case 'bytes': reply(true,await call(api?.storage?.local,'getBytesInUse',[filteredKeys(p.keys)])); break;
        case 'probe-storage': {
          const key=`cmm_v16_probe_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          const nonce=Math.random().toString(36).slice(2);
          try {
            await call(api?.storage?.local,'set',[{[key]:nonce}]);
            const read=await get([key]);
            if (read[key]!==nonce) throw error('STORAGE_READBACK_FAILED','Cache write/read verification failed. History scan was not started.');
            reply(true,{verified:true,backend:'extension.storage.local'});
          } finally { await call(api?.storage?.local,'remove',[[key]]).catch(()=>{}); }
          break;
        }
        case 'bg': {
          const result=await call(api?.runtime,'sendMessage',[{type:'CMM_PAGE_BG_163',action:String(p.action || ''),payload:p.payload || {}}]);
          if (!result || typeof result!=='object') throw error('BACKGROUND_EMPTY_RESPONSE','Background returned no response; not a confirmed busy sync.');
          if (result.error) throw error('BACKGROUND_ERROR',result.error);
          reply(true,result); break;
        }
        default: throw error('BRIDGE_OP_INVALID','Unsupported extension bridge operation.');
      }
    } catch(e) { reply(false,null,e); }
  });
})();
