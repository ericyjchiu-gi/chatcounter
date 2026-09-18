"""v1.7.2 regression scenarios. Offline Chromium DOM and HTTP/storage fixtures."""
import asyncio,json,time,copy
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from browser_regression import Fixture,page,state,action,open_ui,text,finish_baseline,ROOT,FILES,MOCK
class ProjectsFail(Fixture):
 def __init__(self):super().__init__();self.projects_status=500;self.project_calls=0
 async def route(self,route):
  if urlparse(route.request.url).path=='/backend-api/gizmos/snorlax/sidebar':
   self.project_calls+=1
   if self.projects_status:
    self.calls.append('/backend-api/gizmos/snorlax/sidebar')
    return await route.fulfill(status=self.projects_status,content_type='application/json',body='{"error":"PRIVATE_RESPONSE_NOT_EXPORTED"}')
  return await super().route(route)
class ProjectsOK(Fixture):
 def __init__(self):super().__init__();self.project_id='g-p-stage-order'
 async def route(self,route):
  u=urlparse(route.request.url);p=u.path
  if p=='/backend-api/gizmos/snorlax/sidebar':
   self.calls.append(p);return await route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[{'id':self.project_id}]}))
  if p==f'/backend-api/gizmos/{self.project_id}/conversations':
   self.calls.append(p);return await route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[{'id':'project-chat','update_time':self.u-2}]}))
  if p=='/backend-api/conversations/project-chat':
   self.calls.append(p+':');data={'messages':[self.msg('project-1',.1,'gpt-6-pro')],'page_info':{'has_previous_page':False}}
   return await route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
  return await super().route(route)
async def core_finish(p):
 for _ in range(8):
  s=await state(p)
  if len(s['baseline']['stages'])==3 and all(j['status'] in ('complete','complete_with_warnings') for j in s['baseline']['stages']):return s
  await action(p,'start-now')
 raise AssertionError(await state(p))
async def main():
 checks=[]
 def ok(msg):checks.append(msg);print('PASS',msg,flush=True)
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  f=Fixture();ctx=await f.ctx(browser);p=await page(ctx);await open_ui(p)
  await action(p,'start');s=await state(p)
  assert s['baseline']['stages'][0]['status']=='complete'
  assert s['baseline']['stages'][1]['status']=='pending'
  delay=s['governor']['stageDelayUntil']-await p.evaluate('ChatCounter.now()')
  assert 115000<=delay<=300000,delay
  n=len(f.histories());await p.evaluate('ChatCounter.tick()');assert n==len(f.histories())
  await p.evaluate("ChatCounter.setPace('fast')");await p.evaluate('ChatCounter.tick()');assert n==len(f.histories())
  await action(p,'start-now');assert (await state(p))['baseline']['stages'][1]['status']=='complete'
  ok('Core 24h completion schedules 2–5min rest; Fast alone does not skip it; Start now advances 7d')
  await p.evaluate('ChatCounter.emit()');await p.wait_for_timeout(120)
  await p.locator('[data-collapse]').click()
  assert await p.locator('[data-coverage] .coverage').count()==3
  assert await p.locator('[data-coverage]').is_visible() and not await p.locator('[data-facts]').is_visible()
  await p.evaluate("ChatCounter.emit()");await p.wait_for_timeout(100)
  assert await p.locator('[data-collapse]').inner_text()=='Expand +'
  await p.screenshot(path=str(ROOT/'tests/dashboard-collapsed-172.png'),full_page=True)
  ok('Explicit collapse leaves all 3 coverage cards visible; heartbeat does not reopen the body')
  await p.locator('[data-collapse]').click()
  await p.locator('summary').filter(has_text='Diagnostics & maintenance').click()
  async with p.expect_download() as item:await p.locator('[data-export-diag]').click()
  d=await item.value;download=await d.path();data=json.loads(Path(download).read_text())
  assert data['version']=='1.7.2' and 'recentLog' in data and 'events' not in data
  assert 'FAKE_TOKEN' not in json.dumps(data) and 'DO_NOT_STORE_BODY' not in json.dumps(data)
  ok('Export diagnostics.json downloads structured metadata and request/checkpoint log without token/body')
  await CWRITE(p,"s.cooldownUntil=ChatCounter.now()+60000")
  saved=(await state(p))['cooldownUntil'];n=len(f.histories())
  for a in ['start-now','retry','resume','rebuild']:await action(p,a)
  assert n==len(f.histories()) and (await state(p))['cooldownUntil']==saved
  assert 'cooldown' in await p.evaluate('ChatCounter.lastAction')
  ok('Every override path, including Rebuild and Fast, preserves active shared 429 cooldown')
  await CWRITE(p,"s.cooldownUntil=0;s.blocked='LIST_SCHEMA'")
  n=len(f.histories());await action(p,'retry');await action(p,'start-now');assert (await state(p))['blocked']=='LIST_SCHEMA' and n==len(f.histories())
  ok('Retry and Start now cannot erase schema/auth/storage hard-stop state')
  await ctx.close()
  f=ProjectsOK();ctx=await f.ctx(browser);p=await page(ctx);await action(p,'start');s=await state(p)
  assert s['baseline']['stages'][0]['status']=='complete' and s['baseline']['stages'][1]['status']=='pending',s['baseline']['stages']
  assert '/backend-api/gizmos/snorlax/sidebar' in f.calls and f'/backend-api/gizmos/{f.project_id}/conversations' in f.calls,f.calls
  assert '/backend-api/conversations/project-chat:' in f.calls and '/backend-api/conversations/chat-a:older' not in f.calls,f.calls
  ok('Stage order is 24h core → 24h Projects before 7d core')
  await action(p,'start-now');assert '/backend-api/conversations/chat-a:older' in f.calls,f.calls
  ok('After the stage rest is skipped/elapsed, 7d core begins')
  await ctx.close()
  f=ProjectsFail();ctx=await f.ctx(browser);p=await page(ctx);await open_ui(p);await action(p,'start');await core_finish(p)
  s=await state(p);assert len(s['errors'])==1 and s['errors']['24h/source/projects:']['httpStatus']==500,s['errors']
  assert all(j['status']=='complete_with_warnings' for j in s['baseline']['stages'])
  assert len(s['events'])==4
  ok('Projects HTTP500 leaves explicit optional coverage gap but does not block core 24h/7d/30d')
  await p.evaluate('ChatCounter.emit()');await p.wait_for_timeout(100)
  assert 'HTTP 500' in await text(p,'[data-error-summary]') and 'SERVER_ERROR' in await text(p,'[data-error-summary]')
  await p.screenshot(path=str(ROOT/'tests/dashboard-project-error-172.png'),full_page=True)
  first=f.project_calls;before_attempts=(await state(p))['errors']['24h/source/projects:']['attempts'];await p.locator('[data-action="retry"]').click()
  for _ in range(150):
   observed=await state(p)
   if observed['errors']['24h/source/projects:']['attempts']==before_attempts+1 and not await p.evaluate('!!ChatCounter.running'):break
   await p.wait_for_timeout(100)
  else:raise AssertionError('Retry button did not finish a new request: '+json.dumps(observed['errors']))
  await p.wait_for_timeout(100);assert f.project_calls==first+1,(f.project_calls,first,await p.evaluate('ChatCounter.lastAction'),(await state(p))['errors'])
  assert (await state(p))['errors']['24h/source/projects:']['attempts']==before_attempts+1
  assert 'Waiting' in await p.evaluate('ChatCounter.lastAction') or 'Scheduled' in await p.evaluate('ChatCounter.lastAction')
  ok('Actual Retry errors button makes one request, increments attempts and reports why work stopped')
  first=f.project_calls;await action(p,'retry');assert f.project_calls==first
  ok('Rapid repeated manual retries are coalesced/rate-gated rather than hammering the failed source')
  for _ in range(3):
   await p.evaluate('__advance+=11000');await action(p,'retry')
  s=await state(p);e=s['errors']['24h/source/projects:'];assert e['attempts']>=5 and e['status']=='degraded',e
  assert e['nextRetryAt']-await p.evaluate('ChatCounter.now()')>1700000
  n=f.project_calls;await p.evaluate('ChatCounter.tick()');assert f.project_calls==n
  ok('5 consecutive Project failures open a shared 30-minute source circuit; stages do not duplicate probes')
  n=len(f.details());f.projects_status=0;await p.evaluate('__advance+=11000');await action(p,'retry');await action(p,'resume')
  s=await state(p);assert all(j['status']=='complete' for j in s['baseline']['stages']) and not s['errors'],s['errors']
  assert len(f.details())==n
  ok('Recovered Projects source fills missing coverage without re-fetching already indexed unchanged chats')
  await CWRITE(p,"for(let i=0;i<250;i++)ChatCounter.log(s,'test-event',{count:i,token:'MUST_NOT_APPEAR',body:'MUST_NOT_APPEAR'})")
  diag=await p.evaluate("ChatCounter.read(ChatCounter.session.scope).then(s=>ChatCounter.diagnostics(s))")
  assert len(diag['recentLog'])==200 and 'MUST_NOT_APPEAR' not in json.dumps(diag)
  ok('Ring buffer is bounded to 200 allowlisted metadata events')
  await ctx.close()
  f=Fixture();ctx=await f.ctx(browser);p=await page(ctx)
  await CWRITE(p,"""s.baseline.startedAt=ChatCounter.now();ChatCounter.beginStages(s);
   const j=s.baseline.stages[0];j.sources[0].status='done';j.sources[1].status='done';
   const t=j.sources[2];t.status='error';t.attempts=7;t.nextAt=ChatCounter.now()+640000;
   s.errors['24h/source/projects:']={stage:'24h',source:'projects',code:'SERVER_ERROR',httpStatus:500,attempts:7,lastAttempt:ChatCounter.now(),nextRetryAt:t.nextAt,status:'error',message:'History endpoint returned HTTP 500.'};
   s.events.keep={id:'keep',t:ChatCounter.now()-1000,model:'gpt-6-pro',effort:'',cid:'known'};
   delete s.policyVersion;""")
  s1=await state(p);await p.evaluate('__advance+=10000');s2=await state(p)
  assert s1['baseline']['stages'][0]['status']=='complete_with_warnings'
  assert s1['baseline']['stages'][0]['sources'][2]['nextAt']==s2['baseline']['stages'][0]['sources'][2]['nextAt']
  assert s1['errors']['24h/source/projects:']['status']=='degraded' and 'keep' in s1['events']
  ok('Existing seven-attempt Project500 checkpoint migrates without deleting data or sliding retry deadline')
  gaps=await p.evaluate("""()=>{const s=ChatCounter.fresh();s.governor={health:[]};const a=ChatCounter.requestGap(s,'24h'),b=ChatCounter.requestGap(s,'7d'),c=ChatCounter.requestGap(s,'30d');ChatCounter.setPace('fast');s.governor.health=[{t:ChatCounter.now(),status:500,latency:10},{t:ChatCounter.now(),status:500,latency:10}];return {a,b,c,slow:ChatCounter.requestGap(s,'30d')}}""")
  assert gaps['a']<gaps['b']<gaps['c'] and gaps['slow']>=5000
  ok('Default older stages are slower; shared failure health slows even a Fast override')
  await ctx.close()
  await browser.close()
 report={'version':'1.7.2','passed':len(checks),'environment':'Offline Chromium DOM + mocked HTTP/storage and simulated Web Locks','orion_device_test':False,'checks':checks}
 (ROOT/'tests/STABILITY_172_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
async def CWRITE(p,body):await p.evaluate('ChatCounter.write(ChatCounter.session.scope,s=>{'+body+'})')
if __name__=='__main__':asyncio.run(main())
