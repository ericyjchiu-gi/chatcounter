"""Validate referenced scripts and produce a reproducible, flat extension ZIP."""
from pathlib import Path
import hashlib, json, subprocess, zipfile
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'manifest.json').read_text())
files=['manifest.json','README.md','RELEASE_NOTES_1.6_TO_1.7.md','RELEASE_NOTES_1.7.1.md','tests/browser_regression.py','tests/RESULTS.json']
for group in manifest['content_scripts']:
 for filename in group['js']:
  subprocess.run(['node','--check',str(root/filename)],check=True)
  if filename not in files:files.append(filename)
for name in files:
 if not (root/name).is_file():raise RuntimeError('Missing package file: '+name)
hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in sorted(files)}
output=root/'dist';output.mkdir(exist_ok=True)
path=output/f'chatcounter-v{manifest["version"]}-universal.zip'
with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for name in sorted(files):
  entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100644<<16
  archive.writestr(entry,(root/name).read_bytes())
 entry=zipfile.ZipInfo('BUILD.json',date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100644<<16
 archive.writestr(entry,json.dumps({'version':manifest['version'],'files':hashes},indent=2)+'\n')
assert zipfile.ZipFile(path).testzip() is None
print(path)
print('SHA256',hashlib.sha256(path.read_bytes()).hexdigest())
