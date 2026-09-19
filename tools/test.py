"""Run the maintained offline browser suites and produce a current aggregate report."""
import json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SUITES=[('browser_regression.py','RESULTS.json'),('stability_172.py','STABILITY_172_RESULTS.json'),('stability_180.py','STABILITY_180_RESULTS.json'),('stability_185.py','STABILITY_185_RESULTS.json'),('stability_190.py','STABILITY_190_RESULTS.json')]
reports=[]
for script,report in SUITES:
    subprocess.run([sys.executable,str(ROOT/'tests'/script)],check=True)
    data=json.loads((ROOT/'tests'/report).read_text())
    reports.append({'suite':script,'passed':data['passed']})
result={'version':json.loads((ROOT/'manifest.json').read_text())['version'],'passed':sum(r['passed'] for r in reports),'suites':reports,'environment':'Offline Chromium with mocked ChatGPT HTTP, storage and Web Locks; static key derivation','native_extension_storage_verified':False,'orion_device_test':False}
(ROOT/'tests/ALL_190_RESULTS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
