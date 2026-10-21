#!/usr/bin/env python3
"""Register Tunefold with the Linux desktop, so audio files can be opened in it.

The `.deb` and `.rpm` packages already install a desktop entry that claims the
audio types - Tauri writes it from the `fileAssociations` block in
`tauri.conf.json`. This script is for the other two cases: an AppImage, which
is a loose file the desktop knows nothing about, and a local `cargo`/`tauri dev`
build, which is not installed at all.

    python scripts/install_desktop.py path/to/Tunefold.AppImage
    python scripts/install_desktop.py --default      # also make it the handler
    python scripts/install_desktop.py --uninstall

With no path it looks for a release build under src-tauri/target.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_ID = "io.github.hercegman.tunefold"
ENTRY = f"{APP_ID}.desktop"

# What Tunefold offers to open. Kept in step with bundle.fileAssociations in
# src-tauri/tauri.conf.json and with AUDIO_TYPES in backend/app/main.py.
MIME = [
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/flac",
    "audio/x-flac",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
]

APPS = Path.home() / ".local/share/applications"
ICONS = Path.home() / ".local/share/icons/hicolor/128x128/apps"


def candidates() -> list[Path]:
    """Where a build of Tunefold tends to end up, best first."""
    t = ROOT / "src-tauri/target"
    return [
        *sorted(t.glob("release/bundle/appimage/*.AppImage")),
        t / "release/tunefold",
        t / "debug/tunefold",
    ]


def find_binary(given: str | None) -> Path:
    if given:
        p = Path(given).expanduser().resolve()
        if not p.is_file():
            sys.exit(f"{p} is not a file")
        if not os.access(p, os.X_OK):
            sys.exit(f"{p} is not executable - chmod +x it first")
        return p
    for p in candidates():
        if p.is_file() and os.access(p, os.X_OK):
            return p.resolve()
    sys.exit("No Tunefold build found. Pass the path to the AppImage or binary, "
             "or run `npm run dist` first.")


def desktop_entry(binary: Path) -> str:
    # %F, so the desktop passes the files it was asked to open. Tunefold reads
    # them from its arguments and hands a second file to the window that is
    # already running rather than starting a second copy of itself.
    return "\n".join([
        "[Desktop Entry]",
        "Type=Application",
        "Name=Tunefold",
        "GenericName=Music Player",
        "Comment=Playlists to neatly tagged files, on a turntable",
        f"Exec={binary} %F",
        "Icon=tunefold",
        "Terminal=false",
        "Categories=AudioVideo;Audio;Player;Music;",
        f"MimeType={';'.join(MIME)};",
        "StartupNotify=true",
        "StartupWMClass=Tunefold",
        "",
    ])


def refresh() -> None:
    """Tell the desktop to re-read what it has, where the tools exist to ask."""
    for cmd in (["update-desktop-database", str(APPS)],
                ["gtk-update-icon-cache", "-f", "-t", str(ICONS.parent.parent.parent)]):
        if shutil.which(cmd[0]):
            subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def install(binary: Path, make_default: bool) -> None:
    APPS.mkdir(parents=True, exist_ok=True)
    path = APPS / ENTRY
    path.write_text(desktop_entry(binary), encoding="utf-8")
    path.chmod(0o755)
    print(f"wrote {path}\n  -> {binary}")

    icon = ROOT / "src-tauri/icons/128x128.png"
    if icon.is_file():
        ICONS.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(icon, ICONS / "tunefold.png")
        print(f"wrote {ICONS / 'tunefold.png'}")

    refresh()

    if make_default:
        if not shutil.which("xdg-mime"):
            print("xdg-mime is not installed, so the default handler was left alone")
        else:
            for m in MIME:
                subprocess.run(["xdg-mime", "default", ENTRY, m], check=False)
            print(f"Tunefold is now the default for {len(MIME)} audio types")
    else:
        print('Tunefold now shows up under "Open with". To make it the one that '
              "opens audio files: rerun with --default")


def uninstall() -> None:
    gone = False
    for path in (APPS / ENTRY, ICONS / "tunefold.png"):
        if path.exists():
            path.unlink()
            print(f"removed {path}")
            gone = True
    if not gone:
        print("nothing to remove")
    refresh()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("binary", nargs="?", help="the AppImage or built binary to point at")
    ap.add_argument("--default", action="store_true", help="also make Tunefold the handler for audio files")
    ap.add_argument("--uninstall", action="store_true", help="remove the desktop entry again")
    args = ap.parse_args()

    if sys.platform != "linux":
        sys.exit("This script is for Linux. On Windows and macOS the installer "
                 "registers the file types itself.")
    if args.uninstall:
        uninstall()
    else:
        install(find_binary(args.binary), args.default)


if __name__ == "__main__":
    main()
