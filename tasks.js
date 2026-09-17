/* Resumable discovery + one-page history tasks. Core coverage can complete while optional Projects are degraded. */
(() => {
  'use strict';const C=window.ChatCounter;
  C.source = (kind,id='') => ({kind,id,key:kind+':'+id,optional:['projects','project'].includes(kind),offset:0,cursor:'0',status:'pending',attempts:0,nextAt:0,pages:0});
  C.job = (key,from,end,cutoff=from,force=false) => ({key,from,end,cutoff,force,status:'pending',createdAt:C.now(),sources:[C.source('regular'),C.source('archived'),C.source('projects')],tasks:{},completedAt:0,coreCompletedAt:0});
  C.beginStages = s => {
    if(s.baseline.stages.length)return;
    const end=C.now();s.baseline.startedAt ||= end;s.baseline.anchor=end;
    s.baseline.stages=[C.job('24h',end-C.DAY,end),C.job('7d',end-7*C.DAY,end),C.job('30d',end-30*C.DAY,end)];
    C.log(s,'baseline-start',{anchor:end});
  };
  C.isIndexed = (c,u,from) => !!(c?.complete&&c.from!=null&&c.from<=from&&u&&c.u&&Math.abs(u-c.u)<1000);
  function upsert(s,j,header,source){
    const id=String(header.id||header.conversation_id||'');if(!id)return;
    const u=C.epoch(header.update_time??header.updated_at??header.create_time);
    if(u&&u<j.cutoff)return;
    const old=j.tasks[id];if(old&&(!u||u<=old.u))return;
    const c=s.conversations[id],optional=source==='project';
    j.tasks[id]={id,u,source,optional,status:!j.force&&C.isIndexed(c,u,j.from)?'unchanged':'pending',cursor:!j.force&&c?.complete&&c.u===u&&c.from>j.from?c.boundaryCursor||null:null,pages:0,attempts:0,nextAt:0,from:j.from,end:j.end,provenFrom:c?.from??null,provenTo:c?.to||0,proven:!!c?.complete};
  }
  C.fetchSource = async (source,job,scope,signal) => {
    let path;
    if(['regular','archived'].includes(source.kind))path='/backend-api/conversations?'+new URLSearchParams({offset:String(source.offset),limit:'100',order:'updated',is_archived:String(source.kind==='archived')});
    else if(source.kind==='projects')path='/backend-api/gizmos/snorlax/sidebar?'+new URLSearchParams({cursor:source.cursor});
    else path='/backend-api/gizmos/'+encodeURIComponent(source.id)+'/conversations?'+new URLSearchParams({cursor:source.cursor});
    const j=await C.request(path,scope,signal);
    if(source.kind==='projects')return {ids:C.projects(j),next:j.next_cursor??j.cursor??null};
    const items=C.items(j),times=items.map(x=>C.epoch(x.update_time??x.updated_at??x.create_time));
    const sorted=times.every((t,i)=>t>0&&(!i||times[i-1]>=t));
    const cutoffReached=sorted&&times.length>0&&times[times.length-1]<job.cutoff;
    const next=j.next_cursor??j.cursor??null;
    const done=source.kind==='project'?(!next||!items.length):(!items.length||items.length<100||cutoffReached);
    if(!done&&source.pages>=99)throw C.error('LIST_PAGE_CAP','Discovery safety limit reached; coverage remains partial.');
    if(source.kind==='project'&&!done&&next===source.cursor)throw C.error('CURSOR_INVALID','Project cursor repeated.');
    return {items:items.map(x=>({id:x.id||x.conversation_id,update_time:x.update_time??x.updated_at??x.create_time})),done,next};
  };
  C.applySource = (s,j,source,result) => {
    source.pages++;source.attempts=0;source.nextAt=0;delete s.errors[j.key+'/source/'+source.key];
    if(source.kind==='projects'){
      for(const id of result.ids)if(!j.sources.some(x=>x.kind==='project'&&x.id===id))j.sources.push(C.source('project',id));
      if(result.next&&String(result.next)!==String(source.cursor)){
        if(source.pages>=30)throw C.error('LIST_PAGE_CAP','Project discovery safety limit reached.');
        source.cursor=String(result.next);source.status='pending';
      }else source.status='done';
    }else{
      for(const h of result.items)upsert(s,j,h,source.kind);
      source.offset+=result.items.length;source.cursor=String(result.next||source.cursor);source.status=result.done?'done':'pending';
    }
  };
  C.applyDetail = (s,j,task,result) => {
    const overlap=task.proven&&task.provenFrom!=null&&task.provenFrom<=task.from&&result.oldest!==null&&result.oldest<=task.provenTo;
    for(const e of result.events)if(e.t<=C.now())C.merge(s,e,task.id);
    const reached=!result.hasPrevious||(result.oldest!==null&&result.oldest<=task.from)||overlap;
    task.pages++;task.legacy=result.legacy;task.attempts=0;task.nextAt=0;
    delete s.errors[j.key+'/chat/'+task.id];
    if(reached){
      const old=s.conversations[task.id];
      const provenStart=!result.hasPrevious?C.now()-90*C.DAY:result.oldest??task.from;
      s.conversations[task.id]={u:task.u,from:old?.complete&&old.from!=null?Math.min(old.from,provenStart):provenStart,to:task.end,complete:true,boundaryCursor:overlap?old?.boundaryCursor||null:result.hasPrevious?result.cursor:null};
      task.status='done';task.cursor=null;
    }else{
      task.cursor=result.cursor;task.status='pending';
      if(task.pages>=200)C.recordError(s,j,task,'chat',C.error('DETAIL_PAGE_CAP','Conversation pagination safety limit reached; partial data saved.'));
    }
  };
  const good=t=>['done','unchanged'].includes(t.status),terminalGap=t=>['unavailable'].includes(t.status);
  C.refreshJob = j => {
    const tasks=Object.values(j.tasks||{}),required=[...(j.sources||[]).filter(x=>!x.optional),...tasks.filter(x=>!x.optional)],optional=[...(j.sources||[]).filter(x=>x.optional),...tasks.filter(x=>x.optional)];
    const requiredGood=required.every(good),requiredTerminal=required.every(t=>good(t)||terminalGap(t));
    const optionalGood=optional.every(good),optionalWarning=optional.every(t=>good(t)||['degraded','unavailable'].includes(t.status));
    if(requiredGood){
      if(optionalGood){j.status='complete';j.completedAt||=C.now();}
      else if(optionalWarning||j.coreCompletedAt){j.coreCompletedAt||=C.now();j.status='complete_with_warnings';j.completedAt||=C.now();}
      else j.status='running';
    }else if(requiredTerminal){j.status='partial';j.completedAt||=C.now();}
    else j.status=j.status==='pending'?'pending':'running';
  };
  C.nextTask = (j,includeDegraded=false) => {
    const due=t=>['pending','error',...(includeDegraded?['degraded']:[])].includes(t.status)&&(!t.nextAt||t.nextAt<=C.now());
    const task=Object.values(j.tasks||{}).find(due);if(task)return {type:'chat',item:task};
    const source=(j.sources||[]).find(due);return source?{type:'source',item:source}:null;
  };
  C.nextOptionalTask = (j,ignoreDelay=false) => {
    const due=t=>t.optional&&['pending','error','degraded'].includes(t.status)&&(ignoreDelay||!t.nextAt||t.nextAt<=C.now());
    const task=Object.values(j.tasks||{}).find(due);if(task)return {type:'chat',item:task};
    const source=(j.sources||[]).find(due);return source?{type:'source',item:source}:null;
  };
  C.counts = j => {
    const tasks=Object.values(j?.tasks||{}),sources=j?.sources||[],all=tasks.concat(sources),core=sources.filter(x=>!x.optional).concat(tasks.filter(x=>!x.optional)),optional=sources.filter(x=>x.optional).concat(tasks.filter(x=>x.optional));
    return {
      done:tasks.filter(t=>t.status==='done').length,unchanged:tasks.filter(t=>t.status==='unchanged').length,discovered:tasks.length,
      errors:all.filter(t=>['error','unavailable'].includes(t.status)&&!t.optional).length,warnings:all.filter(t=>['error','unavailable','degraded'].includes(t.status)&&t.optional).length,
      pending:tasks.filter(t=>t.status==='pending').length,optionalPending:optional.filter(t=>['pending','error','degraded'].includes(t.status)).length,
      discoveryDone:sources.filter(x=>!x.optional).every(t=>t.status==='done'),coreComplete:core.every(good)
    };
  };
  C.recordError = (s,j,entry,type,e) => {
    entry.attempts=(entry.attempts||0)+1;entry.lastAttempt=C.now();
    const code=e.code||'UNEXPECTED_ERROR',status=e.status||null,optional=entry.optional===true||['projects','project'].includes(entry.kind)||entry.source==='project';
    entry.optional=optional;
    const unavailable=(status===404||status===403)&&entry.attempts>=2;
    const schema=/SCHEMA|CURSOR|PAGE_CAP/.test(code);
    let wait=10000;
    if(status===429)wait=Math.max(1000,e.waitMs||60000);
    else if(status>=500||['NETWORK_ERROR','NETWORK_TIMEOUT'].includes(code))wait=[10000,30000,120000,600000][Math.min(entry.attempts-1,3)];
    else wait=Math.min(10*60000,10000*2**Math.min(entry.attempts-1,6));
    const degraded=optional&&(schema||((status>=500||['NETWORK_ERROR','NETWORK_TIMEOUT'].includes(code))&&entry.attempts>=5));
    entry.status=unavailable?'unavailable':degraded?'degraded':'error';
    entry.nextAt=unavailable?0:degraded?C.now()+30*60000:schema&&!optional?0:C.now()+wait;
    const key=j.key+'/'+type+'/'+(type==='chat'?entry.id:entry.key);
    s.errors[key]={stage:j.key,conversationId:type==='chat'?entry.id:null,source:type==='source'?entry.kind:(entry.optional?'project-chat':null),code,httpStatus:status,attempts:entry.attempts,lastAttempt:C.now(),retryAfterMs:wait,nextRetryAt:entry.nextAt,message:String(e.message).slice(0,180),status:entry.status,optional};
    if(status===429)s.cooldownUntil=C.now()+wait;
    if(schema&&!optional||['AUTH_REQUIRED','ACCOUNT_CHANGED','STORAGE_ERROR','STORAGE_READBACK_FAILED','STORAGE_TIMEOUT'].includes(code))s.blocked=code;
    C.log(s,'request-error',{stage:j.key,target:type==='chat'?'chat':entry.kind||'source',code,httpStatus:status||0,attempts:entry.attempts,status:entry.status,nextRetryAt:entry.nextAt});
    C.refreshJob(j);
  };
})();
