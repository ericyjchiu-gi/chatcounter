/* Best-effort passive observer. The original response is returned untouched. */
(() => {
  'use strict';const C=window.ChatCounter,native=window.fetch.bind(window);
  async function observe(response,who,cid){
    if(!who)return;
    const s=await C.read(who.scope);if(!s.settings.live)return;
    const found=new Map();let buffer='',sawFrame=false;
    function visit(v,depth=0){
      if(!v||depth>8)return;
      if(Array.isArray(v)){for(const x of v)visit(x,depth+1);return;}
      if(typeof v!=='object')return;
      if(typeof v.conversation_id==='string')cid=v.conversation_id;
      if(v.author){const e=C.turn(v);if(e)found.set(e.id,e);}
      // Content parts are intentionally never inspected or persisted.
      for(const k of ['message','messages','data','payload','value','v'])if(v[k])visit(v[k],depth+1);
    }
    function frame(text){const data=text.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(data&&data!=='[DONE]'){try{visit(JSON.parse(data));sawFrame=true;}catch(_){}}}
    if((response.headers.get('content-type')||'').includes('json'))visit(await response.json());
    else{
      const reader=response.body?.getReader();if(!reader)return;const decoder=new TextDecoder();
      try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let match;
        while((match=/\r?\n\r?\n/.exec(buffer))){frame(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);}
        if(buffer.length>2*1024*1024){await reader.cancel();break;}
      }if(buffer.trim())frame(buffer);}finally{reader.releaseLock();}
    }
    await C.write(who.scope,state=>{
      if(!state.settings.live)return;
      for(const e of found.values())C.merge(state,e,cid||'');
      if(found.size){state.lastLive=C.now();state.liveNote='Completed reply metadata captured';}
      else if(sawFrame)state.liveNote='Stream observed without a complete reply record; history reconciliation is needed';
    });
  }
  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input?.url||'',method=String(init?.method||input?.method||'GET').toUpperCase();
    let match=false;try{const u=new URL(raw,location.href);match=u.origin===location.origin&&method==='POST'&&/^\/backend-api\/conversation(?:\/|$)/.test(u.pathname);}catch(_){}
    const who=match?C.session:null; // Identity at send time, never reattributed when stream finishes.
    const cid=location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1]||'';
    const response=await native(input,init);
    if(match&&response.ok&&who)observe(response.clone(),who,cid).catch(()=>{C.lastError='LIVE_CAPTURE: passive capture unavailable; saved-history reconciliation remains available.';C.emit();});
    return response;
  };
})();
