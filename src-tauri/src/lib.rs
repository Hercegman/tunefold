use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, State};
use tauri_plugin_log::{Target, TargetKind};

/// What Tunefold will accept from the desktop. The backend decides what it can
/// actually serve; this is only the filter on what counts as "a file for us"
/// when it arrives as a command-line argument.
const AUDIO_EXT: [&str; 9] = ["mp3", "m4a", "flac", "opus", "wav", "ogg", "oga", "aac", "m4b"];

/// Files the desktop has handed over and the window has not collected yet.
///
/// Launching Tunefold on a file is not the same thing as the window being
/// ready for it: the webview still has to start, and the Python backend behind
/// it still has to come up. So the paths wait here until the frontend asks.
#[derive(Default)]
struct Opened(Mutex<Vec<String>>);

fn audio_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let p = PathBuf::from(&a);
            let ok = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| AUDIO_EXT.contains(&e.to_ascii_lowercase().as_str()))
                .unwrap_or(false);
            (ok && p.is_file()).then(|| p.to_string_lossy().into_owned())
        })
        .collect()
}

/// Everything waiting, and it is only handed out once.
#[tauri::command]
fn take_opened_files(opened: State<'_, Opened>) -> Vec<String> {
    opened
        .0
        .lock()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Opening a second file must reach the window that is already playing
    // rather than start a rival copy of the app, so this plugin goes on first:
    // the second process hands its arguments over and exits.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        use tauri::Emitter;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        let files = audio_args(argv.into_iter().skip(1));
        if files.is_empty() {
            return;
        }
        if let Ok(mut q) = app.state::<Opened>().0.lock() {
            q.extend(files);
        }
        // Only a nudge: the frontend reads the paths with take_opened_files.
        let _ = app.emit("tunefold://open-files", ());
    }));

    let app = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::LogDir { file_name: None })])
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Opened(Mutex::new(audio_args(std::env::args().skip(1)))))
        .invoke_handler(tauri::generate_handler![take_opened_files])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // macOS does not pass a double-clicked file on the command line: it sends
    // the app an Apple Event, which arrives here instead.
    app.run(move |_handle, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            use tauri::Emitter;
            let paths = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned());
            let files = audio_args(paths);
            if !files.is_empty() {
                if let Ok(mut q) = _handle.state::<Opened>().0.lock() {
                    q.extend(files);
                }
                let _ = _handle.emit("tunefold://open-files", ());
            }
        }
    });
}
