"""Validate the release and build a deterministic flat-root Universal ZIP."""
from pathlib import Path
import base64, hashlib, json, os, subprocess, zipfile
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'manifest.json').read_text())
version=manifest['version']
key=base64.b64decode(manifest['key'],validate=True)
eid=''.join(chr(97+int(c,16)) for c in hashlib.sha256(key).hexdigest()[:32])
assert eid=='ffnaboibekmfpegifameabebgpjpdpnn','Do not rotate the shipped 1.8.5 public key'
assert manifest['version_name']==version
names={'manifest.json','README.md',f'RELEASE_NOTES_{version}.md'}
for block in manifest['content_scripts']:
    for name in block['js']:
        subprocess.run(['node','--check',str(ROOT/name)],check=True)
        names.add(name)
for size,name in manifest['icons'].items():
    with Image.open(ROOT/name) as im:
        im.load();assert im.size==(int(size),int(size)),name
        assert 'A' in im.getbands() or 'transparency' in im.info,name
    names.add(name)
for folder,glob in [('archive/release-notes','*.md'),('docs','*.md'),('docs','*.json'),('tools','*.py'),('tests','*.py')]:
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT/folder).glob(glob))
reports=['RESULTS.json','STABILITY_172_RESULTS.json','STABILITY_180_RESULTS.json','STABILITY_185_RESULTS.json','STABILITY_190_RESULTS.json','ALL_190_RESULTS.json']
for name in reports:
    data=json.loads((ROOT/'tests'/name).read_text())
    assert data['version']==version, 'Stale test report: '+name
    names.add('tests/'+name)
baseline=json.loads((ROOT/'docs/BASELINE_1.8.5.json').read_text())['sha256']
for name in ['api.js','bridge.js','limits.js','live.js','policy.js','sync.js','tasks.js']:
    assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==baseline[name],name
for name in ['core.js','i18n.js']:
    normalized=(ROOT/name).read_text().replace(version,'1.8.5').encode()
    assert hashlib.sha256(normalized).hexdigest()==baseline[name],name
for name,digest in baseline.items():
    if name.startswith('RELEASE_NOTES_'):
        assert hashlib.sha256((ROOT/'archive/release-notes'/name).read_bytes()).hexdigest()==digest,name
blobs={name:(ROOT/name).read_bytes() for name in sorted(names)}
commit=os.environ.get('CHATCOUNTER_COMMIT')
if not commit:
    p=subprocess.run(['git','-C',str(ROOT),'rev-parse','HEAD'],capture_output=True,text=True)
    commit=p.stdout.strip() if p.returncode==0 else None
build={'version':version,'commit':commit,'extension_id':eid,'extension_id_source':'unchanged 1.8.5 public manifest key','baseline_sha256':hashlib.sha256((ROOT/'docs/BASELINE_1.8.5.json').read_bytes()).hexdigest(),'sha256':{n:hashlib.sha256(b).hexdigest() for n,b in blobs.items()}}
blobs['BUILD.json']=(json.dumps(build,indent=2)+'\n').encode()
out=ROOT/'dist'/f'chatcounter-v{version}-universal.zip';out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,body in sorted(blobs.items()):
        entry=zipfile.ZipInfo(name,(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100644<<16
        z.writestr(entry,body)
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
print(out)
