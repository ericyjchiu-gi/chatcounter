"""Validate and build a reproducible, installable ChatCounter 2.0.1 ZIP."""
from pathlib import Path
import base64
import hashlib
import json
import os
import re
import subprocess
import zipfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text())
version = manifest["version"]
assert version == "2.0.1" and manifest["version_name"] == version

key = base64.b64decode(manifest["key"], validate=True)
extension_id = "".join(chr(97 + int(c, 16)) for c in hashlib.sha256(key).hexdigest()[:32])
assert extension_id == "ffnaboibekmfpegifameabebgpjpdpnn", "Stable extension identity changed"
assert manifest["action"]["default_popup"] == "popup.html"
assert set(manifest["permissions"]) == {"storage", "alarms"}
assert manifest["host_permissions"] == ["https://chatgpt.com/*"]
assert manifest["content_scripts"][0]["world"] == "ISOLATED"
assert manifest["content_scripts"][1]["world"] == "MAIN"

runtime = {
    "manifest.json",
    "service-worker.js",
    "popup.html",
    "popup.css",
    *[p.relative_to(ROOT).as_posix() for p in (ROOT / "src").rglob("*.js")],
    *manifest["icons"].values(),
}
for block in manifest["content_scripts"]:
    runtime.update(block["js"])
runtime.add(manifest["background"]["service_worker"])
runtime.add(manifest["action"]["default_popup"])
runtime.update(re.findall(r'(?:src|href)="([^"]+)"', (ROOT / "popup.html").read_text()))

for name in runtime:
    assert (ROOT / name).is_file(), f"Missing runtime file: {name}"
for file in [ROOT / "service-worker.js", *sorted((ROOT / "src").rglob("*.js"))]:
    subprocess.run(["node", "--check", str(file)], check=True)
for size, name in manifest["icons"].items():
    with Image.open(ROOT / name) as icon:
        icon.load()
        assert icon.size == (int(size), int(size)), f"Wrong icon size: {name}"

report_path = ROOT / "tests/results/2.0.1.json"
report = json.loads(report_path.read_text())
assert report["version"] == version and report["passed"] == 45
inputs = [ROOT / "manifest.json", ROOT / "service-worker.js", ROOT / "popup.html", ROOT / "popup.css", *sorted((ROOT / "src").rglob("*.js"))]
for file in inputs:
    name = file.relative_to(ROOT).as_posix()
    assert report["source_sha256"][name] == hashlib.sha256(file.read_bytes()).hexdigest(), "Re-run tests after changing " + name

# Keep the active tree honest: old tests/reports belong to Git history, not main.
assert not list((ROOT / "tests").glob("stability_*.py"))
assert not list((ROOT / "tests").glob("STABILITY_*_RESULTS.json"))
assert not list(ROOT.glob("RELEASE_NOTES_*.md"))

names = set(runtime)
names.update({
    "README.md",
    "CHANGELOG.md",
    "docs/PRIVACY.md",
    "docs/releases/2.0.1.md",
    "tests/results/2.0.1.json",
})
blobs = {name: (ROOT / name).read_bytes() for name in sorted(names)}
build = {
    "version": version,
    "commit": os.environ.get("CHATCOUNTER_COMMIT"),
    "extension_id": extension_id,
    "test_checks": report["passed"],
    "validation": report["environment"],
    "native_extension_install_verified": False,
    "sha256": {name: hashlib.sha256(body).hexdigest() for name, body in blobs.items()},
}
blobs["BUILD.json"] = (json.dumps(build, indent=2) + "\n").encode()

out = ROOT / "dist" / f"chatcounter-v{version}-universal.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, body in sorted(blobs.items()):
        entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, body)
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
print(out)
