/* Read-only, undocumented ChatGPT web endpoints. No Codex usage endpoint. */
(() => {
  'use strict';const C=window.ChatCounter;
  let token='',identity=null,authAt=0,authJob=null,nextRequest=0;
  const labels={free:'Free',go:'Go',plus:'Plus',pro:'Pro 20x',prolite:'Pro 5x',team:'Business',business:'Business',self_serve_business_prolite:'Business',self_serve_business_usage_based:'Business',enterprise:'Enterprise',ent26:'Enterprise',edu:'Edu',edu_plus:'Edu Plus',edu_pro:'Edu Pro'};
  function decode(t){try{let b=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');b+='='.repeat((4-b.length%4)%4);return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b),c=>c.charCodeAt(0))));}catch(_){return {};}}
  C.auth = async (force=false) => {
    if(!force&&identity&&C.now()-authAt<60000)return identity;
    if(authJob)return authJob;
    authJob=(async()=>{
      const r=await fetch('/api/auth/session',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw C.error('AUTH_REQUIRED','Session request failed. Refresh your signed-in ChatGPT page.',{status:r.status});
      const j=await r.json(),t=j.accessToken||j.access_token;if(!t)throw C.error('AUTH_REQUIRED','No signed-in session token was returned.');
      const jwt=decode(t),claims=jwt['https://api.openai.com/auth']||{};
      const account=j.account?.id||j.account_id||j.user?.account_id||claims.chatgpt_account_id||'';
      const user=j.user?.id||claims.chatgpt_user_id||jwt.sub||j.user?.email||'';
      if(!account&&!user)throw C.error('ACCOUNT_UNKNOWN','Cannot safely identify this account.');
      const explicit=j.accounts?.filter?.(a=>a.is_active===true||a.active===true)||[];
      const candidates=[['session.account.plan_type',j.account?.plan_type],['session.plan_type',j.plan_type],['session.subscription.plan_type',j.subscription?.plan_type],['session.active.plan_type',explicit.length===1?explicit[0].plan_type:''],['jwt.chatgpt_plan_type',claims.chatgpt_plan_type]];
      const candidate=candidates.find(([,v])=>typeof v==='string'&&v)||['not exposed','unknown'];
      const raw=candidate[1].toLowerCase().replace(/[\s-]+/g,'_');
      const seats=[j.account?.seat_type,j.account?.seat_tier,claims.seat_type].filter(v=>['standard','premium'].includes(v));
      const seat=seats[0]||'',label=labels[raw]||(/enterprise/.test(raw)?'Enterprise':raw);
      const oldScope=await C.hash(account||user),scope=await C.hash(JSON.stringify([account,user]));
      token=t;identity={scope,oldScope,account,plan:{raw,label:label==='Business'&&seat?label+' '+seat:label,seat,source:candidate[0],detectedAt:C.now()}};authAt=C.now();return identity;
    })().finally(()=>{authJob=null;});return authJob;
  };
  C.after = r=>{const s=r.headers.get('retry-after');if(s!==null&&s.trim()!==''&&Number.isFinite(Number(s)))return Math.max(1000,Number(s)*1000);const t=Date.parse(s);return Number.isFinite(t)?Math.max(1000,t-C.now()):60000;};
  C.request = async (path,scope,signal,reauthed=false) => {
    if(!/^\/backend-api\/(?:conversations?(?:[/?]|$)|gizmos\/)/.test(path))throw C.error('ENDPOINT_BLOCKED','Only history endpoints are permitted.');
    const who=await C.auth();if(who.scope!==scope)throw C.error('ACCOUNT_CHANGED','Account changed. Saved data retained; scan stopped.');
    const wait=Math.max(0,nextRequest-C.now());if(wait)await C.sleep(wait);if(signal?.aborted)throw C.error('INTERRUPTED','Page paused; checkpoint retained.');nextRequest=C.now()+C.requestGap();
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,25000);let r,start=C.now();
    try{
      r=await fetch(path,{credentials:'include',cache:'no-store',headers:{accept:'application/json',authorization:'Bearer '+token,...(who.account?{'ChatGPT-Account-Id':who.account}:{})},signal:controller.signal});C.noteRequest(r.status,C.now()-start);
      if(r.status===401&&!reauthed){await C.auth(true);return await C.request(path,scope,signal,true);}
      if(!r.ok){const status=r.status;throw C.error(status===429?'RATE_LIMITED':status===401?'AUTH_REQUIRED':status===403?'ACCESS_DENIED':status===404?'NOT_FOUND':status>=500?'SERVER_ERROR':'HTTP_ERROR','History endpoint returned HTTP '+status+'.',{status,waitMs:status===429?C.after(r):0});}
      try{return await r.json();}catch(_){throw C.error('RESPONSE_SCHEMA','Expected JSON; received a different response format.');}
    }catch(e){if(e.code)throw e;C.noteRequest(0,C.now()-start);if(signal?.aborted)throw C.error('INTERRUPTED','Page paused; checkpoint retained.');throw C.error(e.name==='AbortError'?'NETWORK_TIMEOUT':'NETWORK_ERROR','Network request did not complete.');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
  C.items = j=>{if(Array.isArray(j))return j;for(const key of ['items','conversations','data'])if(Array.isArray(j?.[key]))return j[key];throw C.error('LIST_SCHEMA','Conversation list shape changed; not an empty history.');};
  C.projects = j=>{
    // Only identifiers are retained. Project titles/descriptions are discarded.
    if(!j||typeof j!=='object')throw C.error('LIST_SCHEMA','Project list is not a JSON object.');
    const ids=new Set();const walk=(v,d=0)=>{if(d>8||!v)return;if(typeof v==='string'){if(/^g-p-[a-zA-Z0-9_-]+$/.test(v))ids.add(v);return;}if(Array.isArray(v)){v.forEach(x=>walk(x,d+1));return;}if(typeof v==='object')for(const [k,x]of Object.entries(v))if(d<3||['items','gizmo','gizmos','project','projects','data','id','gizmo_id'].includes(k))walk(x,d+1);};walk(j);if(!ids.size&&!Array.isArray(j)&&!['items','projects','gizmos','data'].some(k=>Array.isArray(j[k])))throw C.error('LIST_SCHEMA','Unrecognised Project list; coverage remains partial.');return [...ids];
  };
  C.detail = async (task,scope,signal) => {
    let legacy=task.legacy||false,j;
    if(!legacy){const qs=new URLSearchParams({include_has_versions:'true',num_turns:'100'});if(task.cursor)qs.set('before',task.cursor);
      try{j=await C.request('/backend-api/conversations/'+encodeURIComponent(task.id)+'?'+qs,scope,signal);}catch(e){if(task.cursor||![404,405].includes(e.status))throw e;legacy=true;}}
    if(legacy)j=await C.request('/backend-api/conversation/'+encodeURIComponent(task.id),scope,signal);
    let messages;
    if(Array.isArray(j?.messages))messages=j.messages;
    else if(j?.mapping&&typeof j.mapping==='object')messages=Object.values(j.mapping).map(n=>n?.message).filter(Boolean);
    else throw C.error('DETAIL_SCHEMA','Conversation response shape changed; cache retained.');
    const times=messages.map(m=>C.epoch(m.create_time??m.created_at??m.update_time)).filter(Boolean);
    const oldest=times.length?Math.min(...times):null,pi=j.page_info||{};
    const hasPrevious=pi.has_previous_page===true;
    const cursor=pi.start_cursor||pi.startCursor||null;
    if(hasPrevious&&(!cursor||cursor===task.cursor||!messages.length))throw C.error('CURSOR_INVALID','Missing/repeated cursor or empty non-final page.');
    if(hasPrevious&&!oldest)throw C.error('DETAIL_SCHEMA','No timestamps on a non-final page.');
    return {events:messages.map(m=>C.turn(m)).filter(Boolean),oldest,hasPrevious,cursor,legacy};
  };
})();
