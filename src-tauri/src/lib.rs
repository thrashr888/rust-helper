mod commands;

use commands::{
    clean_project, clean_projects, get_favorites, get_hidden, scan_projects, set_favorite,
    set_hidden,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_projects,
            get_favorites,
            set_favorite,
            get_hidden,
            set_hidden,
            clean_project,
            clean_projects
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
