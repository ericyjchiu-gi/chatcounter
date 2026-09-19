"""v1.8 onboarding, conversation-count progress and safer reconciliation tests.
Offline Chromium DOM with mocked ChatGPT HTTP/storage and simulated Web Locks.
"""
import asyncio, json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
from browser_regression import Fixture, page, state, action, open_ui, finish_baseline, ROOT

PANEL='#chatcounter-v185'

class ProgressFixture(Fixture):
    def __init__(self):
        super().__init__(); self.second=True; self.hold=asyncio.Event()
    async def route(self, route):
        u=urlparse(route.request.url); p=u.path; q=parse_qs(u.query)
        if p=='/backend-api/conversations/chat-b':
            self.calls.append(p+':'+q.get('before',[''])[0])
            await self.hold.wait()
            data={'messages':[self.msg('b1',.2,'gpt-5-6-thinking')],'page_info':{'has_previous_page':False}}
            return await route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        return await super().route(route)

class ProjectQueryFixture(Fixture):
    def __init__(self):
        super().__init__(); self.sidebar_queries=[]
    async def route(self, route):
        u=urlparse(route.request.url)
        if u.path=='/backend-api/gizmos/snorlax/sidebar':
            self.sidebar_queries.append(parse_qs(u.query,keep_blank_values=True))
        return await super().route(route)

async def wait_until(fn, timeout=8):
    for _ in range(int(timeout*20)):
        if await fn(): return
        await asyncio.sleep(.05)
    raise AssertionError('condition timed out')

async def main():
    checks=[]
    def ok(msg): checks.append(msg); print('PASS',msg,flush=True)
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])

        # Landing is a true no-history onboarding state.
        f=ProgressFixture(); ctx=await f.ctx(browser); p=await page(ctx); errors=[]; p.on('pageerror',lambda e:errors.append(str(e)))
        await open_ui(p); panel=p.locator(PANEL)
        assert await panel.locator('[data-landing]').is_visible()
        assert not await panel.locator('[data-dashboard]').is_visible()
        assert not f.histories()
        landing=await panel.locator('[data-landing]').inner_text()
        assert 'Start indexing' in landing and 'Chat text is not stored' in landing
        ok('Fresh install opens a dedicated landing screen and sends zero history requests')

        # Start switches immediately to full UI. Lightweight discovery must finish before detail indexing.
        await panel.locator('[data-start-indexing]').click()
        assert await panel.locator('[data-dashboard]').is_visible()
        await wait_until(lambda: asyncio.sleep(0, result=('/backend-api/conversations/chat-b:' in f.details())))
        s=await state(p); stage=s['baseline']['stages'][0]
        backend=f.histories()
        first_detail=next(i for i,x in enumerate(backend) if x.startswith('/backend-api/conversations/chat-'))
        assert all(not x.startswith('/backend-api/conversations/chat-') for x in backend[:first_detail])
        assert [x['status'] for x in stage['sources']]==['done','done','done']
        assert len(stage['tasks'])==2 and stage['tasks']['chat-a']['status']=='done' and stage['tasks']['chat-b']['status']=='pending'
        await p.evaluate('ChatCounter.emit()'); await p.wait_for_timeout(120)
        progress=await panel.locator('[data-init-progress]').inner_text()
        assert '50%' in progress and '1 / 2 conversations indexed' in progress
        assert 'conversation 2 of 2' in progress
        assert '50%' in await panel.locator('[data-range="24h"]').inner_text()
        assert '—' in await panel.locator('[data-range="7d"]').inner_text()
        cards=await panel.locator('[data-kpis]').inner_text(); assert '≥' in cards
        opacity=float(await panel.locator('[data-trend-content]').evaluate("e=>getComputedStyle(e).getPropertyValue('--range-opacity')"))
        assert 0<opacity<1
        await p.screenshot(path=str(ROOT/'tests/dashboard-initialising-180.png'),full_page=True)
        ok('Discovery-first indexing exposes a stable conversation denominator and non-linear 50% progress')

        # Completion progressively resolves partial semantics and auto-collapses Sync & History.
        f.hold.set(); s=await finish_baseline(p); await p.evaluate('ChatCounter.emit()'); await p.wait_for_timeout(150)
        assert all(j['status']=='complete' for j in s['baseline']['stages'])
        assert await panel.locator('[data-sync]').get_attribute('open') is None
        for key in ('24h','7d','30d'): assert '✓' in await panel.locator(f'[data-range="{key}"]').inner_text()
        assert '≥' not in await panel.locator('[data-kpis]').inner_text()
        ok('Completed ranges become fully bright, remove minimum-count markers and collapse healthy sync status')

        # New tab reuses account state and never returns to onboarding.
        p2=await page(ctx); await open_ui(p2); panel2=p2.locator(PANEL)
        assert not await panel2.locator('[data-landing]').is_visible() and await panel2.locator('[data-dashboard]').is_visible()
        assert (await state(p2))['settings']['interval']==15 and not (await state(p2))['settings']['live']
        ok('Completed/shared state opens directly into the full dashboard across tabs')
        await ctx.close()

        # Correct Projects first-page query is retained in v1.8.
        f=ProjectQueryFixture(); ctx=await f.ctx(browser); p=await page(ctx); await action(p,'start')
        await wait_until(lambda: asyncio.sleep(0, result=bool(f.sidebar_queries)))
        first=f.sidebar_queries[0]
        assert first.get('owned_only')==['true'] and first.get('conversations_per_gizmo')==['0'] and 'cursor' not in first
        ok('Projects discovery starts without cursor=0 and uses the corrected metadata-only sidebar query')
        await ctx.close()

        # 429 creates both hard Retry-After cooldown and a slower recovery mode.
        f=Fixture(); ctx=await f.ctx(browser); p=await page(ctx)
        result=await p.evaluate('''()=>{
          const C=ChatCounter,s=C.normalize(C.fresh()),j=C.job('24h',C.now()-C.DAY,C.now()),t={id:'x',status:'pending',attempts:0,optional:false};
          C.recordError(s,j,t,'chat',C.error('RATE_LIMITED','429',{status:429,waitMs:60000}));
          return {cool:s.cooldownUntil-C.now(),recovery:s.governor.recoveryUntil-C.now(),gap:C.requestGap(s,'24h')};
        }''')
        assert result['cool']>=59000 and result['recovery']>=299000 and result['gap']>=45000,result
        ok('HTTP 429 enforces Retry-After and a five-minute 45s/request recovery governor')
        await ctx.close()

        # Icon files are referenced and transparent at the outer corners.
        manifest=json.loads((ROOT/'manifest.json').read_text())
        assert manifest['version']=='1.9.0' and set(manifest['icons'])=={'16','32','48','128'}
        from PIL import Image
        for size,path in manifest['icons'].items():
            im=Image.open(ROOT/path).convert('RGBA'); assert im.size==(int(size),int(size)); assert im.getpixel((0,0))[3]==0
        ok('Manifest ships transparent 16/32/48/128 extension icons')

        assert not errors,errors
        await browser.close()

    report={'version':json.loads((ROOT/'manifest.json').read_text())['version'],'passed':len(checks),'environment':'Offline Chromium DOM + mocked HTTP/storage and simulated Web Locks','orion_device_test':False,'checks':checks}
    (ROOT/'tests/STABILITY_180_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__': asyncio.run(main())
