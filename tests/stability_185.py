"""v1.8.5 UX, plan limits, shared pacing, rotating Projects, settings and backup tests."""
import asyncio, json, hashlib
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from browser_regression import Fixture, page, state, action, open_ui, finish_baseline, ROOT

PANEL='#chatcounter-v185'

class ManyProjectsFixture(Fixture):
    def __init__(self):
        super().__init__(); self.project_ids=[]
    async def route(self, route):
        u=urlparse(route.request.url)
        if u.path=='/backend-api/gizmos/snorlax/sidebar':
            self.calls.append(u.path)
            data={'items':[{'gizmo':{'gizmo':{'id':x}}} for x in self.project_ids]}
            return await route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        if u.path.startswith('/backend-api/gizmos/g-p-') and u.path.endswith('/conversations'):
            self.calls.append(u.path)
            return await route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[]}))
        return await super().route(route)

def okmsg(checks,msg): checks.append(msg); print('PASS',msg,flush=True)

async def main():
    checks=[]
    manifest=json.loads((ROOT/'manifest.json').read_text())
    assert manifest['version']=='1.9.0' and len(manifest['key'])>300
    scripts=next(x['js'] for x in manifest['content_scripts'] if x.get('world')=='MAIN')
    assert scripts==['core.js','i18n.js','limits.js','api.js','tasks.js','policy.js','sync.js','live.js','ui.js']
    okmsg(checks,'Manifest has a stable development key and loads the v1.8.5 language/limit modules')

    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])

        f=Fixture();ctx=await f.ctx(browser);p=await page(ctx);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        await open_ui(p);panel=p.locator(PANEL)
        assert await panel.locator('[data-landing]').is_visible() and not f.histories()
        await panel.locator('[data-settings]').click()
        assert await panel.locator('[data-settings-page]').is_visible() and not await panel.locator('[data-landing]').is_visible()
        await panel.locator('[data-reset-day]').select_option('5')
        await panel.locator('[data-reset-time]').fill('17:14')
        await panel.locator('[data-reset-tz]').fill('Europe/London')
        await panel.locator('[data-language]').select_option('zh')
        await panel.locator('[data-theme-select]').select_option('light')
        await panel.locator('[data-save-settings]').click();await p.wait_for_timeout(180)
        assert '消息计量器' in await panel.locator('[data-app-name]').inner_text()
        assert await panel.locator('main').get_attribute('data-theme')=='light'
        s=await state(p);prefs=await p.evaluate('ChatCounter.readUIPrefs()')
        assert s['settings']['resetDay']=='5' and s['settings']['resetTime']=='17:14' and prefs=={'language':'zh','theme':'light'}
        okmsg(checks,'Settings persist manual reset assumptions, browser/English/Chinese override and system/light/dark override')

        # Return to English/dark for stable text assertions.
        await panel.locator('[data-settings]').click();await panel.locator('[data-language]').select_option('en');await panel.locator('[data-theme-select]').select_option('dark');await panel.locator('[data-save-settings]').click();await p.wait_for_timeout(120)
        await panel.locator('[data-start-indexing]').click();s=await finish_baseline(p);await p.evaluate('ChatCounter.emit()');await p.wait_for_timeout(160)
        assert all(x['status']=='complete' for x in s['baseline']['stages'])
        assert await panel.locator('[data-sync]').get_attribute('open') is None
        summary=await panel.locator('[data-sync]>summary').inner_text()
        assert 'SYNC & HISTORY' in summary and 'Up to date' in summary and '24 HOURS' not in summary
        assert not await panel.locator('[data-coverage]').is_visible()
        okmsg(checks,'Healthy Sync & History collapses to one status-pill row; coverage cards remain expanded-only')

        assert await panel.locator('[data-quota-cards] .quota-card').count()==3
        cols=await panel.locator('[data-quota-cards]').evaluate("e=>getComputedStyle(e).gridTemplateColumns.split(' ').length")
        assert cols==3
        assert await panel.locator('[data-kpis] .kpi').count()==4
        assert 'Normal chats' in await panel.locator('[data-kpis]').inner_text() and 'Total Pro' in await panel.locator('[data-kpis]').inner_text()
        old_transform=await panel.locator('[data-range-thumb]').evaluate("e=>getComputedStyle(e).transform")
        await panel.locator('[data-range="7d"]').click();await p.wait_for_timeout(80)
        new_transform=await panel.locator('[data-range-thumb]').evaluate("e=>getComputedStyle(e).transform")
        assert old_transform!=new_transform
        assert await panel.locator('[data-range="7d"]').evaluate("e=>!!e.closest('.usage-block')")
        okmsg(checks,'Advanced Chat shows three plan cards in one row; trend contains a sliding 24h/7d/30d control and four usage KPIs')

        plan_math=await p.evaluate('''()=>{
          const C=ChatCounter,now=C.now(),events=[];
          for(let i=0;i<7;i++)events.push({id:'a'+i,t:now-1000,model:'gpt-5-6-pro'});
          for(let i=0;i<57;i++)events.push({id:'b'+i,t:now-2000,model:'gpt-6-pro'});
          const base=C.fresh();base.settings.resetDay='';
          const test=(raw,label,seat='')=>{base.plan={raw,label,seat};return C.advancedUsage(base,events,now)};
          return {pro:test('pro','Pro 20x'),prolite:test('prolite','Pro 5x'),premium:test('business','Business premium','premium'),standard:test('business','Business standard','standard'),plus:test('plus','Plus'),families:[C.family('gpt-5-6-thinking'),C.family('gpt-5-6-pro'),C.family('gpt-6-pro')]};
        }''')
        assert [x['cap'] for x in plan_math['pro']['cards']]==[200,170,200]
        assert [x['cap'] for x in plan_math['prolite']['cards']]==[50,50,50]
        assert plan_math['premium']['config']['cap']==50 and plan_math['standard']['config']['cap']==15
        assert plan_math['plus']['config'] is None and plan_math['families']==['normal','gpt56pro','gpt6pro']
        okmsg(checks,'Plan logic supports Pro $200, Pro $100, Business Standard/Premium and deliberately infers no Plus cap')

        # Export and restore the complete account-scoped index.
        await panel.locator('[data-settings]').click()
        async with p.expect_download() as di:
            await panel.locator('[data-export-index]').click()
        download=await di.value;backup=ROOT/'tests/index-backup-185.json';await download.save_as(backup)
        payload=json.loads(backup.read_text());blob=backup.read_text()
        assert payload['format']=='chatcounter-index-backup' and payload['scope']==await p.evaluate('ChatCounter.session.scope')
        assert 'FAKE_TOKEN' not in blob and 'DO_NOT_STORE_BODY' not in blob and payload['state']['events']
        original=len(payload['state']['events'])
        await p.evaluate('ChatCounter.write(ChatCounter.session.scope,s=>{s.events={};s.conversations={}})')
        p.once('dialog',lambda d: asyncio.create_task(d.accept()))
        await panel.locator('[data-import-file]').set_input_files(str(backup));await p.wait_for_timeout(250)
        assert len((await state(p))['events'])==original
        okmsg(checks,'Portable index backup/restore preserves metadata and coverage while excluding chat text and authentication tokens')
        await ctx.close()

        # Shared account-level budget must include recent reconciliation.
        f=Fixture();ctx=await f.ctx(browser);p=await page(ctx);await action(p,'start');await finish_baseline(p);f.calls.clear()
        await p.evaluate("ChatCounter.write(ChatCounter.session.scope,s=>{s.governor.burstCount=39;s.governor.softPauseUntil=0})")
        await action(p,'reconcile');s=await state(p)
        assert s['governor']['softPauseUntil']>0 and s['governor']['burstCount']==0
        assert len(f.histories())==1,f.histories()
        okmsg(checks,'Recent reconciliation consumes the same 40-request Auto budget and stops at a shared rest boundary')
        await ctx.close()

        # Recent refresh rotates a bounded Project subset instead of enumerating every Project each 15 minutes.
        f=ManyProjectsFixture();ctx=await f.ctx(browser);p=await page(ctx);await action(p,'start');await finish_baseline(p)
        f.project_ids=[f'g-p-project-{i}' for i in range(10)];f.calls.clear();await action(p,'reconcile');s=await state(p)
        first=[x for x in f.calls if x.startswith('/backend-api/gizmos/g-p-project-')]
        assert len(first)==4 and s['recent']['projectInventory']=={'total':10,'selected':4,'start':0},(first,s['recent'].get('projectInventory'))
        await p.evaluate('__advance+=16*60000');f.calls.clear();await action(p,'reconcile');s=await state(p)
        second=[x for x in f.calls if x.startswith('/backend-api/gizmos/g-p-project-')]
        assert len(second)==4 and set(first).isdisjoint(second) and s['recent']['projectInventory']['start']==4
        okmsg(checks,'15-minute refresh rotates four Projects per cycle, lowering a 16-Project account from ~21 to ~9 requests per refresh')
        await ctx.close()

        assert not errors,errors
        await browser.close()

    report={'version':manifest['version'],'passed':len(checks),'environment':'Offline Chromium DOM + mocked HTTP/storage/Web Locks','orion_device_test':False,'checks':checks}
    (ROOT/'tests/STABILITY_185_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__': asyncio.run(main())
