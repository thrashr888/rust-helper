mod commands;

use commands::{
    add_recent_project, analyze_dependencies, analyze_toolchains, check_all_audits,
    check_all_licenses, check_all_outdated, check_audit, check_licenses, check_outdated,
    check_required_tools, clean_project, clean_projects, get_cache, get_default_scan_root,
    get_favorites, get_git_info, get_hidden, get_recent_projects, get_scan_root, install_tool,
    read_cargo_toml, run_cargo_bench, run_cargo_build, run_cargo_check, run_cargo_clippy,
    run_cargo_command, run_cargo_command_streaming, run_cargo_doc, run_cargo_fmt_check,
    run_cargo_run, run_cargo_test, run_cargo_tree, run_cargo_update, save_audit_cache,
    save_dep_analysis_cache, save_license_cache, save_outdated_cache, save_toolchain_cache,
    scan_projects, set_favorite, set_hidden, set_scan_root,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
            get_recent_projects,
            add_recent_project,
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
            run_cargo_command_streaming,
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
            analyze_dependencies,
            analyze_toolchains,
            check_licenses,
            check_all_licenses,
            get_cache,
            save_outdated_cache,
            save_audit_cache,
            save_dep_analysis_cache,
            save_toolchain_cache,
            save_license_cache,
            check_required_tools,
            install_tool,
            read_cargo_toml,
            get_git_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
