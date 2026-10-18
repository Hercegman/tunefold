"""Prepare every sidecar binary Tauri bundles next to the app:

  * backend  - the Python backend packaged with PyInstaller
  * ffmpeg   - static build from the `ffmpeg-static` npm package
  * ffprobe  - static build from the `ffprobe-static` npm package

Works on Linux, macOS and Windows. Run it with the interpreter that has the
backend requirements and PyInstaller installed, after `npm install`:

    backend/.venv/bin/python scripts/build_sidecars.py        # Linux / macOS
    backend\\.venv\\Scripts\\python scripts\\build_sidecars.py    # Windows

Pass --skip-backend to only refresh ffmpeg/ffprobe.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
OUT = ROOT / "src-tauri" / "binaries"
EXE = ".exe" if os.name == "nt" else ""


def host_triple() -> str:
    out = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit("could not read host triple from rustc -vV")


def node_path(expr: str) -> Path:
    """Ask node where an npm package put its binary (handles per-platform layouts)."""
    out = subprocess.run(["node", "-e", f"process.stdout.write(JSON.stringify({expr}))"],
                         capture_output=True, text=True, check=True, cwd=ROOT).stdout
    p = Path(json.loads(out))
    if not p.exists():
        raise SystemExit(f"{p} does not exist; run `npm install` first")
    return p


def build_backend() -> Path:
    cmd = [
        sys.executable, "-m", "PyInstaller", "--onefile", "--name", "backend", "--clean", "--noconfirm",
        "--collect-all", "yt_dlp", "--collect-submodules", "mutagen",
        "--hidden-import", "uvicorn.logging", "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols.http.auto", "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan.on",
        "run.py",
    ]
    subprocess.run(cmd, cwd=BACKEND, check=True)
    return BACKEND / "dist" / f"backend{EXE}"


def install(src: Path, name: str, triple: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / f"{name}-{triple}{EXE}"
    shutil.copy2(src, dst)
    dst.chmod(0o755)
    print(f"sidecar: {dst.relative_to(ROOT)} ({dst.stat().st_size // 1_000_000} MB)")


def main() -> None:
    triple = host_triple()
    if "--skip-backend" not in sys.argv:
        install(build_backend(), "backend", triple)
    install(node_path("require('ffmpeg-static')"), "ffmpeg", triple)
    install(node_path("require('ffprobe-static').path"), "ffprobe", triple)


if __name__ == "__main__":
    main()
