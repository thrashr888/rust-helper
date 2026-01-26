mod commands;

use commands::{
    check_all_outdated, check_outdated, clean_project, clean_projects, get_default_scan_root,
    get_favorites, get_hidden, get_scan_root, scan_projects, set_favorite, set_hidden,
    set_scan_root,
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
            clean_projects,
            check_outdated,
            check_all_outdated,
            get_scan_root,
            set_scan_root,
            get_default_scan_root
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
