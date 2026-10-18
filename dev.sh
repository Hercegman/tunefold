#!/bin/bash
# Dev: Python backend + Tauri (Vite) with hot reload. Ctrl+C stops both.
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
backend/.venv/bin/python backend/run.py --port 8765 -v &
BE=$!
trap 'kill $BE 2>/dev/null' EXIT
if [ "$1" = "web" ]; then npm run dev; else npm run tauri dev; fi
