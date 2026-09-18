/* v1.7.3 hotfix: correct Projects sidebar first-page semantics and migrate stale failures. */
(() => {
  'use strict';
  const C=window.ChatCounter;
  C.version='1.7.3';

  const originalSource=C.source;
  C.source=(kind,id='')=>{
    const source=originalSource(kind,id);
    if(kind==='projects')source.cursor='';
    return source;
  };

  const originalFetchSource=C.fetchSource;
  C.fetchSource=async(source,job,scope,signal)=>{
    if(source.kind!=='projects')return originalFetchSource(source,job,scope,signal);
    const qs=new URLSearchParams({owned_only:'true',conversations_per_gizmo:'0'});
    const cursor=String(source.cursor??'');
    if(cursor&&cursor!=='0')qs.set('cursor',cursor);
    const response=await C.request('/backend-api/gizmos/snorlax/sidebar?'+qs,scope,signal);
    return {ids:C.projects(response),next:response.next_cursor??response.cursor??null};
  };

  const originalNormalize=C.normalize;
  C.normalize=state=>{
    const s=originalNormalize(state);
    if(s.projectSidebarVersion===2)return s;
    let reset=0;
    for(const job of C.jobs(s))for(const source of job.sources||[]){
      if(source.kind!=='projects'||(source.pages||0)>0)continue;
      source.cursor='';
      if(['error','degraded','blocked_source','unavailable'].includes(source.status))source.status='pending';
      source.attempts=0;source.nextAt=0;
      const key=C.errorKey?C.errorKey(job,source,'source'):job.key+'/source/'+source.key;
      delete s.errors[key];reset++;
    }
    if(s.sourceHealth)delete s.sourceHealth.projects;
    s.projectSidebarVersion=2;
    if(reset&&C.log)C.log(s,'project-sidebar-upgrade',{count:reset,reason:'correct-first-page-query'});
    return s;
  };

  const patchLabel=()=>{
    const subtitle=document.getElementById('chatcounter-v17')?.shadowRoot?.querySelector('header small');
    if(subtitle)subtitle.textContent='v1.7.3 · Universal · Projects endpoint fix';
  };
  new MutationObserver(patchLabel).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',()=>setTimeout(patchLabel,0),true);
  patchLabel();
})();
