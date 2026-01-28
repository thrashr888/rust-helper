mod commands;

use commands::{
    add_recent_project, analyze_bloat, analyze_dependencies, analyze_toolchains, check_all_audits,
    check_all_licenses, check_all_outdated, check_audit, check_homebrew_status, check_licenses,
    check_outdated, check_required_tools, check_rust_homebrew_status, clean_project,
    clean_projects, detect_github_actions, detect_installed_ides, generate_docs, get_binary_sizes,
    get_cache, get_cargo_features, get_default_scan_root, get_favorites, get_git_info,
    get_git_stats, get_git_tags, get_github_actions_status, get_hidden, get_msrv, get_preferred_ide,
    get_recent_projects, get_rust_version_info, get_scan_root, get_workspace_info, global_search,
    install_tool, open_file_in_ide, open_file_in_vscode, open_in_finder, open_in_ide,
    open_in_vscode, parse_nextest_junit, read_cargo_toml, read_tarpaulin_results, run_cargo_bench,
    run_cargo_build, run_cargo_check, run_cargo_clippy, run_cargo_command,
    run_cargo_command_streaming, run_cargo_doc, run_cargo_fmt_check, run_cargo_run,
    run_cargo_tarpaulin, run_cargo_test, run_cargo_tree, run_cargo_update, save_audit_cache,
    save_dep_analysis_cache, save_license_cache, save_outdated_cache, save_toolchain_cache,
    scan_projects, set_favorite, set_hidden, set_preferred_ide, set_scan_root, upgrade_homebrew,
    upgrade_rust_homebrew,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            get_git_info,
            open_in_finder,
            generate_docs,
            get_cargo_features,
            get_binary_sizes,
            get_msrv,
            get_workspace_info,
            get_github_actions_status,
            open_in_vscode,
            open_file_in_vscode,
            get_rust_version_info,
            global_search,
            check_homebrew_status,
            upgrade_homebrew,
            check_rust_homebrew_status,
            upgrade_rust_homebrew,
            analyze_bloat,
            run_cargo_tarpaulin,
            read_tarpaulin_results,
            get_git_tags,
            get_git_stats,
            detect_installed_ides,
            open_in_ide,
            open_file_in_ide,
            get_preferred_ide,
            set_preferred_ide,
            parse_nextest_junit,
            detect_github_actions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
