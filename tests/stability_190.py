"""v1.9 minimal layout, returning-index, and fixed-key checks.
All ChatGPT HTTP and storage in UI tests are mocked. Native extension pages are blocked here.
"""
import asyncio, base64, copy, hashlib, json, os, shutil, tempfile, zipfile
from pathlib import Path
from playwright.async_api import async_playwright
import browser_regression as br
from browser_regression import Fixture, page, state, action, open_ui, finish_baseline, ROOT
PANEL='#chatcounter-v185'  # stable internal DOM identifier intentionally preserved

def extension_id(key):
    digest=hashlib.sha256(base64.b64decode(key,validate=True)).hexdigest()[:32]
    return ''.join(chr(ord('a')+int(c,16)) for c in digest)

async def main():
    checks=[]
    def passed(msg): checks.append(msg); print('PASS',msg,flush=True)
    manifest=json.loads((ROOT/'manifest.json').read_text())
    assert manifest['version']=='1.9.0'
    baseline=json.loads((ROOT/'docs/BASELINE_1.8.5.json').read_text())
    # No acquisition, quota math, or storage changes are in scope for this release.
    for name in ('api.js','bridge.js','limits.js','live.js','policy.js','sync.js','tasks.js'):
        assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==baseline['sha256'][name],name
    passed('History, rate governor, storage bridge, classification/limit logic and live capture are byte-identical to the supplied 1.8.5')
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        f=Fixture();ctx=await f.ctx(browser);p=await page(ctx);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        await open_ui(p);panel=p.locator(PANEL)
        assert await panel.locator('[data-landing]').is_visible() and not f.histories()
        await panel.locator('[data-start-indexing]').click();await finish_baseline(p)
        await p.evaluate('ChatCounter.emit()');await p.wait_for_timeout(160)
        siblings=await panel.locator('[data-dashboard]').evaluate("e=>Array.from(e.children,x=>x.matches('[data-sync]')?'sync':x.matches('.usage-block')?'usage':x.matches('[data-raw]')?'raw':'other')")
        assert siblings==['sync','usage','raw'],siblings
        assert await panel.locator('.usage-block .raw-data').count()==0
        assert await panel.locator('[data-raw]').get_attribute('open') is None
        bounds=await panel.locator('[data-raw]').bounding_box();usage=await panel.locator('.usage-block').bounding_box()
        assert bounds['y']>=usage['y']+usage['height']+13
        assert await panel.locator('[data-quota-cards] .quota-card').count()==3 and await panel.locator('[data-kpis] .kpi').count()==4
        passed('Sync stays on top, Usage is unchanged, and Raw Model Metadata is a separate sibling with a 14px gap')
        requests=len(f.histories())
        await panel.locator('[data-raw-collapse]').click()
        assert await panel.locator('[data-raw-collapse]').get_attribute('aria-expanded')=='true'
        assert await panel.locator('[data-raw] table').is_visible()
        await p.evaluate('ChatCounter.emit()');await p.wait_for_timeout(100)
        await panel.locator('[data-range="7d"]').click()
        assert await panel.locator('[data-raw]').get_attribute('open') is not None
        total=await panel.locator('tbody').evaluate("e=>Array.from(e.querySelectorAll('tr')).reduce((n,r)=>n+Number(r.cells[2]?.textContent||0),0)")
        expected=await p.evaluate("async()=>{const s=await ChatCounter.read(ChatCounter.session.scope);return Object.values(s.events).filter(e=>e.t>=ChatCounter.now()-7*ChatCounter.DAY&&e.t<=ChatCounter.now()).length}")
        assert total==expected and len(f.histories())==requests
        async with p.expect_download() as item: await panel.locator('[data-csv]').click()
        data=await item.value; text=Path(await data.path()).read_text()
        assert 'message_id' in text and 'FAKE_TOKEN' not in text and 'DO_NOT_STORE_BODY' not in text
        await panel.locator('[data-raw]>summary').focus();await p.keyboard.press('Enter');await p.wait_for_timeout(100)
        assert await panel.locator('[data-raw-collapse]').get_attribute('aria-expanded')=='false'
        passed('Raw panel expands/collapses by button or keyboard, survives rerenders, keeps range filtering and CSV export, and sends no history requests')
        # Language/theme behavior and disclosure label remain coordinated.
        await panel.locator('[data-settings]').click()
        await panel.locator('[data-language]').select_option('zh');await panel.locator('[data-theme-select]').select_option('light')
        await panel.locator('[data-save-settings]').click();await p.wait_for_timeout(160)
        assert await panel.locator('[data-raw-title]').inner_text()=='原始模型元数据'
        assert '展开' in await panel.locator('[data-raw-collapse]').inner_text()
        await panel.locator('[data-raw-collapse]').click();assert '收起' in await panel.locator('[data-raw-collapse]').inner_text()
        await panel.locator('[data-raw-collapse]').click()
        await p.screenshot(path=str(ROOT/'tests/dashboard-v190-light-zh.png'),full_page=True)
        await panel.locator('[data-settings]').click();await panel.locator('[data-language]').select_option('en');await panel.locator('[data-theme-select]').select_option('dark');await panel.locator('[data-save-settings]').click();await p.wait_for_timeout(100)
        await p.screenshot(path=str(ROOT/'tests/dashboard-v190-dark.png'),full_page=True)
        passed('Independent metadata disclosure follows English/Chinese and light/dark settings without moving existing controls')
        # Returning completed state uses the same namespace, skips onboarding, and does not re-index.
        before=await state(p);await p.close();f.calls.clear();p=await page(ctx);await open_ui(p);panel=p.locator(PANEL)
        after=await state(p)
        assert await panel.locator('[data-dashboard]').is_visible() and not await panel.locator('[data-landing]').is_visible()
        for k in ('events','conversations','baseline','watermark'):assert before[k]==after[k],k
        assert not f.histories(),f.histories()
        passed('Returning completed index opens directly into Dashboard without a new baseline or any history request')
        # Paused/partial indexed state must never be treated as a brand-new install.
        await p.evaluate("ChatCounter.write(ChatCounter.session.scope,s=>{s.paused=true;s.baseline.stages[1].sources[0].status='pending';s.baseline.stages[1].status='running';s.baseline.stages[1].sources[0].offset=100})")
        before=await state(p);await p.close();f.calls.clear();p=await page(ctx);await open_ui(p);panel=p.locator(PANEL);after=await state(p)
        assert await panel.locator('[data-dashboard]').is_visible() and not await panel.locator('[data-landing]').is_visible()
        assert after['paused'] and after['baseline']['stages'][1]['sources'][0]['offset']==100 and before['events']==after['events']
        assert not f.histories()
        passed('Returning paused/partial index preserves checkpoints and pause state, and bypasses onboarding without restarting')
        assert not errors,errors
        await ctx.close();await browser.close()
        assert extension_id(manifest['key'])=='ffnaboibekmfpegifameabebgpjpdpnn'
        passed('Stable public key derives the same extension ID as the supplied 1.8.5; storage namespace and schema are unchanged')
    report={'version':'1.9.0','passed':len(checks),'checks':checks,'native_extension_id':extension_id(manifest['key']),'environment':'Chromium mocked ChatGPT UI/storage/Web Locks; static public-key identity validation','native_storage_test':'Not verified: this environment blocks extension-management and extension pages','orion_device_test':False}
    (ROOT/'tests/STABILITY_190_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':asyncio.run(main())
