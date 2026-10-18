"""Package the Python backend into a single binary that Tauri bundles as a sidecar.

Works on Linux, macOS and Windows. Run it with the interpreter that has the
backend requirements and PyInstaller installed:

    backend/.venv/bin/python scripts/build_backend.py      # Linux / macOS
    backend\\.venv\\Scripts\\python scripts\\build_backend.py  # Windows
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
OUT = ROOT / "src-tauri" / "binaries"


def host_triple() -> str:
    out = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit("could not read host triple from rustc -vV")


def main() -> None:
    triple = host_triple()
    cmd = [
        sys.executable, "-m", "PyInstaller", "--onefile", "--name", "backend", "--clean", "--noconfirm",
        "--collect-all", "yt_dlp", "--collect-submodules", "mutagen",
        "--hidden-import", "uvicorn.logging", "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols.http.auto", "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan.on",
        "run.py",
    ]
    subprocess.run(cmd, cwd=BACKEND, check=True)
    ext = ".exe" if os.name == "nt" else ""
    src = BACKEND / "dist" / f"backend{ext}"
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / f"backend-{triple}{ext}"
    shutil.copy2(src, dst)
    print(f"sidecar: {dst.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
