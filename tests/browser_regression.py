"""Offline Chromium integration tests. Real DOM; simulated Web Locks, ChatGPT and extension storage.
No real account, cookies, or server is used. Not an Orion/iPad device certification.
"""
import asyncio, copy, json, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
FILES=['bridge.js','core.js','i18n.js','limits.js','api.js','tasks.js','policy.js','sync.js','live.js','ui.js']
MOCK=r'''(() => {
 const listeners=[];
 if(!crypto.randomUUID)crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
 if(!crypto.subtle)Object.defineProperty(crypto,'subtle',{value:{digest:async(_,bytes)=>new Uint8Array(await __digest(Array.from(bytes))).buffer}});
 const local={
 get(keys,cb){__storage('get',keys).then(v=>setTimeout(()=>cb(v),1));},
 set(v,cb){__storage('set',v).then(()=>{setTimeout(()=>{cb();listeners.forEach(f=>f(Object.fromEntries(Object.keys(v).map(k=>[k,{}])),'local'));},1);});},
 remove(keys,cb){__storage('remove',keys).then(()=>cb());}
 };
 window.chrome={storage:{local,onChanged:{addListener:f=>listeners.push(f)}},runtime:{}};
 const pm=window.postMessage.bind(window);window.postMessage=(m,t)=>pm(m,t==='null'?'*':t);
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name,opts,cb)=>{
   const held=await __locks('acquire',name,!!opts.ifAvailable);if(!held)return cb(null);
   try{return await cb({name});}finally{await __locks('release',name,false);}
 }}});
 window.fetch=async(input,init)=>{const r=await __fetch(typeof input==='string'?input:input.url);return new Response(r.body,{status:r.status,headers:r.headers});};
})()'''
class Fixture:
 def __init__(self):
  self.storage={};self.calls=[];self.fail={};self.account='account-test';self.plan='pro';self.gate=None;self.drop_writes=False
  self.locks={};self.now=time.time();self.u=self.now-100;self.second=False;self.bad_list=False
 def msg(self,id,days,model='gpt-6-pro'):
  return {'id':id,'create_time':self.now-days*86400,'author':{'role':'assistant'},'recipient':'all','end_turn':True,'metadata':{'model_slug':model},'content':{'parts':['DO_NOT_STORE_BODY']}}
 async def route(self,route):
  u=urlparse(route.request.url);p=u.path;q=parse_qs(u.query)
  if p=='/':return await route.fulfill(status=200,content_type='text/html',body='<html><body>Offline fixture</body></html>')
  self.calls.append(p+(':'+q.get('before',[''])[0] if '/conversations/' in p else ''))
  if p=='/api/auth/session':data={'accessToken':'FAKE_TOKEN_NOT_PERSISTED','account':{'id':self.account,'plan_type':self.plan}}
  elif p=='/backend-api/conversations':
   data={'items':[]} if q.get('is_archived')==['true'] else {'items':[{'id':'chat-a','update_time':self.u}]+([{'id':'chat-b','update_time':self.u-1}] if self.second else [])}
   if self.bad_list:data={'new_unknown_shape':True}
  elif p=='/backend-api/gizmos/snorlax/sidebar':data={'items':[]}
  elif p.startswith('/backend-api/conversations/'):
   id=p.rsplit('/',1)[1]
   if self.gate:await self.gate.wait()
   if id in self.fail:return await route.fulfill(status=self.fail[id],content_type='application/json',headers={'Retry-After':'60'},body='{"error":"fixture"}')
   before=q.get('before',[''])[0]
   if id=='chat-b':data={'messages':[self.msg('b1',.2,'gpt-5-6-thinking')],'page_info':{'has_previous_page':False}}
   elif before=='older':data={'messages':[self.msg('a3',9),self.msg('a4',40)],'page_info':{'has_previous_page':False}}
   else:data={'messages':[self.msg('a1',.01,'gpt-5-6-thinking'),self.msg('a2',2)],'page_info':{'has_previous_page':True,'start_cursor':'older'}}
  elif p=='/backend-api/conversation':return await route.fulfill(status=200,content_type='text/event-stream',body='data: '+json.dumps({'conversation_id':'live-chat','message':self.msg('live1',0)})+'\n\ndata: [DONE]\n\n')
  else:return await route.fulfill(status=404,body='fixture path not found')
  return await route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
 async def store(self,op,v):
  if op=='get':return copy.deepcopy({k:self.storage[k] for k in v if k in self.storage})
  if op=='set':
   if not self.drop_writes:self.storage.update(copy.deepcopy(v))
   return True
  if op=='remove':
   for k in v:self.storage.pop(k,None)
   return True
 def histories(self):return [c for c in self.calls if c.startswith('/backend-api/')]
 def details(self):return [c for c in self.calls if c.startswith('/backend-api/conversations/')]
 async def ctx(self,browser):
  ctx=await browser.new_context(viewport={'width':1200,'height':1600})
  await ctx.route('**/*',lambda route: route.abort())
  await ctx.expose_binding('__storage',lambda _,op,v:self.store(op,v))
  import hashlib
  await ctx.expose_binding('__digest',lambda _,v:list(hashlib.sha256(bytes(v)).digest()))
  async def fetch(_,url):
   from types import SimpleNamespace
   class R:
    request=SimpleNamespace(url=url)
    async def fulfill(self,status=200,content_type='text/plain',headers=None,body=''):
     return {'status':status,'headers':{'Content-Type':content_type,**(headers or {})},'body':body}
   return await self.route(R())
  await ctx.expose_binding('__fetch',fetch)
  async def locks(source,op,name,available):
   owner=id(source['page'])
   if op=='acquire':
    if available and name in self.locks:return False
    while name in self.locks:await asyncio.sleep(.001)
    self.locks[name]=owner;return True
   if self.locks.get(name)==owner:self.locks.pop(name,None)
   return True
  await ctx.expose_binding('__locks',locks)
  def register(p):
   def clear():
    for name,owner in list(self.locks.items()):
     if owner==id(p):self.locks.pop(name,None)
   p.on('close',clear)
  ctx.on('page',register)
  return ctx
async def page(ctx,promise=False):
 p=await ctx.new_page();await p.set_content('<html><body>Offline fixture</body></html>');await p.evaluate(MOCK)
 if promise:await p.evaluate("delete window.chrome; window.browser={storage:{local:{get:k=>__storage('get',k),set:v=>__storage('set',v),remove:k=>__storage('remove',k)}}}")
 for f in FILES:
  js=(ROOT/f).read_text()
  if f=='live.js':js=js.replace('new URL(raw,location.href)','new URL(raw,"https://fixture.invalid/")').replace("u.origin===location.origin&&","true&&")
  await p.add_script_tag(content=js)
 await p.wait_for_function('!!window.ChatCounter?.session')
 await p.evaluate('window.__advance=0;ChatCounter.now=()=>Date.now()+__advance;ChatCounter.sleep=async ms=>{__advance+=ms};')
 return p
async def finish_baseline(p):
 for _ in range(20):
  s=await state(p)
  if all(j['status']=='complete' for j in s['baseline']['stages']) and len(s['baseline']['stages'])==3:return s
  await p.evaluate('''async()=>{const s=await ChatCounter.read(ChatCounter.session.scope);__advance+=Math.max(0,ChatCounter.softUntil(s)-ChatCounter.now()+1)}''')
  await action(p,'resume')
 raise AssertionError('baseline did not finish: '+str(await state(p)))
async def state(p):return await p.evaluate('ChatCounter.read(ChatCounter.session.scope)')
async def action(p,a):return await p.evaluate('(a)=>ChatCounter.control(a)',a)
async def open_ui(p):
 await p.locator('#chatcounter-launcher').click();await p.wait_for_function("document.querySelector('#chatcounter-v185')?.shadowRoot.querySelector('[data-plan]')?.textContent==='Pro 20x'");await p.wait_for_timeout(100)
async def text(p,sel):return await p.locator('#chatcounter-v185').locator(sel).inner_text()
async def main():
 checks=[]
 def ok(t):checks.append(t);print('PASS',t,flush=True)
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  f=Fixture();ctx=await f.ctx(browser);p=await page(ctx);errs=[];p.on('pageerror',lambda e:errs.append(str(e)))
  await open_ui(p)
  panel=p.locator('#chatcounter-v185')
  assert not f.histories();assert await panel.locator('[data-landing]').is_visible();assert not await panel.locator('[data-dashboard]').is_visible()
  assert not (await state(p))['settings']['live'] and (await state(p))['settings']['auto'] and (await state(p))['settings']['interval']==15
  ok('First open: landing screen only, no history request, live capture off and 15-minute backend reconciliation default')
  await panel.locator('[data-start-indexing]').click();await p.wait_for_timeout(100)
  assert await panel.locator('[data-dashboard]').is_visible();assert await panel.locator('[data-range="24h"]').get_attribute('class')=='on'
  assert await panel.locator('[data-sync]').get_attribute('open') is not None
  s=await finish_baseline(p)
  assert [x['status'] for x in s['baseline']['stages']]==['complete']*3,s
  assert len(s['events'])==4,s['events']
  assert f.details().count('/backend-api/conversations/chat-a:older')==1,f.details()
  assert 'FAKE_TOKEN' not in json.dumps(f.storage) and 'DO_NOT_STORE_BODY' not in json.dumps(f.storage)
  ok('24h → 7d → 30d stages finish; widening coverage reads older pages beyond cached IDs')
  await p.evaluate('ChatCounter.emit()');await p.wait_for_timeout(150)
  assert await p.locator('[data-sync]').get_attribute('open') is None
  await p.screenshot(path=str(ROOT/'tests/dashboard-healthy.png'),full_page=True)
  ok('Healthy completed baseline collapses automatically; chart and cache remain visible')
  before=len(f.histories());await p.locator('[data-close]').click();await open_ui(p);assert len(f.histories())==before
  p2=await page(ctx);await open_ui(p2);assert len((await state(p2))['events'])==4;assert not await p2.locator('#chatcounter-v185').locator('[data-landing]').is_visible();assert len(f.histories())==before
  ok('Panel reopen and new tab share saved baseline status without starting a scan')
  before=len(f.details());await action(p,'reconcile');assert len(f.details())==before,f.details()
  ok('Unchanged conversations: headers reconciled; zero extra message-detail fetches')
  # Dedupe, optional live event merge, and settings persistence.
  await p.evaluate("ChatCounter.write(ChatCounter.session.scope,s=>{s.settings.live=true})")
  await p.evaluate("fetch('/backend-api/conversation',{method:'POST',body:'{}'})")
  await p.wait_for_function("async()=>!!(await ChatCounter.read(ChatCounter.session.scope)).events.live1")
  await p.evaluate("fetch('/backend-api/conversation',{method:'POST',body:'{}'})")
  await p.wait_for_timeout(200);assert len((await state(p))['events'])==5
  ok('Optional passive live capture persists metadata and deduplicates the same message ID')
  # One actual 429; remaining queued work is never called or counted as failed.
  f.second=True;f.u=f.now+10000;f.fail['chat-a']=429;f.calls.clear();await action(p,'reconcile');s=await state(p)
  assert len(s['errors'])==1,s['errors'];assert s['cooldownUntil']>time.time()*1000
  assert not any('/chat-b:' in c for c in f.details());assert s['recent']['tasks']['chat-b']['status']=='pending'
  before=len(f.histories());await action(p,'retry');assert len(f.histories())==before
  await p.evaluate('ChatCounter.emit()');await p.wait_for_timeout(150)
  assert await p.locator('[data-sync]').get_attribute('open') is not None
  await p.screenshot(path=str(ROOT/'tests/dashboard-rate-limited.png'),full_page=True)
  ok('429: one actual error, unrequested tasks remain pending/deferred, shared Retry-After cannot be bypassed')
  f.fail.clear();await p.evaluate('__advance+=61000');await action(p,'retry');s=await state(p)
  assert not s['errors'];assert s['recent']['status']=='complete'
  ok('After cooldown: resumes saved failed/pending tasks without deleting prior records')
  await action(p,'pause');before=len(f.histories());await p.evaluate('ChatCounter.tick()');assert len(f.histories())==before
  ok('Explicit Pause persists across scheduler ticks; no automatic restart')
  assert not errs,errs
  await ctx.close()
  # In-flight cross-tab handover simulates browser Web Locks.
  f=Fixture();f.gate=asyncio.Event();ctx=await f.ctx(browser);p=await page(ctx)
  await p.evaluate("void ChatCounter.control('start')")
  await p.wait_for_function("async()=>((await ChatCounter.read(ChatCounter.session.scope)).worker?.activity==='Reading reply metadata')")
  p2=await page(ctx);await open_ui(p2)
  assert 'Another ChatGPT tab' in await text(p2,'[data-facts]')
  await p.wait_for_timeout(200)
  n=len(f.histories());r=await action(p2,'resume');assert r=={'busy':True},r;assert len(f.histories())==n
  ok('Second tab sees shared in-progress state and cannot obtain the active native scan lock')
  r=await p2.evaluate("ChatCounter.control('rebuild').catch(e=>e.code)");assert r=='SYNC_ACTIVE';assert len(f.histories())==n
  ok('Rebuild in a second tab cannot reset jobs while another scanner owns the lock')
  await p.close();f.gate.set();await p2.bring_to_front();await p2.evaluate('__advance+=60000;ChatCounter.tick()')
  s=await finish_baseline(p2);assert all(j['status']=='complete' for j in s['baseline']['stages']),s
  ok('Closing worker tab releases native lock; another active tab resumes durable jobs')
  await ctx.close()
  # Schema errors preserve partial evidence and stop further work.
  f=Fixture();f.bad_list=True;ctx=await f.ctx(browser);p=await page(ctx);await action(p,'start');s=await state(p)
  assert s['blocked']=='LIST_SCHEMA' and not s['watermark'] and len(f.histories())==1
  ok('Unknown list response blocks baseline instead of treating it as empty/complete')
  await ctx.close()
  # Storage failure at preflight makes zero history requests.
  f=Fixture();ctx=await f.ctx(browser);p=await page(ctx);f.drop_writes=True;await action(p,'start')
  assert not f.histories();ok('Failed/ignored persistence cannot start an unverified history scan')
  await ctx.close()
  # Promise-only storage path.
  f=Fixture();ctx=await f.ctx(browser);p=await page(ctx,promise=True);await action(p,'start');await finish_baseline(p);assert len((await state(p))['events'])==4
  ok('Promise-only WebExtension storage supports the same build as callback-only storage')
  await ctx.close()
  # v1.6 migration does not pretend old records prove full-range coverage.
  import hashlib
  f=Fixture();old=hashlib.sha256(b'account-test').hexdigest()[:16]
  f.storage['cmm_v14_cache_'+old]={'schema':2,'initialBuildAt':0,'conversations':{'old-chat':{'u':f.u*1000,'events':[{'id':'old1','t':f.u*1000,'model':'gpt-6-pro','effort':''}]}}}
  ctx=await f.ctx(browser);p=await page(ctx);await open_ui(p);s=await state(p)
  assert len(s['events'])==1 and s['paused'] and s['baseline']['startedAt']
  assert 'Resume' in await text(p,'[data-action="main"]') and not f.histories()
  ok('Partial v1.6 cache migrates as saved data awaiting Resume, never as a fresh empty baseline')

  # Structured error policy and atomic multi-tab writes.
  f=Fixture();ctx=await f.ctx(browser);p=await page(ctx);p2=await page(ctx)
  result=await p.evaluate('''()=>{
   const C=ChatCounter,s=C.fresh(),j=C.job('24h',C.now()-C.DAY,C.now()),t={id:'x',attempts:0,status:'pending'};
   C.recordError(s,j,t,'chat',C.error('SERVER_ERROR','HTTP 503',{status:503}));
   const retry=t.status==='error'&&t.nextAt>C.now()&&!s.blocked;
   t.attempts=0;C.recordError(s,j,t,'chat',C.error('NOT_FOUND','HTTP 404',{status:404}));
   C.recordError(s,j,t,'chat',C.error('NOT_FOUND','HTTP 404',{status:404}));
   return {retry,unavailable:t.status==='unavailable'};
  }''')
  assert result=={'retry':True,'unavailable':True}
  ok('503 is retryable; repeated 404 is unavailable and remains an explicit coverage gap')
  await asyncio.gather(p.evaluate('Promise.all(Array.from({length:10},()=>ChatCounter.write(ChatCounter.session.scope,s=>{s.testCounter=(s.testCounter||0)+1})))'),p2.evaluate('Promise.all(Array.from({length:10},()=>ChatCounter.write(ChatCounter.session.scope,s=>{s.testCounter=(s.testCounter||0)+1})))'))
  assert (await state(p))['testCounter']==20
  ok('Concurrent writes from two tabs are serialized without lost updates')
  old_scope=await p.evaluate('ChatCounter.session.scope');f.account='different-account';f.plan='plus';await p.evaluate('ChatCounter.connect(true)');s=await state(p)
  assert await p.evaluate('ChatCounter.session.scope')!=old_scope and not s['events'] and s['plan']['raw']=='plus'
  ok('Account switch selects an isolated cache and updates detected plan rather than assuming Pro')
  await ctx.close();await browser.close()

 report={'version':json.loads((ROOT/'manifest.json').read_text())['version'],'passed':len(checks),'environment':'Chromium / mocked extension storage + ChatGPT HTTP; simulated Web Locks','orion_device_test':False,'checks':checks}
 (ROOT/'tests/RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
if __name__=='__main__':asyncio.run(main())
