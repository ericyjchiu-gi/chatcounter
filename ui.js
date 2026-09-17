/* Universal dashboard. All acquisition state and controls live in Sync & History. */
(() => {
  'use strict';const C=window.ChatCounter;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ago=t=>!t?'Never':Math.max(0,Math.floor((C.now()-t)/1000))<60?Math.max(0,Math.floor((C.now()-t)/1000))+'s ago':Math.floor((C.now()-t)/60000)+'m ago';
  const at=t=>t?new Date(t).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Not yet';
  let root=null,shadow=null,range='24h',manualOpen=null,lastIssue='',state=C.fresh(),loading=false;
  const q=s=>shadow?.querySelector(s);
  const ranges={'24h':{ms:C.DAY,bucket:C.DAY/24,n:24},'7d':{ms:7*C.DAY,bucket:C.DAY/4,n:28},'30d':{ms:30*C.DAY,bucket:C.DAY,n:30}};
  function chart(events){
    const r=ranges[range],end=C.now(),start=end-r.ms,rows=Array.from({length:r.n},()=>({gpt56:0,gpt56pro:0,gpt6pro:0}));
    for(const e of events){const i=Math.floor((e.t-start)/r.bucket),k=C.family(e.model);if(i>=0&&i<r.n&&k!=='other')rows[i][k]++;}
    const max=Math.max(4,...rows.flatMap(x=>Object.values(x))),top=Math.ceil(max/4)*4,W=860,H=238,L=38,R=18,B=30,T=14;
    const x=i=>L+i*(W-L-R)/(r.n-1),y=n=>T+(H-T-B)*(1-n/top);
    const grid=[0,1,2,3,4].map(i=>`<line x1="${L}" x2="${W-R}" y1="${y(top*i/4)}" y2="${y(top*i/4)}" stroke="#2a2d31"/><text x="30" y="${y(top*i/4)+4}" text-anchor="end">${top*i/4}</text>`).join('');
    const lines=C.series.map(s=>`<polyline fill="none" stroke="${s.color}" stroke-width="2.4" points="${rows.map((v,i)=>x(i)+','+y(v[s.key])).join(' ')}"/>`).join('');
    const ticks=Array.from({length:5},(_,k)=>{const i=Math.round(k*(r.n-1)/4),d=new Date(start+i*r.bucket);return `<text x="${x(i)}" y="232" text-anchor="middle">${esc(range==='24h'?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([],{month:'short',day:'numeric'}))}</text>`;}).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Recorded replies per time bucket">${grid}${lines}${ticks}</svg><div class="legend">${C.series.map(s=>`<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;
  }
  function quota(events){
    const now=C.now(),n=(keys,days)=>events.filter(e=>e.t>=now-days*C.DAY&&e.t<=now&&keys.includes(C.family(e.model))).length;
    const r=state.plan.raw;let lines=[];
    if(r==='pro')lines=[`GPT-6 Pro: ${n(['gpt6pro'],7)} recorded / last 7d · reference 200/week`,`GPT-5.6 Pro: ${n(['gpt56pro'],1)} recorded / last 24h · reference 170/day`,`Combined Pro: ${n(['gpt56pro','gpt6pro'],1)} recorded / last 24h · reference 200/day`];
    else if(r==='prolite')lines=[`Combined Pro: ${n(['gpt56pro','gpt6pro'],7)} recorded / last 7d · shared reference 50/week`];
    else if(state.plan.label.startsWith('Business')&&state.plan.seat==='premium')lines=[`Combined Pro: ${n(['gpt56pro','gpt6pro'],7)} recorded / last 7d · shared reference 50/week`];
    else if(state.plan.label.startsWith('Business')&&state.plan.seat==='standard')lines=[`Combined Pro: ${n(['gpt56pro','gpt6pro'],30)} recorded / last 30d · reference 15/month (30d is not a billing month)`];
    else lines=['Usage analytics only: no numeric cap assumed for this account/seat.'];
    lines.push('Exact remaining: UNKNOWN. These are saved replies, not the provider quota ledger.');
    lines.push(C.complete(state)?'Historical ranges indexed. Recent activity is current only to the last reconciliation.':'History coverage incomplete. Missing/deleted/temporary chats can affect totals.');
    lines.push('Limit references are the existing v1.6 presets, not a server-reported entitlement.');
    if(state.settings.resetLocal)lines.push('Manual weekly anchor (assumption only): '+state.settings.resetLocal+' · '+state.settings.resetTz);
    return lines.map(esc).join('<br>');
  }
  function health(){
    if(C.lastError)return 'Attention required';if(state.blocked)return 'Stopped · '+state.blocked;
    if(state.paused)return state.migrated&&!state.baseline.stages.length?'Saved history imported · coverage needs verification':'Paused by you';
    if(state.cooldownUntil>C.now())return 'Rate limited · retry in '+Math.ceil((state.cooldownUntil-C.now())/1000)+'s';
    if(state.worker&&state.worker.expiresAt>C.now())return 'Syncing · '+(state.worker.stage||'preparing');
    if(state.worker)return 'Worker heartbeat stale · waiting for safe handover';
    if(!state.baseline.startedAt)return 'History baseline not started';
    if(C.gaps(state).length)return 'Partial history · unresolved tasks';
    if(C.complete(state))return 'Healthy · 30d indexed · synced '+ago(state.watermark);
    return 'Baseline in progress · saved checkpoint';
  }
  function render(){
    if(!root?.isConnected)return;
    const events=Object.values(state.events),end=C.now(),start=end-ranges[range].ms,selected=events.filter(e=>e.t>=start&&e.t<=end),worker=state.worker,active=worker&&worker.expiresAt>C.now();
    q('[data-plan]').textContent=state.plan.label;
    q('[data-summary]').textContent=health();
    const gaps=C.gaps(state),issue=state.blocked||Object.keys(state.errors).sort().join(',')||(state.cooldownUntil>C.now()?'rate-limit':'');
    if(issue&&issue!==lastIssue)manualOpen=null;lastIssue=issue;
    const healthy=C.complete(state)&&!gaps.length&&!state.blocked&&!state.paused&&!C.lastError&&state.cooldownUntil<=C.now();
    q('[data-sync]').open=manualOpen===null?!healthy:manualOpen;
    q('[data-intro]').hidden=!!state.baseline.startedAt;
    q('[data-coverage]').innerHTML=['24h','7d','30d'].map(key=>{const j=state.baseline.stages.find(j=>j.key===key),n=C.counts(j);return `<div class="coverage"><b>${key==='24h'?'24 HOURS':key==='7d'?'7 DAYS':'30 DAYS'}</b><span>${!j?'Not started':j.status==='complete'?'Indexed to '+at(j.end):j.status==='partial'?'Partial · gaps remain':n.discovered?`${n.done+n.unchanged} / ${n.discovered} discovered chats checked`:'Queued / discovering'}</span><small>${j&&j.status!=='complete'?(n.discoveryDone?'Listing finished':'Listing not finished')+' · '+n.errors+' task errors':''}</small></div>`;}).join('');
    const jobs=C.jobs(state),pending=jobs.reduce((n,j)=>n+C.counts(j).pending,0),cool=state.cooldownUntil>C.now();
    const next=state.cooldownUntil||Math.min(...Object.values(state.errors).map(e=>e.nextRetryAt||Infinity),Infinity);
    q('[data-facts]').innerHTML=[
      ['Cache',`${Object.keys(state.conversations).length} conversations · ${events.length} replies · ${(new Blob([JSON.stringify(state)]).size/1024).toFixed(1)} KB`],
      ['Queue',`${gaps.length} actual task errors · ${cool?pending+' deferred by rate limit':pending+' pending'} (discovered tasks only)`],
      ['Worker',active?(worker.owner===C.owner?'This tab':'Another ChatGPT tab'):worker?'Stale owner; native lock must release before takeover':'Idle — no scanner running'],
      ['Worker heartbeat',worker?ago(worker.heartbeatAt)+(active?'':' · stale'):'Not needed while idle'],
      ['Local listener',state.settings.live?'Listening · page heartbeat '+ago(C.localHeartbeat):'Off'],
      ['Last live capture',ago(state.lastLive)],['Last checkpoint',at(state.lastCheckpoint)],['Last reconciliation',at(state.watermark)],
      ['Next attempt',state.paused?'Paused':state.blocked?'Needs attention':cool||Number.isFinite(next)&&next>C.now()?at(next):!C.complete(state)?'Resume when an active tab is available':state.settings.auto?'~'+at(state.watermark+state.settings.interval*60000):'Manual only'],
      ['Activity',active?worker.activity:C.lastError||state.liveNote||'Local heartbeat does not send server requests']
    ].map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
    const main=q('[data-action="main"]');main.textContent=!state.baseline.startedAt?'Build history baseline':state.paused?'Resume':!C.complete(state)?'Resume baseline':'Reconcile now';main.disabled=!!active||cool;
    q('[data-action="pause"]').disabled=state.paused||!state.baseline.startedAt;
    q('[data-action="retry"]').disabled=!Object.keys(state.errors).length||!!active||cool;
    q('[data-action="rebuild"]').disabled=!!active;
    q('[data-errors]').textContent=Object.values(state.errors).map(e=>`${e.stage} · ${e.source||'chat '+(e.conversationId||'').slice(0,8)} · ${e.code}${e.httpStatus?' / HTTP '+e.httpStatus:''}\nAttempts: ${e.attempts} · last: ${at(e.lastAttempt)} · next: ${at(e.nextRetryAt)}\n${e.message}`).join('\n\n')||'No outstanding fetch errors.';
    // Never overwrite an input being edited during the heartbeat render.
    for(const [field,id]of [['live','live'],['auto','auto'],['autoResume','resume'],['onOpen','onopen']])q('[data-setting="'+id+'"]').checked=state.settings[field];
    q('[data-cards]').innerHTML=C.series.map(s=>`<div class="card"><span><i style="background:${s.color}"></i>${s.name}</span><strong>${selected.filter(e=>C.family(e.model)===s.key).length}</strong></div>`).join('');
    q('[data-chart]').innerHTML=chart(events);q('[data-quota]').innerHTML=quota(events);
    shadow.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('on',b.dataset.range===range));
    const raw=new Map();for(const e of selected){const k=e.model+'\0'+e.effort,g=raw.get(k)||{model:e.model,effort:e.effort,n:0,last:0};g.n++;g.last=Math.max(g.last,e.t);raw.set(k,g);}
    q('tbody').innerHTML=[...raw.values()].sort((a,b)=>b.n-a.n).map(g=>`<tr><td>${esc(g.model)}</td><td>${esc(g.effort||'—')}</td><td>${g.n}</td><td>${at(g.last)}</td></tr>`).join('')||'<tr><td colspan="4">No recorded replies in this range.</td></tr>';
  }
  async function refresh(){if(!root?.isConnected||loading)return;loading=true;try{if(C.session)state=await C.read(C.session.scope);render();}catch(e){C.lastError=e.code+': '+e.message;render();}finally{loading=false;}}
  async function act(action){try{if(action==='main')action=!state.baseline.startedAt?'start':state.paused||!C.complete(state)?'resume':'reconcile';if(action==='rebuild'&&!confirm('Re-read 30 days of history? Saved events are retained, but coverage will be rebuilt.'))return;await C.control(action);}catch(e){C.lastError=e.code+': '+e.message;}await refresh();}
  const css=`:host{all:initial;font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#e8e9ea}*{box-sizing:border-box}main{background:#101113;border:1px solid #333;border-radius:17px;overflow:auto;max-height:calc(100dvh - 24px);box-shadow:0 22px 90px #0009}header{position:sticky;top:0;background:#101113;z-index:2;display:flex;justify-content:space-between;padding:17px 20px;border-bottom:1px solid #303236}header b{font-size:18px}header small{display:block;color:#83888e}header span{margin-right:12px;color:#aaa}button,input{font:inherit}button{background:#202226;color:#e7e8eb;border:1px solid #3b3e43;border-radius:9px;padding:8px 12px;cursor:pointer}button:disabled{opacity:.4;cursor:default}button.on,button.primary{background:#eeeeef;color:#111}article{padding:18px;display:grid;gap:15px}details,section,.card{border:1px solid #303338;border-radius:12px}summary{padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;gap:14px;align-items:center}summary span{font-size:12px;color:#a2a8b0}.syncbody{padding:0 16px 16px}.coveragegrid,#cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.coverage{border:1px solid #333;border-radius:9px;padding:10px}.coverage b,.coverage span,.coverage small{display:block}.coverage b{font-size:11px;color:#989da5}.coverage span{font-size:12px;margin:4px 0}.coverage small{color:#9b9fa5;font-size:10px}dl{display:grid;grid-template-columns:155px 1fr;gap:6px 12px;font-size:12px}dt{color:#9299a2}dd{margin:0;overflow-wrap:anywhere}.buttons,.legend,.ranges{display:flex;gap:9px;flex-wrap:wrap}.switches{margin-top:12px;display:grid;gap:6px;font-size:12px;color:#a6abb3}.switches label{display:flex;gap:8px;align-items:center}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;color:#b0b6bd}.card{padding:14px}.card span{display:flex;gap:8px;align-items:center;color:#939aa4;font-size:12px}i{display:inline-block;width:8px;height:8px;border-radius:50%}.card strong{display:block;font-size:30px;margin-top:4px}section{padding:14px}h3{margin:0 0 9px;font-size:14px}svg{width:100%;height:auto;display:block}svg text{fill:#89909a;font-size:10px}.legend{font-size:11px;color:#aeb3ba}.legend span{display:flex;gap:6px;align-items:center}p{color:#adb2ba;font-size:12px}table{color:#e8e9ea;border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:9px;border-bottom:1px solid #282a2f}th{color:#949ba5}td:first-child{font-family:ui-monospace,monospace}.table{overflow:auto;padding:0}[hidden]{display:none!important}input[type=datetime-local],input[type=text]{background:#222;color:#ddd;border:1px solid #555;border-radius:5px;padding:5px;max-width:100%}@media(max-width:600px){header{padding:12px}header span{font-size:11px}article{padding:10px}.coveragegrid{grid-template-columns:1fr}.card{padding:10px}.card strong{font-size:25px}summary{display:block}summary span{display:block}dl{grid-template-columns:110px 1fr}}`;
  function open(){
    if(root){root.remove();root=null;return;}
    range='24h';manualOpen=null;lastIssue='';root=document.createElement('div');root.id='chatcounter-v17';root.style.cssText='position:fixed;inset:12px 12px auto auto;max-width:960px;width:calc(100vw - 24px);z-index:2147483647';shadow=root.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>${css}</style><main><header><div><b>ChatGPT Message Meter</b><small>v1.7.0 · Universal · staged history</small></div><div><span data-plan>Checking account…</span><button data-close aria-label="Close">×</button></div></header><article>
    <details data-sync open><summary><b>SYNC & HISTORY</b><span data-summary>Reading local state…</span></summary><div class="syncbody">
    <p data-intro>Build a 24h baseline first, then extend to 7d and 30d. Opening this dashboard does not start a history scan.</p><div class="coveragegrid" data-coverage></div><dl data-facts></dl>
    <div class="buttons"><button class="primary" data-action="main">Build history baseline</button><button data-action="pause">Pause</button><button data-action="retry">Retry errors</button></div>
    <div class="switches"><label><input type="checkbox" data-setting="live">Capture live reply metadata</label><label><input type="checkbox" data-setting="auto">Reconcile other devices every ~30 min while a ChatGPT tab is active</label><label><input type="checkbox" data-setting="resume">Automatically resume a started baseline</label><label><input type="checkbox" data-setting="onopen">Reconcile when the Meter opens (off by default)</label></div>
    <details style="margin-top:12px"><summary>Diagnostics & maintenance</summary><div class="syncbody"><pre data-errors></pre><div class="buttons"><button data-diag>Copy diagnostics</button><button data-action="rebuild">Rebuild history</button></div><p>Heartbeat is local activity, not a request to ChatGPT. A stale heartbeat never overrides a native lock held by a living page.</p></div></details></div></details>
    <div class="ranges"><button data-range="24h">24 HOURS</button><button data-range="7d">7 DAYS</button><button data-range="30d">30 DAYS</button></div><div id="cards" data-cards></div>
    <section><h3>Usage trend · recorded replies</h3><div data-chart></div></section><section><h3>Plan-aware usage estimates</h3><p data-quota></p><details><summary>Manual reset assumption</summary><p><input data-reset type="datetime-local"> <input data-tz type="text" aria-label="Timezone" placeholder="Europe/London"> <button data-save-reset>Save</button></p></details></section>
    <section class="table"><table><thead><tr><th>Raw model slug</th><th>Effort</th><th>Selected range</th><th>Last used</th></tr></thead><tbody></tbody></table></section><div><button data-csv>Export metadata CSV</button></div></article></main>`;
    document.documentElement.append(root);
    q('[data-close]').onclick=()=>{root.remove();root=null;};
    q('[data-sync] summary').onclick=e=>{e.preventDefault();manualOpen=!q('[data-sync]').open;q('[data-sync]').open=manualOpen;};
    shadow.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>act(b.dataset.action));
    shadow.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{range=b.dataset.range;render();});
    const settingKeys={live:'live',auto:'auto',resume:'autoResume',onopen:'onOpen'};
    shadow.querySelectorAll('[data-setting]').forEach(input=>input.onchange=async()=>{const key=settingKeys[input.dataset.setting],v=input.checked;try{const who=await C.connect();await C.write(who.scope,s=>{s.settings[key]=v;});}catch(e){C.lastError=e.message;}await refresh();});
    q('[data-diag]').onclick=async()=>{const text=JSON.stringify({version:C.version,status:health(),nativeLocks:!!navigator.locks?.request,baseline:state.baseline.stages.map(j=>({key:j.key,status:j.status,...C.counts(j)})),worker:state.worker,lastCheckpoint:state.lastCheckpoint,cooldownUntil:state.cooldownUntil,errors:state.errors,lastError:C.lastError},null,2);try{await navigator.clipboard.writeText(text);}catch(_){q('[data-errors]').textContent=text;}};
    q('[data-save-reset]').onclick=async()=>{try{const value=q('[data-reset]').value,tz=q('[data-tz]').value;new Intl.DateTimeFormat('en',{timeZone:tz}).format();const who=await C.connect();await C.write(who.scope,s=>{s.settings.resetLocal=value;s.settings.resetTz=tz;});await refresh();}catch(e){alert('Reset/timezone: '+e.message);}};
    q('[data-csv]').onclick=()=>{const quote=x=>'"'+String(x??'').replace(/"/g,'""')+'"';const rows=[['message_id','timestamp','model','effort'],...Object.values(state.events).map(e=>[e.id,new Date(e.t).toISOString(),e.model,e.effort])];const url=URL.createObjectURL(new Blob([rows.map(r=>r.map(quote).join(',')).join('\n')],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='chatcounter-metadata.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    C.connect(true).then(async()=>{await refresh();if(!root)return;q('[data-reset]').value=state.settings.resetLocal;q('[data-tz]').value=state.settings.resetTz;if(state.settings.onOpen&&state.baseline.startedAt)act('reconcile');}).catch(()=>refresh());refresh();
  }
  C.listeners.add(refresh);
  function mount(){if(document.getElementById('chatcounter-launcher'))return;const b=document.createElement('button');b.id='chatcounter-launcher';b.textContent='Meter';b.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483646;background:#17191d;color:#eee;border:1px solid #444;border-radius:20px;padding:9px 14px;font:600 13px system-ui';b.onclick=open;document.documentElement.append(b);}
  if(document.documentElement)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
})();
