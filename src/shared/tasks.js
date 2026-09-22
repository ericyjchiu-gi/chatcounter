/* Resumable discovery + one-page history tasks. Coverage is separate from count. */
(() => {
  'use strict';const C=globalThis.ChatCounter;
  C.job = (key,from,end,cutoff=from,force=false) => ({key,from,end,cutoff,force,status:'pending',createdAt:C.now(),sources:[C.source('regular'),C.source('archived'),C.source('projects')],tasks:{},completedAt:0});
  C.source = (kind,id='') => ({kind,id,key:kind+':'+id,offset:0,cursor:kind==='projects'?'':'0',optional:['projects','project'].includes(kind),status:'pending',attempts:0,nextAt:0,pages:0,...(kind==='projects'?{discoveredIds:[]}:{})});
  C.beginStages = s => {
    if(s.baseline.stages.length)return;
    const end=C.now();s.baseline.startedAt ||= end;s.baseline.anchor=end;
    s.baseline.stages=[C.job('24h',end-C.DAY,end),C.job('7d',end-7*C.DAY,end),C.job('30d',end-30*C.DAY,end)];
  };
  C.isIndexed = (c,u,from) => !!(c?.complete&&c.from!=null&&c.from<=from&&u&&c.u&&Math.abs(u-c.u)<1000);
  function upsert(s,j,header,source){
    const id=String(header.id||header.conversation_id||'');if(!id)return;
    const u=C.epoch(header.update_time??header.updated_at??header.create_time);
    if(u&&u<j.cutoff)return;
    const old=j.tasks[id];if(old&&(!u||u<=old.u)){if(source!=='project'){old.optional=false;old.source=source;}return;}
    const c=s.conversations[id];
    j.tasks[id]={id,u,source,optional:source==='project',status:!j.force&&C.isIndexed(c,u,j.from)?'unchanged':'pending',cursor:!j.force&&c?.complete&&c.u===u&&c.from>j.from?c.boundaryCursor||null:null,pages:0,attempts:0,nextAt:0,from:j.from,end:j.end,provenFrom:c?.from??null,provenTo:c?.to||0,proven:!!c?.complete};
  }
  C.fetchSource = async (source,job,scope,signal) => {
    let path;
    if(['regular','archived'].includes(source.kind))path='/backend-api/conversations?'+new URLSearchParams({offset:String(source.offset),limit:'100',order:'updated',is_archived:String(source.kind==='archived')});
    else if(source.kind==='projects'){
      const qs=new URLSearchParams({owned_only:'true',conversations_per_gizmo:'0'});
      if(source.cursor)qs.set('cursor',String(source.cursor));
      path='/backend-api/gizmos/snorlax/sidebar?'+qs;
    }
    else path='/backend-api/gizmos/'+encodeURIComponent(source.id)+'/conversations?'+new URLSearchParams({cursor:source.cursor});
    const j=await C.request(path,scope,signal);
    if(source.kind==='projects')return {ids:C.projects(j),next:j.next_cursor??j.cursor??null};
    const items=C.items(j),times=items.map(x=>C.epoch(x.update_time??x.updated_at??x.create_time));
    const sorted=times.every((t,i)=>t>0&&(!i||times[i-1]>=t));
    const cutoffReached=sorted&&times.length>0&&times[times.length-1]<job.cutoff;
    const next=j.next_cursor??j.cursor??null;
    // Root uses offset pagination. Project ordering is not assumed; follow all pages.
    const done=source.kind==='project'?(!next||!items.length):(!items.length||items.length<100||cutoffReached);
    if(!done&&source.pages>=99)throw C.error('LIST_PAGE_CAP','Discovery safety limit reached; coverage remains partial.');
    if(source.kind==='project'&&!done&&next===source.cursor)throw C.error('CURSOR_INVALID','Project cursor repeated.');
    return {items:items.map(x=>({id:x.id||x.conversation_id,update_time:x.update_time??x.updated_at??x.create_time})),done,next};
  };
  C.applySource = (s,j,source,result) => {
    source.pages++;source.attempts=0;source.nextAt=0;delete s.errors[j.key+'/source/'+source.key];
    if(source.kind==='projects'){
      source.discoveredIds=Array.isArray(source.discoveredIds)?source.discoveredIds:[];
      for(const id of result.ids)if(!source.discoveredIds.includes(id))source.discoveredIds.push(id);
      if(result.next&&String(result.next)!==String(source.cursor)){
        if(source.pages>=30)throw C.error('LIST_PAGE_CAP','Project discovery safety limit reached.');
        source.cursor=String(result.next);source.status='pending';
      }else{
        const all=source.discoveredIds.slice(),size=Math.max(1,Number(s.governor?.projectBatchSize)||4);
        let selected=all;
        if(j.key==='recent'&&all.length>size){
          const start=(Number(s.governor?.projectRotation)||0)%all.length;
          selected=Array.from({length:Math.min(size,all.length)},(_,i)=>all[(start+i)%all.length]);
          s.governor.projectRotation=(start+selected.length)%all.length;
          j.projectInventory={total:all.length,selected:selected.length,start};
        }else j.projectInventory={total:all.length,selected:all.length,start:0};
        for(const id of selected)if(!j.sources.some(x=>x.kind==='project'&&x.id===id))j.sources.push(C.source('project',id));
        source.status='done';source.discoveredIds=[];
      }
    }else{
      for(const h of result.items)upsert(s,j,h,source.kind);
      source.offset+=result.items.length;source.cursor=String(result.next||source.cursor);source.status=result.done?'done':'pending';
    }
  };
  C.applyDetail = (s,j,task,result) => {
    // Inspect the whole page before stopping. A cached live event alone is not a coverage proof.
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
  C.refreshJob = j => {
    const tasks=Object.values(j.tasks),all=[...j.sources,...tasks];
    if(all.every(t=>['done','unchanged'].includes(t.status))){j.status='complete';j.completedAt=C.now();}
    else if(all.every(t=>['done','unchanged','unavailable'].includes(t.status)))j.status='partial';
    else j.status='running';
  };
  C.nextTask = j => {
    // Consume discovered recent messages first; continue discovery when the current page is processed.
    const due=t=>['pending','error'].includes(t.status)&&(!t.nextAt||t.nextAt<=C.now());
    const task=Object.values(j.tasks).find(due);if(task)return {type:'chat',item:task};
    const source=j.sources.find(due);return source?{type:'source',item:source}:null;
  };
  C.counts = j => {
    const tasks=Object.values(j?.tasks||{}),all=tasks.concat(j?.sources||[]);
    return {done:tasks.filter(t=>t.status==='done').length,unchanged:tasks.filter(t=>t.status==='unchanged').length,discovered:tasks.length,errors:all.filter(t=>['error','unavailable'].includes(t.status)).length,pending:tasks.filter(t=>t.status==='pending').length,discoveryDone:(j?.sources||[]).every(t=>t.status==='done')};
  };
  C.recordError = (s,j,entry,type,e) => {
    entry.attempts=(entry.attempts||0)+1;entry.lastAttempt=C.now();
    const code=e.code||'UNEXPECTED_ERROR',status=e.status||null;
    const unavailable=(status===404||status===403)&&entry.attempts>=2;
    const schema=/SCHEMA|CURSOR|PAGE_CAP/.test(code);
    const wait=status===429?Math.max(1000,e.waitMs||60000):Math.min(15*60000,10000*2**Math.min(entry.attempts-1,6));
    entry.status=unavailable?'unavailable':'error';entry.nextAt=unavailable||schema?null:C.now()+wait;
    const key=j.key+'/'+type+'/'+(type==='chat'?entry.id:entry.key);
    s.errors[key]={stage:j.key,conversationId:type==='chat'?entry.id:null,source:type==='source'?entry.kind:null,code,httpStatus:status,attempts:entry.attempts,lastAttempt:C.now(),retryAfterMs:wait,nextRetryAt:entry.nextAt,message:String(e.message).slice(0,180),status:entry.status};
    if(status===429)s.cooldownUntil=C.now()+wait;
    if(schema||['AUTH_REQUIRED','ACCOUNT_CHANGED','STORAGE_ERROR','STORAGE_READBACK_FAILED','STORAGE_TIMEOUT'].includes(code))s.blocked=code;
  };
})();
