"""Production worker + renderer integration with simulated extension APIs/HTTP.
No logged-in account is used. Native extension install is blocked by host policy.
"""
import asyncio,json,base64,hashlib,tempfile,time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
CHECKS=[]
class Driver:
 async def start(self):
  self.p=await asyncio.create_subprocess_exec('node',str(ROOT/'tests/worker_driver.cjs'),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
  self.lock=asyncio.Lock();self.n=0
  return self
 async def query(self,code):
  async with self.lock:
   self.n+=1;self.p.stdin.write((json.dumps({'id':self.n,'code':code})+'\n').encode());await self.p.stdin.drain()
   line=await asyncio.wait_for(self.p.stdout.readline(),15)
   if not line:raise RuntimeError((await self.p.stderr.read()).decode())
   value=json.loads(line)
   if 'error' in value:raise RuntimeError(value['error'])
   return value.get('value')
 async def msg(self,op,**args):return await self.query('__message('+json.dumps({'channel':'CMM_APP_201','op':op,**args})+')')
 async def end(self):
  self.p.terminate();await self.p.wait()
 async def idle(self):
  for _ in range(300):
   if not await self.query('Boolean(ChatCounter.running)'):return
   await asyncio.sleep(.025)
  raise AssertionError('Worker did not finish bounded fixture slice.')

def ok(name,condition=True):
 assert condition,name
 CHECKS.append(name);print('PASS',name,flush=True)
SEED="""(async()=>{
const C=ChatCounter,scope=await C.hash(JSON.stringify(['account-test','user-test']));
const s=C.normalize(C.fresh());C.beginStages(s);
for(const j of s.baseline.stages){for(const src of j.sources)src.status='done';j.status='complete';j.startedAt=C.now();j.completedAt=C.now();}
s.settings.auto=false;s.settings.autoResume=false;s.watermark=C.now();s.plan={raw:'pro',label:'Pro 20x',seat:'',source:'fixture'};
for(let i=0;i<59;i++)C.merge(s,{id:'pro-'+i,t:C.now()-(i<5?10000:2*C.DAY),model:'gpt-6-pro',effort:''},'a');
C.merge(s,{id:'sol-1',t:C.now()-10000,model:'gpt-5-6-pro',effort:''},'b');
for(let i=0;i<77;i++)C.merge(s,{id:'normal-'+i,t:C.now()-10000-i*100000,model:'gpt-5-6-thinking',effort:'standard'},'c');
s.conversations={a:{u:C.now()-1000,from:C.now()-90*C.DAY,to:C.now(),complete:true},b:{u:C.now()-1000,from:C.now()-90*C.DAY,to:C.now(),complete:true}};
await chrome.storage.local.set({[C.key(scope)]:s,cmm_v17_selected_scope:scope,cmm_v17_runtime_201:{code:'',message:''}});return scope;
})()"""
async def seed(d):return await d.query(SEED)
async def backend_tests(d):
 manifest=json.loads((ROOT/'manifest.json').read_text())
 ok('Manifest configures a real action popup and packages its HTML',manifest['action'].get('default_popup')=='popup.html' and (ROOT/'popup.html').is_file())
 ok('UI/storage clients explicitly run in ISOLATED; only passive capture runs MAIN',manifest['content_scripts'][0]['world']=='ISOLATED' and manifest['content_scripts'][1]['js']==['src/content/live.js'])
 key=base64.b64decode(manifest['key']);eid=''.join(chr(97+int(c,16)) for c in hashlib.sha256(key).hexdigest()[:32])
 ok('Shipped extension ID unchanged',eid=='ffnaboibekmfpegifameabebgpjpdpnn')
 snap=await d.msg('snapshot');ok('Fresh popup snapshot is available without auth or ChatGPT tabs',snap['ok'] and snap['value']['scope'] is None)
 ok('Opening a fresh popup makes zero session/history requests',len(await d.query('__fixture.requests'))==0)
 scope=await seed(d)
 snap=await d.msg('snapshot');ok('Existing complete index and all 137 reply records are retained',len(snap['value']['state']['events'])==137)
 await d.query('CMM201.refreshIcon()');badge=await d.query('__badges.setBadgeText.text')
 ok('Native high-contrast badge displays 30% for 59 / 200',badge=='30%')
 ok('Popup snapshot is read-only, not another baseline',len(await d.query('__fixture.requests'))==0)
 gates=await d.query("(async()=>{const {state:s}=await CMM201.indexes(),a=structuredClone(s);a.baseline.stages[2].status='running';const incomplete=CMM201.badgeEstimate(a);a.baseline.stages[2].status='complete';a.plan.raw='plus';const plus=CMM201.badgeEstimate(a);a.plan={raw:'enterprise',label:'Enterprise'};return {incomplete,plus,enterprise:CMM201.badgeEstimate(a)};})()")
 ok('No numeric badge for incomplete, Plus or unknown Enterprise allowances',all(v is None for v in gates.values()))
 high=await d.query("(async()=>{const {state:s}=await CMM201.indexes();for(let i=0;i<160;i++)ChatCounter.merge(s,{id:'day-'+i,t:Date.now()-1000,model:'gpt-5-6-pro',effort:''},'x');return CMM201.badgeEstimate(s);})()")
 ok('Higher applicable daily utilisation wins over weekly utilisation',high['card']['key']=='gpt56pro' and high['percent']==95)
 shared=await d.query("(async()=>{const {state:s}=await CMM201.indexes();s.plan={raw:'prolite',label:'Pro 5x'};return CMM201.badgeEstimate(s);})()")
 ok('Shared plans use combined pool, never independent duplicated caps',shared['card']['key']=='total' and shared['percent']==100)
 before=await d.query('JSON.stringify(__store)');await d.msg('prefs');await d.msg('snapshot');after=await d.query('JSON.stringify(__store)')
 ok('Read operations do not mutate persisted index',before==after)
 await d.query("__fixture.auth=false;ChatCounter.session=null")
 r=await d.msg('command',action='reconcile',scope=scope);await d.idle();await asyncio.sleep(.08)
 snap=await d.msg('snapshot')
 ok('Signed-out refresh reports AUTH_REQUIRED while retaining cached data',snap['value']['runtime']['code']=='AUTH_REQUIRED' and len(snap['value']['state']['events'])==137)
 await d.query("__fixture.auth=true;__fixture.account='different';ChatCounter.session=null")
 await d.msg('command',action='reconcile',scope=scope);await d.idle();await asyncio.sleep(.08)
 snap=await d.msg('snapshot')
 ok('Account mismatch cannot overwrite or reattribute a cached index',snap['value']['runtime']['code']=='ACCOUNT_CHANGED' and len(snap['value']['state']['events'])==137)
 await d.query("__fixture.account='account-test';__fixture.auth=true;ChatCounter.session=null")
 await seed(d)
 # Test cooldown across UI commands and views; no history/auth request is sent.
 await d.query("(async()=>{const {scope}=await CMM201.indexes();await ChatCounter.write(scope,s=>s.cooldownUntil=Date.now()+60000)})()")
 before=len(await d.query('__fixture.requests'));r=await d.msg('command',action='reconcile',scope=scope)
 ok('Manual refresh cannot bypass shared server Retry-After',r['value']['outcome']=='waiting' and len(await d.query('__fixture.requests'))==before)
 await seed(d)
 recovery=await d.query("(()=>{const s=ChatCounter.normalize(ChatCounter.fresh());s.governor.recoveryUntil=Date.now()+300000;return ChatCounter.requestGap(s,'recent');})()")
 ok('Existing recovery request spacing remains at least 45 seconds',recovery>=45000)
 # Fresh start with mocked fast gaps. Production governor is restored afterwards.
 await d.query("__clear();ChatCounter.session=null;ChatCounter.expectedScope=null;globalThis.__savedGap=ChatCounter.requestGap;ChatCounter.requestGap=()=>0")
 r=await d.msg('command',action='start');ok('Start acknowledges promptly instead of tying work to popup lifetime',r['value']['outcome']=='accepted')
 await d.idle();await asyncio.sleep(.1)
 for _ in range(6):
  sn=(await d.msg('snapshot'))['value']
  if all(j['status']=='complete' for j in sn['state']['baseline']['stages']):break
  await d.query("(async()=>{const {scope}=await CMM201.indexes();await ChatCounter.write(scope,s=>{s.governor.stageDelayUntil=0;s.governor.softPauseUntil=0});await CMM201.kick()})()")
  await d.idle()
 sn=(await d.msg('snapshot'))['value']
 ok('Background engine completes regular/archived/project discovery across all three ranges',len(sn['state']['baseline']['stages'])==3 and all(j['status']=='complete' for j in sn['state']['baseline']['stages']))
 req=await d.query('__fixture.requests');details=[r for r in req if r['path'].startswith('/backend-api/conversations/')]
 ok('Wider ranges reuse proved conversation coverage instead of re-fetching unchanged details',len(details)==1)
 serial=await d.query('JSON.stringify(__store)');ok('Neither auth tokens nor response/chat bodies are persisted','FAKE_TOKEN_DO_NOT_STORE' not in serial and 'NEVER_PERSIST_CHAT_TEXT' not in serial)
 ok('All backend calls remain read-only',all(r['method']=='GET' for r in req))
 # Project scenario and 429 later tested separately; pause is local and auth-free.
 before=len(req);await d.msg('command',action='pause',scope=sn['scope'])
 paused=(await d.msg('snapshot'))['value']['state'];ok('Pause saves state and does not require authentication',paused['paused'] and len(await d.query('__fixture.requests'))==before)
 await d.query('ChatCounter.requestGap=__savedGap')
 await seed(d)
 # Do not run a new-origin scanner concurrently with an old tab's live lease.
 await d.query("(async()=>{const {scope}=await CMM201.indexes();await ChatCounter.write(scope,s=>s.worker={owner:'legacy-tab',expiresAt:Date.now()+40000});})()")
 blocked=await d.msg('command',action='reconcile',scope=scope)
 ok('Active pre-2.0.1 tab lease prevents concurrent migration scan',not blocked['ok'] and blocked['code']=='LEGACY_TAB_ACTIVE')
 await seed(d)
 # API fallback resolves per operation, not from a one-time storage flag.
 fallback=await d.query("(async()=>{const original=chrome.storage;globalThis.browser={runtime:{id:chrome.runtime.id},storage:{local:{get:async()=>({fallback:true})}}};chrome.storage=undefined;try{return await CMMNative.call('storage.local','get',[]);}finally{chrome.storage=original;delete globalThis.browser;}})()")
 ok('Promise-only browser.storage fallback works when chrome.storage is absent',fallback.get('fallback') is True)
 modern=await d.query("(async()=>{await CMMNative.call('alarms','create','signature-check',{when:Date.now()+60000});return __alarms.has('signature-check');})()")
 ok('Chrome alarms.create uses its two-argument Promise signature',modern)
 legacy=await d.query("(async()=>{const old=chrome.alarms.create;let called=false;chrome.alarms.create=function(n,v){if(arguments.length!==2)throw new Error('Extra callback');called=true;};try{await CMMNative.call('alarms','create','legacy',{when:Date.now()});return called;}finally{chrome.alarms.create=old;}})()")
 ok('Legacy synchronous alarms.create resolves without timing out',legacy)
 # A second cached account must not be selected just because its watermark is newer.
 ambiguous=await d.query("(async()=>{const {scope,state}=await CMM201.indexes();globalThis.__primary=scope;await chrome.storage.local.set({cmm_v17_state_0123456789abcdef:state});await chrome.storage.local.remove('cmm_v17_selected_scope');return CMM201.indexes();})()")
 ok('Multiple cached accounts require explicit selection',ambiguous['scope'] is None and len(ambiguous['accounts'])==2)
 await d.query("chrome.storage.local.remove('cmm_v17_state_0123456789abcdef')")
 await seed(d)
 # Exercise actual 429 conversion in the production acquisition loop.
 await d.query("__clear();__fixture.fail=429;ChatCounter.session=null;ChatCounter.expectedScope=null;globalThis.__gap201=ChatCounter.requestGap;ChatCounter.requestGap=()=>0")
 await d.msg('command',action='start');await d.idle();await asyncio.sleep(.08)
 limited=(await d.msg('snapshot'))['value'];ts=time.time()*1000
 ok('Actual 429 persists a shared cooldown and recovery deadline',limited['state']['cooldownUntil']>ts+45000 and limited['state']['governor']['recoveryUntil']>ts)
 n=len(await d.query('__fixture.requests'));await d.msg('command',action='start-now',scope=limited['scope']);await asyncio.sleep(.05)
 ok('Start-now cannot reissue requests during an actual server cooldown',len(await d.query('__fixture.requests'))==n)
 await d.query('__fixture.fail=0;ChatCounter.requestGap=__gap201')
 await seed(d)
 return scope

async def render_tests(d):
 async with async_playwright() as pw:
  chromium='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None
  browser=await pw.chromium.launch(executable_path=chromium,headless=True,args=['--no-sandbox','--disable-gpu'])
  ctx=await browser.new_context(viewport={'width':500,'height':600},device_scale_factor=1)
  async def backend(_source,message):return await d.query('__message('+json.dumps(message)+')')
  await ctx.expose_binding('__nativeMessage',backend)
  page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.set_content('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  await page.add_style_tag(path=str(ROOT/'popup.css'))
  await page.evaluate("""() => {
    if(!crypto.randomUUID)crypto.randomUUID=()=>Math.random().toString(16).slice(2);
    window.chrome={runtime:{id:'ffnaboibekmfpegifameabebgpjpdpnn',getURL:p=>'chrome-extension://ffnaboibekmfpegifameabebgpjpdpnn/'+p,sendMessage(m,cb){const p=window.__nativeMessage(m);p.then(v=>cb?.(v));return p;}}};
  }""")
  # No storage API exists in this view fixture. It must use the background runtime.
  for file in ['src/shared/webext.js','src/shared/core.js','src/shared/i18n.js','src/shared/limits.js','src/shared/tasks.js','src/shared/policy.js','src/content/view-client.js']:
   await page.add_script_tag(path=str(ROOT/file))
  await page.evaluate('ChatCounter.isPopup=true')
  await page.add_script_tag(path=str(ROOT/'src/content/ui.js'))
  await page.locator('[data-dashboard]').wait_for(state='visible',timeout=12000)
  ok('Popup renders cached dashboard without page storage APIs',not errors)
  header=await page.locator('header').bounding_box();ok('Native popup content begins at top, not after the body element',header['y']==0)
  boxes=await page.locator('.quota-card').evaluate_all('(xs)=>xs.map(x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}})')
  ok('Three quota cards share one row within 500px',len(boxes)==3 and len({b['y'] for b in boxes})==1 and max(b['x']+b['width'] for b in boxes)<=500)
  text_boxes=await page.evaluate("""() => {const r=document.querySelector('#chatcounter-v185').shadowRoot;return ['[data-trend-title]','[data-recorded-replies]','.range-switch'].map(q=>{const e=r.querySelector(q),b=e.getBoundingClientRect();return {text:e.textContent,w:b.width,h:b.height,x:b.x,y:b.y}})}""")
  ok('Trend title and subtitle each stay on one line beside narrower slider',text_boxes[0]['h']<22 and text_boxes[1]['h']<22 and text_boxes[2]['w']<=238)
  ok('Raw metadata stays outside usage block and closed by default',await page.locator('[data-raw]').evaluate("e=>!e.open&&e.previousElementSibling.classList.contains('usage-block')"))
  ok('No old How this works disclosure remains',await page.locator('[data-how-title],details.how').count()==0)
  await page.locator('.info-dot').hover()
  ok('Help text is available on hover',await page.locator('[data-limit-tooltip]').is_visible())
  await page.locator('.info-dot').click();await page.mouse.move(1,1);ok('Help also supports touch/click pinning',await page.locator('[data-limit-tooltip]').is_visible())
  await page.keyboard.press('Escape');ok('Escape dismisses pinned tooltip',not await page.locator('[data-limit-tooltip]').is_visible())
  await page.screenshot(path=str(ROOT/'tests/popup-201-light.png'))
  await page.locator('[data-collapse]').click()
  await page.locator('[data-maintenance-title]').click()
  labels=await page.locator('.maintenance .buttons button').all_text_contents()
  ok('Diagnostics action labels are Copy / Export / Rebuild',labels==['Copy','Export','Rebuild'])
  padding=await page.locator('[data-maintenance-title]').evaluate('e=>parseFloat(getComputedStyle(e).paddingLeft)')
  buttons=await page.locator('.maintenance .buttons button').evaluate_all('xs=>xs.map(x=>({y:x.getBoundingClientRect().y,h:x.getBoundingClientRect().height}))')
  ok('Diagnostics header has padding and all compact actions fit one row',padding>=12 and len({x['y'] for x in buttons})==1 and all(x['h']<36 for x in buttons))
  await page.locator('[data-settings]').click()
  await page.locator('[data-language]').select_option('zh');await page.locator('[data-theme-select]').select_option('light')
  await page.wait_for_timeout(2300)
  ok('Polling does not overwrite in-progress settings edits',await page.locator('[data-language]').input_value()=='zh')
  await page.locator('[data-save-settings]').click();await page.wait_for_timeout(400)
  ok('Chinese translation persists through background preference storage',await page.locator('[data-app-name]').inner_text()=='ChatGPT 消息计量器')
  await page.locator('[data-collapse]').click() if await page.locator('[data-sync]').evaluate('e=>e.open') else None
  await page.screenshot(path=str(ROOT/'tests/popup-201-zh.png'))
  # Read-failure path is not treated as an empty new installation.
  await d.query('__fixture.noStorage=true');await page.evaluate('ChatCounter.emit()');await page.wait_for_timeout(400)
  ok('Transient storage read failure keeps cached usage and a reconnect notice',await page.locator('[data-dashboard]').is_visible() and not await page.locator('[data-landing]').is_visible() and await page.locator('[data-connection]').is_visible())
  await d.query('__fixture.noStorage=false');await page.evaluate('ChatCounter.emit()');await page.wait_for_timeout(400)
  # About:blank fixture renderer cannot assert native toolbar appearance; save a pixel test.
  sw=(ROOT/'service-worker.js').read_text();fn=sw[sw.index('function progressIcon('):sw.index('async function pickState(')]
  await page.add_script_tag(content=fn)
  data=await page.evaluate("""()=>{const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;canvas.getContext('2d').putImageData(progressIcon(128,30),0,0);return canvas.toDataURL().split(',')[1]}""")
  (ROOT/'tests/icon-progress-30.png').write_bytes(base64.b64decode(data))
  ok('Dynamic icon renders at supported canvas size',len(data)>300)
  ok('No uncaught renderer errors in complete, settings and error flows',not errors)
  await browser.close()

async def main():
 d=await Driver().start()
 try:
  await backend_tests(d);await render_tests(d)
 finally:await d.end()
 result={'version':'2.0.1','passed':len(CHECKS),'checks':CHECKS,'native_extension_install':'Not run: environment policy blocks all extension installs','environment':'Production service worker in Node VM with simulated extension APIs and HTTP; actual Chromium DOM renderer at 500px','real_chatgpt_account_test':False,'orion_device_test':False}
 result['source_sha256']={f.relative_to(ROOT).as_posix():hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted([*ROOT.glob('*.js'),*ROOT.glob('*.html'),*ROOT.glob('*.css'),*ROOT.glob('src/**/*.js'),ROOT/'manifest.json'])}
 (ROOT/'tests/results/2.0.1.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2))
if __name__=='__main__':asyncio.run(main())
