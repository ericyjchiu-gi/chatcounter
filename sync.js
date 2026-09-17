/* One origin/account scanner, durable jobs, advisory heartbeat, native exclusion. */
(() => {
  'use strict';const C=window.ChatCounter;C.session=null;C.running=null;C.localHeartbeat=C.now();C.lastError='';
  let connecting=null,controller=null;
  C.connect = async(force=false)=>{
    if(connecting)return connecting;
    connecting=(async()=>{const who=await C.auth(force);await C.migrate(who.scope,who.oldScope);C.session=who;
      const s=await C.read(who.scope);if(s.plan.raw!==who.plan.raw||s.plan.source!==who.plan.source||s.plan.seat!==who.plan.seat)await C.write(who.scope,s=>{s.plan=who.plan;});return who;
    })().catch(e=>{C.lastError=e.code+': '+e.message;C.session=null;throw e;}).finally(()=>{connecting=null;});return connecting;
  };
  function select(s,allowBaseline=true){
    // A recent-device reconciliation preempts older history at a page boundary.
    if(s.watermark&&C.now()-s.watermark>=s.settings.interval*60000&&s.recent?.status!=='running')s.needsRecent=true;
    if(s.needsRecent&&s.watermark&&(!s.recent||s.recent.status==='complete')){
      const now=C.now();s.recent=C.job('recent',now-(C.complete(s)?30:1)*C.DAY,now,Math.max(now-30*C.DAY,s.watermark-120000));s.needsRecent=false;
    }
    if(s.recent&&s.recent.status!=='complete'&&C.nextTask(s.recent))return s.recent;
    if(!allowBaseline)return null;
    for(const j of s.baseline.stages){if(['complete','partial'].includes(j.status))continue;return C.nextTask(j)?j:null;}return null;
  }
  function touch(s,job,activity){s.worker={owner:C.owner,stage:job?.key||'',activity,heartbeatAt:C.now(),expiresAt:C.now()+45000};}
  function locate(s,key){return key==='recent'?s.recent:s.baseline.stages.find(j=>j.key===key);}
  async function work(scope,reason){
    await C.rpc('probe');controller=new AbortController();
    const signal=controller.signal;let heartbeat;
    try{
      await C.write(scope,s=>{
        s.lastAttempt=C.now();touch(s,null,'Resuming saved queue');
        // Recheck one overlapping header page after a handover. Completed sources are untouched.
        for(const j of C.jobs(s))for(const source of j.sources)if(source.status==='pending'&&source.offset)source.offset=Math.max(0,source.offset-100);
      });
      heartbeat=setInterval(()=>C.write(scope,s=>{if(s.worker?.owner===C.owner){s.worker.heartbeatAt=C.now();s.worker.expiresAt=C.now()+45000;}}).catch(e=>{C.lastError=e.code+': '+e.message;controller?.abort();}),10000);
      while(!signal.aborted){
        let state=await C.read(scope);
        if(state.paused||state.blocked||state.cooldownUntil>C.now())break;
        if(!state.baseline.startedAt)break;
        let chosen;
        state=await C.write(scope,s=>{C.beginStages(s);chosen=select(s,reason!=='scheduled'||s.settings.autoResume);if(chosen){chosen.status='running';touch(s,chosen,'Processing saved queue');}});
        if(!chosen)break;
        const job=locate(state,chosen.key),next=C.nextTask(job);if(!next)break;
        const {item,type}=next,id=type==='chat'?item.id:item.key;
        await C.write(scope,s=>{touch(s,job,type==='chat'?'Reading message metadata':'Listing '+item.kind);s.requests++;});
        try{
          const result=type==='chat'?await C.detail(item,scope,signal):await C.fetchSource(item,job,scope,signal);
          await C.write(scope,s=>{
            const j=locate(s,job.key),t=type==='chat'?j.tasks[id]:j.sources.find(x=>x.key===id);
            if(type==='chat')C.applyDetail(s,j,t,result);else C.applySource(s,j,t,result);
            s.lastCheckpoint=C.now();touch(s,j,'Checkpoint saved');C.refreshJob(j);
            if(j.status==='complete'){
              if(j.key==='24h'&&!s.watermark)s.watermark=j.end;
              if(j.key==='recent'){s.watermark=j.end;s.lastResult={...C.counts(j),at:C.now()};}
            }
          });
        }catch(e){
          if(e.code==='INTERRUPTED'||signal.aborted)break;
          if(/^STORAGE|BRIDGE|LOCK/.test(e.code||''))throw e;
          await C.write(scope,s=>{
            const j=locate(s,job.key),t=type==='chat'?j.tasks[id]:j.sources.find(x=>x.key===id);
            C.recordError(s,j,t,type,e);C.refreshJob(j);s.lastCheckpoint=C.now();
          });
          if(e.status===429||/SCHEMA|CURSOR|PAGE_CAP|ACCOUNT_CHANGED|AUTH_REQUIRED/.test(e.code||''))break;
        }
      }
    }finally{
      if(heartbeat)clearInterval(heartbeat);
      controller=null;
      await C.write(scope,s=>{if(s.worker?.owner===C.owner)s.worker=null;}).catch(e=>{C.lastError=e.code+': '+e.message;});
    }
  }
  C.run = reason=>{
    if(C.running)return C.running;
    C.running=(async()=>{
      const who=await C.connect(true),s=await C.read(who.scope);
      if(!s.baseline.startedAt||s.paused||s.blocked||s.cooldownUntil>C.now())return {paused:true};
      // Same lock name as v1.6.3: old and new versions do not scan in parallel.
      return C.lock('chatcounter:history-sync:'+who.oldScope,()=>work(who.scope,reason),true);
    })().catch(e=>{C.lastError=(e.code||'SYNC_ERROR')+': '+e.message;return {error:C.lastError};}).finally(()=>{C.running=null;C.emit();});
    C.emit();return C.running;
  };
  C.control = async action=>{
    C.lastError='';const who=await C.connect(true);
    if(action==='rebuild'&&C.running)throw C.error('SYNC_ACTIVE','Pause the active scan before rebuilding.');
    if(action==='rebuild'){
      const result=await C.lock('chatcounter:history-sync:'+who.oldScope,()=>C.write(who.scope,s=>{
        s.baseline={startedAt:C.now(),anchor:0,stages:[]};C.beginStages(s);s.baseline.stages.forEach(j=>j.force=true);s.recent=null;s.watermark=0;s.paused=false;s.blocked='';s.errors={};
      }),true);
      if(result?.busy)throw C.error('SYNC_ACTIVE','Another page is scanning; history was not reset.');
      return C.run('rebuild');
    }
    await C.write(who.scope,s=>{
      if(action==='pause'){s.paused=true;return;}
      if(action==='start'||action==='resume'){s.baseline.startedAt ||= C.now();s.paused=false;C.beginStages(s);}
      if(action==='reconcile')s.needsRecent=true;
      if(action==='retry'){
        // Retry never bypasses an account-wide server cooldown.
        if(s.cooldownUntil>C.now())return;
        s.blocked='';s.paused=false;
        for(const j of C.jobs(s))for(const t of [...j.sources,...Object.values(j.tasks)])if(['error','unavailable'].includes(t.status)){t.nextAt=0;t.status='pending';}
      }
    });
    if(action==='pause'){controller?.abort();C.emit();return;}
    return C.run(action);
  };
  async function tick(){
    C.localHeartbeat=C.now();C.emit();if(document.visibilityState==='hidden'||C.running||!C.session)return;
    try{
      const s=await C.read(C.session.scope);
      if(!s.baseline.startedAt||s.paused||s.blocked||s.cooldownUntil>C.now())return;
      if(s.worker&&s.worker.owner!==C.owner&&s.worker.expiresAt>C.now())return;
      const resume=s.settings.autoResume&&(!s.baseline.stages.length||s.baseline.stages.some(j=>!['complete','partial'].includes(j.status)&&C.nextTask(j)));
      const due=s.settings.auto&&s.watermark&&C.now()-s.watermark>=s.settings.interval*60000;
      if(resume||due)await C.run('scheduled');
    }catch(e){C.lastError=(e.code||'SYNC_ERROR')+': '+e.message;}
  }
  C.tick=tick;
  setInterval(tick,10000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')controller?.abort();else tick();});
  window.addEventListener('pagehide',()=>controller?.abort());
  C.connect().then(tick).catch(()=>{});
})();
