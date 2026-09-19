"""Reconstruct a checksum-verified release delta; removed before the final commit."""
import base64, hashlib, json, lzma, shutil, subprocess
from pathlib import Path
ROOT=Path.cwd().resolve()
STAGING=ROOT/'.build/v190'
def safe(name):
    p=ROOT/name
    if not p.resolve().is_relative_to(ROOT) or '.git' in p.parts or p.is_symlink():
        raise ValueError('Unsafe release path: '+name)
    return p
def digest(b): return hashlib.sha256(b).hexdigest()
index=json.loads((STAGING/'INDEX.json').read_text())
chunks=[]
for entry in index['chunks']:
    b=(STAGING/entry['path']).read_bytes()
    assert len(b)==entry['size'] and digest(b)==entry['sha256'],entry['path']
    chunks.append(b)
compressed=base64.b64decode(b''.join(chunks),validate=True)
assert digest(compressed)==index['xz_sha256'],'Payload transfer integrity'
data=json.loads(lzma.decompress(compressed))
subprocess.run(['git','merge-base','--is-ancestor',data['base_commit'],'HEAD'],check=True)
prepared={}
for name,spec in data['files'].items():
    safe(name)
    if 'text' in spec:
        body=spec['text'].encode('utf-8')
    elif 'base64' in spec:
        body=base64.b64decode(spec['base64'],validate=True)
    else:
        original=safe(spec['source']).read_bytes()
        assert digest(original)==spec['base_sha256'],'Source changed: '+spec['source']
        text=original.decode('utf-8');parts=[]
        for piece in spec['pieces']:
            if isinstance(piece,str): parts.append(piece)
            else:
                start,end=piece
                assert isinstance(start,int) and isinstance(end,int) and 0<=start<=end<=len(text)
                parts.append(text[start:end])
        body=''.join(parts).encode('utf-8')
    assert digest(body)==spec['sha256'],'Reconstruction mismatch: '+name
    prepared[name]=body
for name in data['delete']: safe(name)
assert len(prepared)==index['files']
for name,body in prepared.items():
    p=safe(name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
for name in data['delete']: safe(name).unlink(missing_ok=True)
shutil.rmtree(STAGING)
safe('.github/workflows/assemble-v190.yml').unlink(missing_ok=True)
safe('.build/assemble_v190.py').unlink(missing_ok=True)
print('Verified and applied',len(prepared),'release files; staging files removed.')
