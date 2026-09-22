"""Run only the current 2.0.1 validation suite."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
for file in [ROOT / "service-worker.js", *sorted((ROOT / "src").rglob("*.js"))]:
    subprocess.run(["node", "--check", str(file)], check=True)
subprocess.run([sys.executable, str(ROOT / "tests/regression_201.py")], check=True)
