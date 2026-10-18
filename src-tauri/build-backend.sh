#!/bin/bash
# Pakira Python backend u jedan binary koji Tauri bundla kao sidecar.
set -euo pipefail
cd "$(dirname "$0")/../backend"
TRIPLE=$(rustc -vV 2>/dev/null | sed -n 's/^host: //p' || echo x86_64-unknown-linux-gnu)
.venv/bin/pyinstaller --onefile --name backend --clean --noconfirm \
  --collect-all yt_dlp --collect-submodules mutagen --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto --hidden-import uvicorn.lifespan.on \
  run.py
mkdir -p ../src-tauri/binaries
cp dist/backend "../src-tauri/binaries/backend-$TRIPLE"
echo "sidecar: src-tauri/binaries/backend-$TRIPLE"
