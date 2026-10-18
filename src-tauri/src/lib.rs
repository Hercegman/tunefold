use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::LogDir { file_name: None })])
        .build(),
    )
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
