# Tunefold

Desktop aplikacija (Tauri 2 + React + Python) koja iz Spotify linka na playlistu, album
ili pjesmu napravi uredno tagirane audio datoteke, uz **pametno grupiranje izvođača**:
pjesme koje Spotify kreditira kao `Majke` i `Goran Bare, Majke` završe pod jednim
imenom, pa kolekcija složena po abecedi ostaje zajedno.

Audio se ne skida sa Spotifyja. Spotify daje metapodatke (javne embed stranice, bez
prijave), zvuk dolazi s YouTubea preko yt-dlp i ffmpeg-a, tagovi i cover kroz mutagen.

## Struktura

```
backend/            Python (FastAPI) – Spotify metapodaci, YouTube match, download, tagovi, SQLite
  app/spotify.py    embed scraping + spclient paging + og:description za album
  app/artists.py    normalizacija i grupiranje izvođača (prijedlozi: merge / feat / spelling / alias)
  app/downloader.py yt-dlp pretraga + odabir po naslovu/izvođaču/trajanju + download
  app/tags.py       ID3v2.3 / MP4 / FLAC / Opus tagovi i cover
  app/library.py    postavke, pravila izvođača, evidencija skinutog, nedavno
  app/main.py       HTTP API + SSE napredak
src/                React + TypeScript + Tailwind sučelje
src-tauri/          Tauri shell; backend se pokreće kao sidecar binary
```

## Dev

```bash
./dev.sh          # backend + Tauri prozor s hot reloadom
./dev.sh web      # backend + Vite u browseru (http://localhost:5173)
```

Preduvjeti: Node 20+, Rust (rustup), Python 3.10+, ffmpeg na PATH-u,
`backend/.venv` (`python -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt`).

## Build

```bash
npm run dist      # PyInstaller backend -> src-tauri/binaries/, pa tauri build (deb/appimage/rpm)
```

## Pravna napomena

Skidanje tuđe glazbe s YouTubea krši YouTube ToS i, ovisno o sadržaju, autorska prava.
Koristi za vlastiti sadržaj ili tamo gdje je to dopušteno.

## Licenca

MIT, vidi [LICENSE](LICENSE).
