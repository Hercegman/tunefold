"""Set the same version in package.json, src-tauri/tauri.conf.json and Cargo.toml.

    python scripts/bump_version.py 0.2.0
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
v = sys.argv[1].lstrip("v")
if not re.fullmatch(r"\d+\.\d+\.\d+", v):
    raise SystemExit("version must look like 1.2.3")

for name in ("package.json", "src-tauri/tauri.conf.json"):
    p = ROOT / name
    d = json.loads(p.read_text())
    d["version"] = v
    p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")

init = ROOT / "backend" / "app" / "__init__.py"
init.write_text(re.sub(r'^__version__ = "[^"]+"', f'__version__ = "{v}"', init.read_text(), count=1, flags=re.M))

lock = ROOT / "src-tauri" / "Cargo.lock"
lock.write_text(re.sub(r'(name = "tunefold"\nversion = ")[^"]+(")', rf'\g<1>{v}\g<2>', lock.read_text(), count=1))

cargo = ROOT / "src-tauri" / "Cargo.toml"
cargo.write_text(re.sub(r'^version = "[^"]+"', f'version = "{v}"', cargo.read_text(), count=1, flags=re.M))
print(f"version set to {v} in package.json, tauri.conf.json, Cargo.toml, Cargo.lock, backend/app/__init__.py")
