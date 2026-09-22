/* Native scanner exclusion, durable checkpoints, explicit outcomes, background-compatible bounded work slices. */
(() => {
  'use strict';const C=globalThis.ChatCounter;
  C.session=null;C.running=null;C.localHeartbeat=C.now();C.lastError='';C.lastAction='';
  let connecting=null,controller=null;
  C.connect=async(force=false)=>{
    if(connecting)return connecting;
    connecting=(async()=>{
      const who=await C.auth(force);
      if(C.expectedScope&&who.scope!==C.expectedScope)throw C.error('ACCOUNT_CHANGED','The signed-in ChatGPT account differs from the selected index. Switch accounts or select the matching index.');
      await C.migrate(who.scope,who.oldScope);C.session=who;
      const s=await C.read(who.scope);
      if(s.plan.raw!==who.plan.raw||s.plan.source!==who.plan.source||s.plan.seat!==who.plan.seat)await C.write(who.scope,s=>{s.plan=who.plan;});
      C.lastError='';if(C.onConnected)await C.onConnected(who);
      return who;
    })().catch(e=>{C.lastError=(e.code||'AUTH_ERROR')+': '+e.message;C.session=null;throw e;}).finally(()=>{connecting=null;});return connecting;
  };
  const stageDelay=()=>120000+Math.floor(Math.random()*180000);
  const locate=(s,key)=>key==='recent'?s.recent:s.baseline.stages.find(j=>j.key===key);
  function touch(s,j,activity){s.worker={owner:C.owner,engine:'background-201',stage:j?.key||'',activity,heartbeatAt:C.now(),expiresAt:C.now()+45000};}
  function entryAt(s,key){
    const [stage,type,...rest]=key.split('/'),j=locate(s,stage),id=rest.join('/');if(!j)return null;
    const item=type==='chat'?j.tasks[id]:j.sources.find(x=>x.key===id);return item?{job:j,type,item}:null;
  }
  function prepare(s){
    C.beginStages(s);
    if(s.settings.auto&&s.watermark&&C.now()-s.watermark>=s.settings.interval*60000&&(!s.recent||C.stageTerminal(s.recent)))s.needsRecent=true;
    if(s.needsRecent&&s.watermark&&(!s.recent||C.stageTerminal(s.recent))){
      const now=C.now();s.recent=C.job('recent',now-(C.complete(s)?30:1)*C.DAY,now,Math.max(now-30*C.DAY,s.watermark-120000));s.needsRecent=false;
    }
  }
  function select(s,reason,manualKeys,seen){
    if(reason==='retry')for(const key of manualKeys){
      if(seen.has(key))continue;const found=entryAt(s,key);if(found&&!['done','unchanged'].includes(found.item.status))return {...found,retryKey:key};
    }
    const burstPaused=(s.governor?.softPauseUntil||0)>C.now();
    if(s.recent&&!burstPaused){
      const required=C.nextRequired(s.recent);if(required)return {job:s.recent,...required};
      const extra=C.nextOptional(s,s.recent);if(extra)return {job:s.recent,...extra};
    }
    const allowed=reason!=='scheduled'||s.settings.autoResume||s.runRequested;
    const current=allowed?C.firstStage(s):null;
    // Finish/attempt Project coverage for completed earlier stages before widening core history.
    // Stage-transition rests delay the NEXT core stage, not the previous stage's Projects.
    if(allowed&&!burstPaused){const prior=C.nextPriorOptional(s,current);if(prior)return prior;}
    if(allowed&&current&&C.softUntil(s)<=C.now()){
      // Initialisation is discovery-first: finish the lightweight conversation
      // inventory before reading message pages, so the UI can expose a stable
      // conversation-count denominator as early as the source allows.
      const discovery=C.nextDiscovery(s,current);if(discovery)return {job:current,...discovery};
      const t=C.nextRequired(current);if(t)return {job:current,...t};
    }
    return null;
  }
  function telemetry(s,j,target){
    for(const x of C.httpSamples.splice(0)){
      s.governor.health.push(x);s.governor.health=s.governor.health.filter(h=>h.t>=C.now()-300000).slice(-30);
      C.log(s,'http-result',{stage:j.key,target,httpStatus:x.status,latencyMs:x.latency});
      s.governor.burstCount++;s.requests++;
    }
  }
  function completed(s,j,beforeCore){
    C.refreshJob(j);
    if(!C.counts(j).coreComplete||beforeCore)return;
    C.log(s,'core-stage-complete',{stage:j.key,status:j.status});
    if(j.key==='24h'&&!s.watermark)s.watermark=j.end;
    if(j.key==='recent'){s.watermark=j.end;s.lastResult={...C.counts(j),at:C.now()};return;}
    if(j.key!=='30d'){
      s.governor.stageDelayUntil=C.now()+stageDelay();
      C.log(s,'stage-rest',{stage:j.key,until:s.governor.stageDelayUntil});
    }
  }
  function budget(s,stage){
    // Shared account-level request budget: recent reconciliation and baseline
    // backfill consume the same inferred history-endpoint bucket.
    const limit=C.sessionPace==='conservative'?25:C.sessionPace==='fast'?55:40;
    if(s.governor.burstCount>=limit){
      s.governor.softPauseUntil=C.now()+stageDelay();s.governor.burstCount=0;
      C.log(s,'budget-rest',{stage,count:limit,until:s.governor.softPauseUntil});
    }
  }
  function idleReason(s){
    if(s.paused)return 'Paused. Saved progress retained.';
    if(s.blocked)return 'Needs attention: '+s.blocked+'. No further requests sent.';
    if(s.cooldownUntil>C.now())return 'Server cooldown until '+new Date(s.cooldownUntil).toLocaleTimeString()+'. Retry-After cannot be overridden.';
    if(C.softUntil(s)>C.now())return 'Scheduled rest until '+new Date(C.softUntil(s)).toLocaleTimeString()+'. Start now can skip this client-side wait.';
    if(C.fullyComplete(s))return 'Sync finished. Available history indexed.';
    const deadlines=C.jobs(s).flatMap(C.entries).map(t=>t.nextAt).filter(t=>t>C.now());
    if(deadlines.length)return 'Waiting for retry at '+new Date(Math.min(...deadlines)).toLocaleTimeString()+'. Existing cache is available.';
    return 'No eligible task. Review the visible source errors; cached data was retained.';
  }
  async function work(scope,reason,manualKeys=[]){
    await C.rpc('probe');controller=new AbortController();const signal=controller.signal,seen=new Set();let heartbeat;const sliceStart=C.now();let sliceRequests=0;
    try{
      await C.write(scope,s=>{s.lastAttempt=C.now();touch(s,null,'Preparing saved tasks');C.log(s,'scanner-start',{reason,pace:C.sessionPace});prepare(s);});
      if(!C.isWorker)heartbeat=setInterval(()=>C.write(scope,s=>{if(s.worker?.owner===C.owner){s.worker.heartbeatAt=C.now();s.worker.expiresAt=C.now()+45000;}}).catch(e=>{C.lastError=(e.code||'STORAGE_ERROR')+': '+e.message;controller?.abort();}),10000);
      while(!signal.aborted){
        if(C.isWorker&&(sliceRequests>=8||C.now()-sliceStart>=18000))break;
        let snapshot=await C.read(scope);if(snapshot.paused||snapshot.blocked||snapshot.cooldownUntil>C.now()||!snapshot.baseline.startedAt)break;
        // Do not sleep through worker eviction during recovery. Resume at an alarm.
        if(C.isWorker&&((snapshot.governor?.lastRequestAt||0)+C.requestGap(snapshot,C.currentStage)-C.now()>5000))break;
        let chosen;
        snapshot=await C.write(scope,s=>{prepare(s);chosen=select(s,reason,manualKeys,seen);if(chosen){chosen.job.startedAt ||= C.now();if(!C.stageTerminal(chosen.job))chosen.job.status='running';touch(s,chosen.job,chosen.type==='chat'?'Reading reply metadata':'Listing '+chosen.item.kind);}});
        if(!chosen)break;
        if(chosen.retryKey)seen.add(chosen.retryKey);
        const {item,type}=chosen,key=chosen.job.key,id=type==='chat'?item.id:item.key,target=type==='chat'?'conversation':item.kind;
        C.currentStage=key;C.httpSamples=[];sliceRequests++;
        await C.write(scope,s=>{C.log(s,'task-start',{stage:key,target,optional:!!item.optional});});
        try{
          const result=type==='chat'?await C.detail(item,scope,signal):await C.fetchSource(item,chosen.job,scope,signal);
          await C.write(scope,s=>{
            const j=locate(s,key),t=type==='chat'?j.tasks[id]:j.sources.find(x=>x.key===id),before=C.counts(j).coreComplete;
            telemetry(s,j,target);
            if(type==='chat')C.applyDetail(s,j,t,result);else C.applySource(s,j,t,result);
            const ck=C.circuitKey(t);if(ck)delete s.sourceHealth[ck];
            s.lastCheckpoint=C.now();touch(s,j,'Checkpoint saved');C.log(s,'checkpoint',{stage:key,target});completed(s,j,before);budget(s,key);
          });
        }catch(e){
          if(e.code==='INTERRUPTED'||signal.aborted)break;
          if(/^STORAGE|BRIDGE|LOCK/.test(e.code||''))throw e;
          await C.write(scope,s=>{
            const j=locate(s,key),t=type==='chat'?j.tasks[id]:j.sources.find(x=>x.key===id),before=C.counts(j).coreComplete;
            telemetry(s,j,target);C.recordError(s,j,t,type,e);completed(s,j,before);s.lastCheckpoint=C.now();budget(s,key);
          });
          if(e.status===429||['AUTH_REQUIRED','ACCOUNT_CHANGED','RATE_LIMIT_WAIT'].includes(e.code))break;
        }
      }
      const s=await C.read(scope);C.lastAction=idleReason(s);return {outcome:'finished',message:C.lastAction};
    }finally{
      if(heartbeat)clearInterval(heartbeat);controller=null;
      await C.write(scope,s=>{if(s.worker?.owner===C.owner)s.worker=null;C.log(s,'scanner-stop',{reason});}).catch(e=>{C.lastError=(e.code||'STORAGE_ERROR')+': '+e.message;});
    }
  }
  C.run=(reason,manualKeys=[])=>{
    if(C.running){C.lastAction='Attached to the active scan; no duplicate request.';C.emit();return C.running;}
    C.running=(async()=>{
      const who=await C.connect(true),s=await C.read(who.scope);
      if(!s.baseline.startedAt||s.paused||s.blocked||s.cooldownUntil>C.now()){C.lastAction=idleReason(s);return {outcome:'waiting',message:C.lastAction};}
      const result=await C.lock('chatcounter:history-sync:'+who.oldScope,()=>work(who.scope,reason,manualKeys),true);
      if(result?.busy)C.lastAction='Another tab owns the native scanner lock. This click sent no history requests.';
      return result;
    })().catch(e=>{C.lastError=(e.code||'SYNC_ERROR')+': '+e.message;C.lastAction='Sync stopped: '+C.lastError;return {error:C.lastError};}).finally(()=>{C.running=null;C.emit();});C.emit();return C.running;
  };
  C.control=async action=>{
    C.lastError='';C.lastAction='Processing '+action+'…';C.emit();
    const who=await C.connect(true);let keys=[],blockedMessage='';
    if(action==='rebuild'){
      if(C.running)throw C.error('SYNC_ACTIVE','Pause the active scanner before rebuilding.');
      const result=await C.lock('chatcounter:history-sync:'+who.oldScope,()=>C.write(who.scope,s=>{
        if(s.blocked||s.cooldownUntil>C.now()){blockedMessage=idleReason(s);return;}
        s.runRequested=true;s.baseline={startedAt:C.now(),anchor:0,stages:[]};C.beginStages(s);s.baseline.stages.forEach(j=>j.force=true);s.recent=null;s.watermark=0;s.paused=false;s.errors={};s.sourceHealth={};s.governor.stageDelayUntil=0;s.governor.softPauseUntil=0;s.governor.burstCount=0;C.log(s,'rebuild');
      }),true);
      if(result?.busy)throw C.error('SYNC_ACTIVE','Another page is scanning; no history was reset.');
      if(blockedMessage){C.lastAction=blockedMessage;C.emit();return {outcome:'blocked',message:blockedMessage};}
      return C.run('rebuild');
    }
    await C.write(who.scope,s=>{
      if(action==='pause'){s.paused=true;s.runRequested=false;C.log(s,'pause');return;}
      if(action==='reauth'&&s.blocked==='AUTH_REQUIRED'){s.blocked='';C.log(s,'auth-rechecked');}
      if(s.blocked||s.cooldownUntil>C.now()){blockedMessage=idleReason(s);C.log(s,'action-blocked',{action,reason:s.blocked||'server-cooldown'});return;}
      s.runRequested=true;
      if(action==='start'||action==='resume'){s.baseline.startedAt ||= C.now();s.paused=false;C.beginStages(s);}
      if(action==='start-now'){s.paused=false;s.governor.stageDelayUntil=0;s.governor.softPauseUntil=0;C.log(s,'soft-wait-override');}
      if(action==='reconcile')s.needsRecent=true;
      if(action==='retry'){
        s.paused=false;const seenTargets=new Set();
        for(const [key,e]of C.retryRecords(s)){
          const found=entryAt(s,key);if(!found)continue;
          const t=found.item,identity=C.circuitKey(t)||key;
          if(seenTargets.has(identity))continue;seenTargets.add(identity);
          if((t.manualRetryNotBefore||0)>C.now())continue;
          t.manualRetryNotBefore=C.now()+10000;t.nextAt=0;t.status='pending';keys.push(key);
          if(identity in s.sourceHealth)delete s.sourceHealth[identity];
          e.nextRetryAt=0;e.status='pending';
        }
        if(!keys.length)blockedMessage='No safe retry is eligible yet. A manual retry is limited to once per target per 10 seconds; schema/auth/storage errors need attention.';
        C.log(s,'manual-retry',{count:keys.length});
      }else C.log(s,'control',{action});
    });
    if(action==='pause'){controller?.abort();C.lastAction='Paused; the last checkpoint is retained.';C.emit();return {outcome:'paused'};}
    if(blockedMessage){C.lastAction=blockedMessage;C.emit();return {outcome:'waiting',message:blockedMessage};}
    return C.run(action,keys);
  };
  async function tick(){
    C.localHeartbeat=C.now();C.emit();if(document.visibilityState==='hidden'||C.running||!C.session)return;
    try{
      const s=await C.read(C.session.scope);if(!s.baseline.startedAt||s.paused||s.blocked||s.cooldownUntil>C.now()||(s.governor?.softPauseUntil||0)>C.now())return;
      if(s.worker&&s.worker.owner!==C.owner&&s.worker.expiresAt>C.now())return;
      const recentDue=s.settings.auto&&s.watermark&&C.now()-s.watermark>=s.settings.interval*60000;
      const j=C.firstStage(s),burstPaused=(s.governor?.softPauseUntil||0)>C.now();
      const priorDue=!burstPaused&&!!C.nextPriorOptional(s,j);
      const coreDue=!!j&&C.softUntil(s)<=C.now()&&!!C.nextRequired(j);
      const baselineDue=s.settings.autoResume&&(!s.baseline.stages.length||priorDue||coreDue);
      if(recentDue||baselineDue)await C.run('scheduled');
    }catch(e){C.lastError=(e.code||'SYNC_ERROR')+': '+e.message;}
  }
  C.tick=tick;C.abortScan=()=>controller?.abort();
  if(!C.isWorker){setInterval(tick,10000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')controller?.abort();else tick();});
  window.addEventListener('pagehide',()=>controller?.abort());C.connect().then(tick).catch(()=>{});
  }
})();
