/* v1.8 queue policy. All times and retry state persist; tokens/bodies never do. */
(() => {
  'use strict'; const C=globalThis.ChatCounter;
  C.sessionPace='auto'; C.currentStage='24h'; C.httpSamples=[];
  const good=t=>['done','unchanged'].includes(t.status);
  const optional=t=>t.optional===true||['projects','project'].includes(t.kind)||t.source==='project';
  const softError=e=>e?.httpStatus>=500||['NETWORK_ERROR','NETWORK_TIMEOUT'].includes(e?.code);
  C.entries=j=>[...(j?.sources||[]),...Object.values(j?.tasks||{})];
  C.errorKey=(j,t,type)=>j.key+'/'+type+'/'+(type==='chat'?t.id:t.key);
  C.circuitKey=t=>t.kind==='projects'?'projects':t.kind==='project'?'project:'+t.id:t.optional?'project-chat:'+t.id:'';
  C.log=(s,type,detail={})=>{
    const safe={};for(const k of ['stage','target','code','httpStatus','attempts','status','until','count','reason','pace','latencyMs','action','outcome','optional']){
      const v=detail[k];if(v===null||['number','boolean','string'].includes(typeof v))safe[k]=typeof v==='string'?v.slice(0,180):v;
    }
    s.log=Array.isArray(s.log)?s.log:[];s.log.push({t:C.now(),type:String(type).slice(0,60),...safe});s.log=s.log.slice(-200);
  };
  C.normalize=s=>{
    s.settings={...C.defaults(),...s.settings};s.log=Array.isArray(s.log)?s.log.slice(-200):[];
    s.sourceHealth=s.sourceHealth||{};s.governor={stageDelayUntil:0,softPauseUntil:0,burstCount:0,lastRequestAt:0,recoveryUntil:0,projectRotation:0,projectBatchSize:4,health:[],...s.governor};
    s.governor.health=(s.governor.health||[]).filter(x=>x.t>=C.now()-300000).slice(-30);
    if((s.settings.resetDay===''||s.settings.resetDay==null)&&s.settings.resetLocal){
      const legacy=new Date(s.settings.resetLocal);if(Number.isFinite(legacy.getTime())){s.settings.resetDay=String(legacy.getDay());s.settings.resetTime=legacy.toTimeString().slice(0,5);}
    }
    // Migrate both 1.7.0 and early 1.7.1 checkpoints once; never extend deadlines on each read.
    if(s.policyVersion!==171){
      s.governor.stageDelayUntil=Math.max(s.governor.stageDelayUntil,s.baseline.stageDelayUntil||0);
      s.governor.softPauseUntil=Math.max(s.governor.softPauseUntil,s.baseline.softPauseUntil||0);
      s.policyVersion=171;
    }
    // v1.7.3 corrected the Projects sidebar first-page request. Requeue only
    // never-successful sidebar tasks; cached replies and per-Project progress stay intact.
    if(s.projectSidebarVersion!==2){
      let reset=0;
      for(const j of C.jobs(s))for(const t of j.sources||[]){
        if(t.kind!=='projects'||(t.pages||0)>0)continue;
        t.cursor='';
        if(['error','degraded','blocked_source','unavailable'].includes(t.status))t.status='pending';
        t.attempts=0;t.nextAt=0;
        delete s.errors[C.errorKey(j,t,'source')];reset++;
      }
      delete s.sourceHealth.projects;s.projectSidebarVersion=2;
      if(reset)C.log(s,'project-sidebar-upgrade',{count:reset,reason:'correct-first-page-query'});
    }
    for(const j of C.jobs(s)){
      for(const t of C.entries(j)){
        t.optional=optional(t);
        const type=t.kind?'source':'chat',key=C.errorKey(j,t,type),e=s.errors[key];
        if(e)e.optional=t.optional;
        if(t.optional&&e&&softError(e)&&t.attempts>=5&&t.status==='error'){
          t.status='degraded';t.nextAt=Number(t.nextAt)||Number(e.nextRetryAt)||Number(e.lastAttempt)+1800000;
          e.status='degraded';e.nextRetryAt=t.nextAt;
          const ck=C.circuitKey(t);if(ck)s.sourceHealth[ck]={until:t.nextAt,attempts:t.attempts,code:e.code,httpStatus:e.httpStatus};
        }
      }
      C.refreshJob(j);
      if(j.key==='24h'&&C.counts(j).coreComplete&&!s.watermark)s.watermark=j.end;
    }
    return s;
  };
  C.refreshJob=j=>{
    const all=C.entries(j),core=all.filter(t=>!optional(t)),extra=all.filter(optional);
    const coreGood=core.every(good),coreTerminal=core.every(t=>good(t)||t.status==='unavailable');
    if(coreGood){j.coreCompletedAt ||= C.now();j.status=extra.every(good)?'complete':'complete_with_warnings';if(j.status==='complete')j.completedAt ||= C.now();}
    else if(coreTerminal)j.status='partial';
    else if(j.status!=='pending')j.status='running';
  };
  C.stageTerminal=j=>['complete','complete_with_warnings','partial'].includes(j?.status);
  C.complete=s=>s.baseline.stages.length===3&&s.baseline.stages.every(j=>['complete','complete_with_warnings'].includes(j.status));
  C.fullyComplete=s=>s.baseline.stages.length===3&&s.baseline.stages.every(j=>j.status==='complete');
  C.gaps=s=>C.jobs(s).flatMap(C.entries).filter(t=>['error','unavailable'].includes(t.status)&&!optional(t));
  C.warnings=s=>C.jobs(s).flatMap(C.entries).filter(t=>!good(t)&&optional(t));
  C.counts=j=>{
    const tasks=Object.values(j?.tasks||{}),sources=j?.sources||[],all=C.entries(j);
    return {done:tasks.filter(t=>t.status==='done').length,unchanged:tasks.filter(t=>t.status==='unchanged').length,discovered:tasks.length,
      errors:all.filter(t=>['error','unavailable','degraded','blocked_source'].includes(t.status)).length,
      pending:tasks.filter(t=>t.status==='pending').length,sourcePending:sources.filter(t=>t.status==='pending').length,
      warnings:all.filter(t=>!good(t)&&optional(t)).length,coreErrors:all.filter(t=>['error','unavailable'].includes(t.status)&&!optional(t)).length,
      discoveryDone:sources.filter(t=>!optional(t)).every(good),coreComplete:all.filter(t=>!optional(t)).every(good),fullDiscoveryDone:sources.every(good)};
  };
  C.stageMetrics=(s,key)=>{
    const j=(s.baseline?.stages||[]).find(x=>x.key===key),n=C.counts(j),indexed=n.done+n.unchanged,total=n.discovered;
    const percent=total?Math.max(0,Math.min(100,Math.round(indexed/total*100))):0;
    return {job:j,...n,indexed,total,percent,complete:j?.status==='complete',coreComplete:!!n.coreComplete,discoveryComplete:!!n.fullDiscoveryDone,
      discovering:!!j&&!n.fullDiscoveryDone&&n.sourcePending>0,knownOnly:!!j&&!n.fullDiscoveryDone&&n.discoveryDone};
  };
  C.activeBaselineStage=s=>{
    const active=s.worker?.stage&&s.baseline.stages.find(j=>j.key===s.worker.stage);return active||C.firstStage(s)||s.baseline.stages[2]||null;
  };
  C.due=t=>['pending','error','degraded'].includes(t.status)&&(!t.nextAt||t.nextAt<=C.now());
  C.nextDiscovery=(s,j)=>{
    const required=(j?.sources||[]).find(t=>!optional(t)&&C.due(t));if(required)return {type:'source',item:required};
    const extra=(j?.sources||[]).find(t=>optional(t)&&C.due(t)&&!(s.sourceHealth[C.circuitKey(t)]?.until>C.now()));
    return extra?{type:'source',item:extra}:null;
  };
  C.nextRequired=j=>{
    const t=Object.values(j.tasks||{}).find(t=>!optional(t)&&C.due(t));if(t)return {type:'chat',item:t};
    const source=j.sources.find(t=>!optional(t)&&C.due(t));return source?{type:'source',item:source}:null;
  };
  C.nextOptional=(s,j)=>{
    const due=t=>optional(t)&&C.due(t)&&!(s.sourceHealth[C.circuitKey(t)]?.until>C.now());
    const t=Object.values(j.tasks||{}).find(due);if(t)return {type:'chat',item:t};
    const source=j.sources.find(due);return source?{type:'source',item:source}:null;
  };
  C.nextTask=j=>C.nextRequired(j)||(()=>{const t=Object.values(j.tasks||{}).find(C.due);if(t)return {type:'chat',item:t};const x=j.sources.find(C.due);return x?{type:'source',item:x}:null;})();
  C.recordError=(s,j,t,type,e)=>{
    t.attempts=(t.attempts||0)+1;t.lastAttempt=C.now();t.optional=optional(t);
    const code=e.code||'UNEXPECTED_ERROR',status=e.status||null,schema=/SCHEMA|CURSOR|PAGE_CAP/.test(code);
    const retryable=status>=500||['NETWORK_ERROR','NETWORK_TIMEOUT'].includes(code);
    const unavailable=[403,404].includes(status)&&t.attempts>=2;
    const degraded=t.optional&&retryable&&t.attempts>=5;
    let wait=status===429?Math.max(1000,e.waitMs||60000):retryable?[10000,30000,120000,600000][Math.min(t.attempts-1,3)]:Math.min(600000,10000*2**Math.min(t.attempts-1,6));
    if(degraded)wait=1800000;
    t.status=schema&&t.optional?'blocked_source':unavailable?'unavailable':degraded?'degraded':'error';
    t.nextAt=schema||unavailable?0:C.now()+wait;
    t.lastCode=code;t.httpStatus=status;
    const ck=C.circuitKey(t);
    if(ck&&retryable)s.sourceHealth[ck]={until:t.nextAt,attempts:t.attempts,code,httpStatus:status};
    const key=C.errorKey(j,t,type);
    s.errors[key]={stage:j.key,conversationId:type==='chat'?t.id:null,source:type==='source'?t.kind:null,optional:t.optional,code,httpStatus:status,attempts:t.attempts,lastAttempt:C.now(),retryAfterMs:wait,nextRetryAt:t.nextAt,status:t.status,message:String(e.message).slice(0,180)};
    if(status===429){
      s.cooldownUntil=Math.max(s.cooldownUntil||0,C.now()+wait);
      s.governor.recoveryUntil=Math.max(s.governor.recoveryUntil||0,C.now()+5*60000);
      s.governor.burstCount=0;
    }
    if(schema&&!t.optional||['AUTH_REQUIRED','ACCOUNT_CHANGED','STORAGE_ERROR','STORAGE_READBACK_FAILED','STORAGE_TIMEOUT'].includes(code))s.blocked=code;
    C.log(s,'task-error',{stage:j.key,target:type==='chat'?'conversation':t.kind,code,httpStatus:status,attempts:t.attempts,status:t.status,until:t.nextAt,optional:t.optional});C.refreshJob(j);
  };
  C.requestGap=(s={},stage=C.currentStage)=>{
    const base=C.sessionPace==='fast'?1000:C.sessionPace==='conservative'?{ '24h':3000,'7d':5000,'30d':8000,recent:3000}[stage]||3000:{'24h':1500,'7d':2500,'30d':4000,recent:1500}[stage]||2500;
    const h=(s.governor?.health||[]).filter(x=>x.t>=C.now()-300000).slice(-10),fail=h.filter(x=>x.status===0||x.status>=500).length;
    const lat=h.length?h.reduce((n,x)=>n+x.latency,0)/h.length:0;
    const recovery=(s.governor?.recoveryUntil||0)>C.now()?45000:0;
    return Math.max(base,recovery,fail>=2?5000:fail||lat>2500?3000:base);
  };
  C.setPace=pace=>{C.sessionPace=['auto','conservative','fast'].includes(pace)?pace:'auto';C.emit();return C.sessionPace;};
  C.noteRequest=(status,latency)=>{C.httpSamples.push({t:C.now(),status,latency});C.httpSamples=C.httpSamples.slice(-30);};
  C.softUntil=s=>Math.max(s.governor?.stageDelayUntil||0,s.governor?.softPauseUntil||0);
  C.canRetry=e=>!( /SCHEMA|CURSOR|PAGE_CAP|AUTH|ACCOUNT|STORAGE|BRIDGE|LOCK/.test(e.code||''))&&e.status!=='blocked_source';
  C.retryRecords=s=>Object.entries(s.errors||{}).filter(([,e])=>C.canRetry(e));
  C.firstStage=s=>s.baseline.stages.find(j=>!C.stageTerminal(j));
  // Project/optional work for an earlier stage gets one chance before wider core history.
  // A shared source circuit or per-task backoff can defer it without blocking the next stage.
  C.nextPriorOptional=(s,current=C.firstStage(s))=>{
    const stages=s.baseline?.stages||[],index=current?stages.indexOf(current):stages.length,stop=index<0?stages.length:index;
    for(let i=0;i<stop;i++){
      const next=C.nextOptional(s,stages[i]);
      if(next)return {job:stages[i],...next,priorStage:true};
    }
    return null;
  };
  C.queueView=s=>{
    const now=C.now(),active=s.worker&&s.worker.expiresAt>now,j=C.firstStage(s),retry=C.retryRecords(s),soft=C.softUntil(s);
    const result=(action,label,disabled=false,reason='',until=0)=>({action,label,disabled,reason,until});
    if(active)return result('','Syncing '+(s.worker.stage||'')+'…',true,'A scanner is active.');
    if(s.cooldownUntil>now)return result('','Server cooldown · '+Math.ceil((s.cooldownUntil-now)/1000)+'s',true,'HTTP 429: cannot override Retry-After.',s.cooldownUntil);
    if(s.blocked)return result(s.blocked==='AUTH_REQUIRED'?'reauth':'',s.blocked==='AUTH_REQUIRED'?'Recheck sign-in':'Needs attention',s.blocked!=='AUTH_REQUIRED',s.blocked);
    if(!s.baseline.startedAt)return result('start','Start indexing');
    if(s.paused)return result('resume','Resume',false, 'Resume preserves server and scheduled cooldowns.');
    const prior=C.nextPriorOptional(s,j),burstWait=(s.governor?.softPauseUntil||0)>now;
    if(prior&&!burstWait)return result('resume','Resume '+prior.job.key+' Projects',false,prior.job.key+' Project coverage is attempted before wider core history.');
    if(soft>now&&j)return result('start-now','Start '+j.key+' now',false,'Scheduled soft wait; Start now skips only this wait.',soft);
    if(j&&C.nextRequired(j))return result('resume','Resume '+j.key+' backfill');
    if(retry.length)return result('retry','Retry '+retry.length+' error'+(retry.length===1?'':'s')+' once',false,'One manual attempt per failing target; a repeated error is logged and backed off.');
    if(!j&&C.warnings(s).some(t=>t.status==='blocked_source'))return result('','Projects need attention',true,'An optional source schema changed. Core history is retained; inspect diagnostics.');
    if(!C.fullyComplete(s))return result('resume','Resume history',false,'Continue available tasks; missing sources stay visibly incomplete.');
    return result('reconcile','Reconcile now');
  };
  C.diagnostics=(s,status='')=>({version:C.version,exportedAt:new Date().toISOString(),status,nativeLocks:!!navigator.locks?.request,plan:{type:s.plan.raw,label:s.plan.label},
    baseline:s.baseline.stages.map(j=>({key:j.key,status:j.status,...C.counts(j),progress:C.stageMetrics(s,j.key).percent})),worker:s.worker,lastCheckpoint:s.lastCheckpoint,watermark:s.watermark,
    cooldownUntil:s.cooldownUntil,softPauseUntil:C.softUntil(s),recoveryUntil:s.governor?.recoveryUntil||0,pace:C.sessionPace,budget:{count:s.governor?.burstCount||0,projectBatchSize:s.governor?.projectBatchSize||4,projectRotation:s.governor?.projectRotation||0},errors:s.errors,sourceHealth:s.sourceHealth,
    cacheStats:{conversations:Object.keys(s.conversations).length,replies:Object.keys(s.events).length},recentLog:s.log.slice(-200),lastError:C.lastError||''});
})();
