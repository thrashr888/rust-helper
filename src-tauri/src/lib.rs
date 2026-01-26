mod commands;

use commands::{
    analyze_dependencies, check_all_audits, check_all_outdated, check_audit, check_outdated,
    clean_project, clean_projects, get_default_scan_root, get_favorites, get_hidden, get_scan_root,
    run_cargo_bench, run_cargo_build, run_cargo_check, run_cargo_clippy, run_cargo_command,
    run_cargo_doc, run_cargo_fmt_check, run_cargo_run, run_cargo_test, run_cargo_tree,
    run_cargo_update, scan_projects, set_favorite, set_hidden, set_scan_root,
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
            get_default_scan_root,
            check_audit,
            check_all_audits,
            run_cargo_command,
            run_cargo_fmt_check,
            run_cargo_clippy,
            run_cargo_test,
            run_cargo_build,
            run_cargo_check,
            run_cargo_doc,
            run_cargo_update,
            run_cargo_run,
            run_cargo_bench,
            run_cargo_tree,
            analyze_dependencies
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
