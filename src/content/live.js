/* Optional MAIN-world SSE observer. No chrome.* or persistent storage access.
 * Disabled by default. It forwards only completed reply metadata, never content. */
(() => {
  'use strict';let config={enabled:false,scope:null},installed=false;
  function install(){
    if(installed)return;installed=true;const original=window.fetch;
    window.fetch=async function(input,init){
      const raw=typeof input==='string'?input:input?.url||'',method=String(init?.method||input?.method||'GET').toUpperCase();let watched=false;
      try{const u=new URL(raw,location.href);watched=config.enabled&&u.origin===location.origin&&method==='POST'&&/^\/backend-api\/conversation(?:\/|$)/.test(u.pathname);}catch(_){}
      const scope=watched?config.scope:null,cid=location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1]||'';
      const response=await original.apply(this,arguments);
      if(watched&&response.ok)observe(response.clone(),scope,cid).catch(()=>{});return response;
    };
  }
  async function observe(response,scope,cid){
    const found=new Map();let buffer='';
    function visit(v,d=0){
      if(!v||d>8)return;if(Array.isArray(v)){v.forEach(x=>visit(x,d+1));return;}if(typeof v!=='object')return;
      if(typeof v.conversation_id==='string')cid=v.conversation_id;
      const md=v.metadata||{};
      if(v.author?.role==='assistant'&&v.end_turn===true&&(!v.recipient||v.recipient==='all')&&!md.is_visually_hidden_from_conversation&&!md.is_visually_hidden&&!md.hidden){
        let t=Number(v.create_time??v.created_at??v.update_time);if(t<1e12)t*=1000;
        if(v.id&&Number.isFinite(t))found.set(v.id,{id:String(v.id),t,model:String(md.resolved_model_slug||md.model_slug||md.requested_model_slug||md.default_model_slug||v.model_slug||'unknown'),effort:String(md.reasoning_effort||md.thinking_effort||md.effort||''),cid});
      }
      for(const k of ['message','messages','data','payload','value','v'])if(v[k])visit(v[k],d+1);
    }
    function frame(text){const s=text.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(s&&s!=='[DONE]')try{visit(JSON.parse(s));}catch(_){}}
    if((response.headers.get('content-type')||'').includes('json'))visit(await response.json());
    else{
      const reader=response.body?.getReader();if(!reader)return;const decoder=new TextDecoder();
      try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let match;
        while((match=/\r?\n\r?\n/.exec(buffer))){frame(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);}if(buffer.length>2097152){await reader.cancel();break;}
      }if(buffer.trim())frame(buffer);}finally{reader.releaseLock();}
    }
    if(found.size&&config.enabled&&scope===config.scope)window.postMessage({channel:'CMM_LIVE_EVENTS_201',scope,events:[...found.values()].slice(-100)},location.origin);
  }
  window.addEventListener('message',e=>{
    if(e.source!==window||e.origin!==location.origin||e.data?.channel!=='CMM_LIVE_CONFIG_201')return;
    config={enabled:e.data.enabled===true,scope:typeof e.data.scope==='string'?e.data.scope:null};if(config.enabled)install();
  });
  window.postMessage({channel:'CMM_LIVE_READY_201'},location.origin);
})();
