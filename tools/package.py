"""Validate runtime modules and produce a reproducible, flat-root Universal ZIP."""
from pathlib import Path
import hashlib,json,os,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'manifest.json').read_text())
names={'manifest.json','README.md','RELEASE_NOTES_1.7.2.md','RELEASE_NOTES_1.7.1.md','RELEASE_NOTES_1.6_TO_1.7.md'}
for block in manifest['content_scripts']:
 for name in block['js']:
  subprocess.run(['node','--check',str(ROOT/name)],check=True)
  names.add(name)
for name in ('tests/RESULTS.json','tests/STABILITY_172_RESULTS.json','tests/browser_regression.py','tests/stability_172.py'):
 names.add(name)
blobs={name:(ROOT/name).read_bytes() for name in sorted(names)}
git_commit=subprocess.run(['git','-C',str(ROOT),'rev-parse','HEAD'],capture_output=True,text=True)
commit=os.environ.get('CHATCOUNTER_COMMIT') or (git_commit.stdout.strip() if git_commit.returncode==0 else None)
build={'version':manifest['version'],'commit':commit,'sha256':{n:hashlib.sha256(b).hexdigest() for n,b in blobs.items()}}
blobs['BUILD.json']=(json.dumps(build,indent=2)+'\n').encode()
out=ROOT/'dist'/f"chatcounter-v{manifest['version']}-universal.zip";out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for name,b in sorted(blobs.items()):
  entry=zipfile.ZipInfo(name,(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100644<<16;z.writestr(entry,b)
print(out)
