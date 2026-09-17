/* One origin/account scanner, durable jobs, advisory heartbeat, staged backfill and safe overrides. */
(() => {
  'use strict';const C=window.ChatCounter;C.session=null;C.running=null;C.localHeartbeat=C.now();C.lastError='';
  let connecting=null,controller=null;
  C.connect = async(force=false)=>{
    if(connecting)return connecting;
    connecting=(async()=>{const who=await C.auth(force);await C.migrate(who.scope,who.oldScope);C.session=who;
      const s=await C.read(who.scope);if(s.plan.raw!==who.plan.raw||s.plan.source!==who.plan.source||s.plan.seat!==who.plan.seat)await C.write(who.scope,s=>{s.plan=who.plan;});return who;
    })().catch(e=>{C.lastError=e.code+': '+e.message;C.session=null;throw e;}).finally(()=>{connecting=null;});return connecting;
  };
  const stageDelay=()=>120000+Math.floor(Math.random()*180000);
  const terminal=j=>C.stageTerminal(j);
  function currentBaseline(s){return s.baseline.stages.find(j=>!terminal(j))||null;}
  function retryCandidate(s,seen=new Set()){
    for(const [key,e] of Object.entries(s.errors||{})){
      if(seen.has(key))continue;
      const j=e.stage==='recent'?s.recent:s.baseline.stages.find(x=>x.key===e.stage);if(!j)continue;
      let next=null;
      if(key.includes('/chat/')){const id=key.split('/chat/')[1],item=j.tasks?.[id];if(item&&['pending','error','unavailable','degraded'].includes(item.status))next={type:'chat',item};}
      else if(key.includes('/source/')){const sourceKey=key.split('/source/')[1],item=j.sources?.find(x=>x.key===sourceKey);if(item&&['pending','error','unavailable','degraded'].includes(item.status))next={type:'source',item};}
      if(next)return {job:j,next,optional:!!next.item.optional,retryKey:key};
    }
    return null;
  }
  function select(s,reason,allowBaseline=true,retrySeen=new Set()){
    if(s.watermark&&C.now()-s.watermark>=s.settings.interval*60000&&s.recent?.status!=='running')s.needsRecent=true;
    if(s.needsRecent&&s.watermark&&(!s.recent||terminal(s.recent))){
      const now=C.now();s.recent=C.job('recent',now-(C.complete(s)?30:1)*C.DAY,now,Math.max(now-30*C.DAY,s.watermark-120000));s.needsRecent=false;
    }
    if(s.recent&&!terminal(s.recent)){const next=C.nextTask(s.recent);if(next)return {job:s.recent,next};}
    if(reason==='retry'){
      const retry=retryCandidate(s,retrySeen);if(retry)return retry;
    }
    if(allowBaseline){
      const j=currentBaseline(s);
      if(j){
        if((s.baseline.stageDelayUntil||0)>C.now()||(s.baseline.softPauseUntil||0)>C.now())return null;
        const next=C.nextTask(j);if(next)return {job:j,next};
      }
    }
    if(C.complete(s)||!currentBaseline(s)){
      for(const j of s.baseline.stages){const next=C.nextOptionalTask(j,false);if(next)return {job:j,next,optional:true};}
    }
    return null;
  }
  function touch(s,job,activity){s.worker={owner:C.owner,stage:job?.key||'',activity,heartbeatAt:C.now(),expiresAt:C.now()+45000};}
  function locate(s,key){return key==='recent'?s.recent:s.baseline.stages.find(j=>j.key===key);}
  function maybeSchedulePause(s,j,oldStatus){
    if(j.key==='recent')return false;
    if(!terminal(j)||terminal({status:oldStatus}))return false;
    C.log(s,'stage-complete',{stage:j.key,status:j.status});
    s.baseline.burstCount=0;
    if(j.key!=='30d'){
      s.baseline.stageDelayUntil=C.now()+stageDelay();
      C.log(s,'stage-delay',{stage:j.key,until:s.baseline.stageDelayUntil});
    }
    return true;
  }
  function maybeBurstPause(s,j){
    if(j.key==='recent'||C.sessionPace==='fast')return false;
    s.baseline.burstCount=(s.baseline.burstCount||0)+1;
    const limit=75;
    if(s.baseline.burstCount<limit)return false;
    s.baseline.burstCount=0;s.baseline.softPauseUntil=C.now()+120000+Math.floor(Math.random()*180000);
    C.log(s,'burst-pause',{stage:j.key,until:s.baseline.softPauseUntil,limit});return true;
  }
  async function work(scope,reason){
    await C.rpc('probe');controller=new AbortController();
    const signal=controller.signal;let heartbeat;const retrySeen=new Set();
    try{
      await C.write(scope,s=>{s.lastAttempt=C.now();touch(s,null,reason==='retry'?'Retry requested':'Resuming saved queue');C.log(s,'scanner-start',{reason,pace:C.sessionPace});
        for(const j of C.jobs(s))for(const source of j.sources)if(source.status==='pending'&&source.offset)source.offset=Math.max(0,source.offset-100);
      });
      heartbeat=setInterval(()=>C.write(scope,s=>{if(s.worker?.owner===C.owner){s.worker.heartbeatAt=C.now();s.worker.expiresAt=C.now()+45000;}}).catch(e=>{C.lastError=e.code+': '+e.message;controller?.abort();}),10000);
      while(!signal.aborted){
        let state=await C.read(scope);
        if(state.paused||state.blocked||state.cooldownUntil>C.now())break;
        if(!state.baseline.startedAt)break;
        let chosen;
        state=await C.write(scope,s=>{C.beginStages(s);chosen=select(s,reason,reason!=='scheduled'||s.settings.autoResume,retrySeen);if(chosen){if(!terminal(chosen.job))chosen.job.status='running';touch(s,chosen.job,chosen.next.type==='chat'?'Reading message metadata':'Listing '+chosen.next.item.kind);}});
        if(!chosen)break;
        if(chosen.retryKey)retrySeen.add(chosen.retryKey);
        const job=locate(state,chosen.job.key),next=chosen.next,item=next.item,type=next.type,id=type==='chat'?item.id:item.key;
        await C.write(scope,s=>{const j=locate(s,job.key);touch(s,j,type==='chat'?'Reading message metadata':'Listing '+(item.kind||'source'));s.requests++;C.log(s,'request-start',{stage:j.key,target:type==='chat'?'chat':item.kind||'source',optional:!!item.optional});});
        let stopAfter=false;
        try{
          const result=type==='chat'?await C.detail(item,scope,signal):await C.fetchSource(item,job,scope,signal);
          await C.write(scope,s=>{
            const j=locate(s,job.key),t=type==='chat'?j.tasks[id]:j.sources.find(x=>x.key===id),oldStatus=j.status;
            if(type==='chat')C.applyDetail(s,j,t,result);else C.applySource(s,j,t,result);
            s.lastCheckpoint=C.now();touch(s,j,'Checkpoint saved');C.log(s,'request-ok',{stage:j.key,target:type==='chat'?'chat':t.kind||'source',optional:!!t.optional});C.refreshJob(j);
            if(j.status==='complete'||j.status==='complete_with_warnings'){
              if(j.key==='24h'&&!s.watermark)s.watermark=j.end;
              if(j.key==='recent'){s.watermark=j.end;s.lastResult={...C.counts(j),at:C.now()};}
            }
            stopAfter=maybeSchedulePause(s,j,oldStatus)||maybeBurstPause(s,j);
          });
        }catch(e){
          if(e.code==='INTERRUPTED'||signal.aborted)break;
          if(/^STORAGE|BRIDGE|LOCK/.test(e.code||''))throw e;
          await C.write(scope,s=>{
            const j=locate(s,job.key),t=type==='chat'?j.tasks[id]:j.sources.find(x=>x.key===id),oldStatus=j.status;
            C.recordError(s,j,t,type,e);s.lastCheckpoint=C.now();stopAfter=maybeSchedulePause(s,j,oldStatus);
          });
          if(e.status===429||/SCHEMA|CURSOR|PAGE_CAP|ACCOUNT_CHANGED|AUTH_REQUIRED/.test(e.code||''))break;
        }
        if(stopAfter)break;
      }
    }finally{
      if(heartbeat)clearInterval(heartbeat);controller=null;
      await C.write(scope,s=>{if(s.worker?.owner===C.owner)s.worker=null;C.log(s,'scanner-stop',{reason});}).catch(e=>{C.lastError=e.code+': '+e.message;});
    }
  }
  C.run = reason=>{
    if(C.running)return C.running;
    C.running=(async()=>{
      const who=await C.connect(true),s=await C.read(who.scope);
      if(!s.baseline.startedAt||s.paused||s.blocked||s.cooldownUntil>C.now())return {paused:true};
      return C.lock('chatcounter:history-sync:'+who.oldScope,()=>work(who.scope,reason),true);
    })().catch(e=>{C.lastError=(e.code||'SYNC_ERROR')+': '+e.message;return {error:C.lastError};}).finally(()=>{C.running=null;C.emit();});
    C.emit();return C.running;
  };
  C.control = async action=>{
    C.lastError='';const who=await C.connect(true);
    if(action==='rebuild'&&C.running)throw C.error('SYNC_ACTIVE','Pause the active scan before rebuilding.');
    if(action==='rebuild'){
      const result=await C.lock('chatcounter:history-sync:'+who.oldScope,()=>C.write(who.scope,s=>{
        s.baseline={startedAt:C.now(),anchor:0,stages:[],stageDelayUntil:0,softPauseUntil:0,burstCount:0};C.beginStages(s);s.baseline.stages.forEach(j=>j.force=true);s.recent=null;s.watermark=0;s.paused=false;s.blocked='';s.errors={};C.log(s,'rebuild',{});
      }),true);
      if(result?.busy)throw C.error('SYNC_ACTIVE','Another page is scanning; history was not reset.');
      return C.run('rebuild');
    }
    await C.write(who.scope,s=>{
      if(action==='pause'){s.paused=true;C.log(s,'pause',{});return;}
      if(action==='start'||action==='resume'){s.baseline.startedAt ||= C.now();s.paused=false;C.beginStages(s);C.log(s,action,{});}
      if(action==='start-now'){s.paused=false;s.baseline.stageDelayUntil=0;s.baseline.softPauseUntil=0;C.log(s,'soft-throttle-override',{});}
      if(action==='reconcile'){s.needsRecent=true;C.log(s,'manual-reconcile',{});}
      if(action==='retry'){
        if(s.cooldownUntil>C.now())return;
        s.blocked='';s.paused=false;let n=0;
        for(const j of C.jobs(s))for(const t of [...j.sources,...Object.values(j.tasks)])if(['error','unavailable','degraded'].includes(t.status)){t.nextAt=0;t.status='pending';n++;}
        C.log(s,'manual-retry',{count:n});
      }
    });
    if(action==='pause'){controller?.abort();C.emit();return;}
    return C.run(action==='start-now'?'override':action);
  };
  C.setPace = pace=>{C.sessionPace=pace==='fast'?'fast':'auto';C.emit();return C.sessionPace;};
  async function tick(){
    C.localHeartbeat=C.now();C.emit();if(document.visibilityState==='hidden'||C.running||!C.session)return;
    try{
      const s=await C.read(C.session.scope);
      if(!s.baseline.startedAt||s.paused||s.blocked||s.cooldownUntil>C.now())return;
      if(s.worker&&s.worker.owner!==C.owner&&s.worker.expiresAt>C.now())return;
      const softWait=Math.max(s.baseline.stageDelayUntil||0,s.baseline.softPauseUntil||0)>C.now();
      const current=currentBaseline(s),resume=s.settings.autoResume&&!softWait&&(
        (!s.baseline.stages.length)||(current&&!!C.nextTask(current))||(!current&&s.baseline.stages.some(j=>!!C.nextOptionalTask(j,false)))
      );
      const due=s.settings.auto&&s.watermark&&C.now()-s.watermark>=s.settings.interval*60000;
      if(resume||due)await C.run('scheduled');
    }catch(e){C.lastError=(e.code||'SYNC_ERROR')+': '+e.message;}
  }
  C.tick=tick;setInterval(tick,10000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')controller?.abort();else tick();});
  window.addEventListener('pagehide',()=>controller?.abort());
  C.connect().then(tick).catch(()=>{});
})();
