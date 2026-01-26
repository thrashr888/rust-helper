use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub path: String,
    pub target_size: u64,
    pub dep_count: usize,
    pub last_modified: u64,
    pub is_workspace_member: bool,
    pub workspace_root: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CargoToml {
    package: Option<Package>,
    dependencies: Option<toml::Table>,
    workspace: Option<Workspace>,
}

#[derive(Debug, Deserialize)]
struct Package {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Workspace {
    members: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub favorites: Vec<String>,
    pub hidden: Vec<String>,
    pub scan_root: Option<String>,
    pub recent_projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScanCache {
    pub outdated_results: Option<Vec<OutdatedResult>>,
    pub outdated_timestamp: Option<u64>,
    pub audit_results: Option<Vec<AuditResult>>,
    pub audit_timestamp: Option<u64>,
    pub dep_analysis: Option<DepAnalysis>,
    pub dep_analysis_timestamp: Option<u64>,
    pub toolchain_analysis: Option<ToolchainAnalysis>,
    pub toolchain_timestamp: Option<u64>,
    pub license_analysis: Option<LicenseAnalysis>,
    pub license_timestamp: Option<u64>,
}

fn get_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rust-helper")
        .join("config.json")
}

fn get_cache_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rust-helper")
        .join("cache.json")
}

fn load_cache() -> ScanCache {
    let path = get_cache_path();
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        ScanCache::default()
    }
}

fn save_cache(cache: &ScanCache) -> Result<(), String> {
    let path = get_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load_config() -> AppConfig {
    let path = get_config_path();
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        AppConfig::default()
    }
}

fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

fn get_last_modified(path: &Path) -> u64 {
    // Check src/ directory for last modification
    let src_path = path.join("src");
    let cargo_path = path.join("Cargo.toml");

    let mut latest: u64 = 0;

    for check_path in [&src_path, &cargo_path] {
        if check_path.exists() {
            if let Ok(meta) = fs::metadata(check_path) {
                if let Ok(modified) = meta.modified() {
                    if let Ok(duration) = modified.duration_since(SystemTime::UNIX_EPOCH) {
                        latest = latest.max(duration.as_secs());
                    }
                }
            }
        }
    }

    // Also check files in src/
    if src_path.exists() {
        for entry in WalkDir::new(&src_path)
            .max_depth(3)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if let Ok(duration) = modified.duration_since(SystemTime::UNIX_EPOCH) {
                        latest = latest.max(duration.as_secs());
                    }
                }
            }
        }
    }

    latest
}

fn parse_cargo_toml(path: &Path) -> Option<(String, usize, bool)> {
    let content = fs::read_to_string(path).ok()?;
    let cargo: CargoToml = toml::from_str(&content).ok()?;

    let name = cargo
        .package
        .and_then(|p| p.name)
        .unwrap_or_else(|| "unknown".to_string());

    let dep_count = cargo.dependencies.map(|d| d.len()).unwrap_or(0);
    let is_workspace_root = cargo.workspace.is_some();

    Some((name, dep_count, is_workspace_root))
}

fn find_workspace_roots(root_path: &str) -> HashSet<PathBuf> {
    let mut workspace_roots = HashSet::new();
    let mut workspace_members: HashSet<PathBuf> = HashSet::new();

    // First pass: find all workspace roots and their members
    for entry in WalkDir::new(root_path)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.file_name().map(|n| n == "Cargo.toml").unwrap_or(false) {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(cargo) = toml::from_str::<CargoToml>(&content) {
                    if let Some(workspace) = cargo.workspace {
                        if let Some(members) = workspace.members {
                            let project_dir = path.parent().unwrap();
                            workspace_roots.insert(project_dir.to_path_buf());

                            // Resolve member globs
                            for member in members {
                                if member.contains('*') {
                                    // Handle glob patterns
                                    let pattern = project_dir.join(&member);
                                    if let Ok(paths) = glob::glob(pattern.to_str().unwrap_or("")) {
                                        for glob_path in paths.filter_map(|p| p.ok()) {
                                            workspace_members.insert(glob_path);
                                        }
                                    }
                                } else {
                                    let member_path = project_dir.join(&member);
                                    workspace_members.insert(member_path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    workspace_members
}

fn scan_projects_sync(root_path: &str) -> Vec<Project> {
    let mut projects = Vec::new();
    let workspace_members = find_workspace_roots(root_path);

    for entry in WalkDir::new(root_path)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.file_name().map(|n| n == "Cargo.toml").unwrap_or(false) {
            // Skip if this is inside a target directory
            if path
                .ancestors()
                .any(|p| p.file_name().map(|n| n == "target").unwrap_or(false))
            {
                continue;
            }

            let project_dir = path.parent().unwrap();

            if let Some((name, dep_count, _is_workspace_root)) = parse_cargo_toml(path) {
                let target_path = project_dir.join("target");
                let target_size = get_dir_size(&target_path);
                let last_modified = get_last_modified(project_dir);

                // Check if this is a workspace member
                let is_workspace_member = workspace_members.contains(&project_dir.to_path_buf());

                // Find workspace root if this is a member
                let workspace_root = if is_workspace_member {
                    project_dir
                        .ancestors()
                        .skip(1)
                        .find(|p| {
                            workspace_members.contains(&p.to_path_buf()) || {
                                let cargo = p.join("Cargo.toml");
                                cargo.exists()
                                    && fs::read_to_string(&cargo)
                                        .ok()
                                        .and_then(|c| toml::from_str::<CargoToml>(&c).ok())
                                        .map(|c| c.workspace.is_some())
                                        .unwrap_or(false)
                            }
                        })
                        .map(|p| p.to_string_lossy().to_string())
                } else {
                    None
                };

                projects.push(Project {
                    name,
                    path: project_dir.to_string_lossy().to_string(),
                    target_size,
                    dep_count,
                    last_modified,
                    is_workspace_member,
                    workspace_root,
                });
            }
        }
    }

    // Sort by name by default
    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    projects
}

#[tauri::command]
pub async fn scan_projects(root_path: String) -> Vec<Project> {
    tokio::task::spawn_blocking(move || scan_projects_sync(&root_path))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_favorites() -> Vec<String> {
    load_config().favorites
}

#[tauri::command]
pub fn set_favorite(path: String, is_favorite: bool) -> Result<(), String> {
    let mut config = load_config();

    if is_favorite {
        if !config.favorites.contains(&path) {
            config.favorites.push(path);
        }
    } else {
        config.favorites.retain(|p| p != &path);
    }

    save_config(&config)
}

#[tauri::command]
pub fn get_hidden() -> Vec<String> {
    load_config().hidden
}

#[tauri::command]
pub fn get_recent_projects() -> Vec<String> {
    load_config().recent_projects
}

#[tauri::command]
pub fn add_recent_project(path: String) -> Result<(), String> {
    let mut config = load_config();

    // Remove if already exists (will be re-added at front)
    config.recent_projects.retain(|p| p != &path);

    // Add to front
    config.recent_projects.insert(0, path);

    // Keep only last 5
    config.recent_projects.truncate(5);

    save_config(&config)
}

#[tauri::command]
pub fn set_hidden(path: String, is_hidden: bool) -> Result<(), String> {
    let mut config = load_config();

    if is_hidden {
        if !config.hidden.contains(&path) {
            config.hidden.push(path);
        }
    } else {
        config.hidden.retain(|p| p != &path);
    }

    save_config(&config)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanResult {
    pub path: String,
    pub name: String,
    pub freed_bytes: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn clean_project(
    project_path: String,
    debug_only: bool,
    size_hint: Option<u64>,
) -> CleanResult {
    let path = PathBuf::from(&project_path);
    let target_path = path.join("target");

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    if !target_path.exists() {
        return CleanResult {
            path: project_path,
            name,
            freed_bytes: 0,
            success: true,
            error: None,
        };
    }

    // Use size hint from frontend if available (avoids slow recalculation)
    let size_before = size_hint.unwrap_or(0);

    let (result, is_full_clean) = if debug_only {
        // Only clean debug directory
        let debug_path = target_path.join("debug");
        if debug_path.exists() {
            (fs::remove_dir_all(&debug_path), false)
        } else {
            (Ok(()), false)
        }
    } else {
        // Clean entire target directory
        (fs::remove_dir_all(&target_path), true)
    };

    match result {
        Ok(()) => {
            // If full clean succeeded, we freed the entire size
            // If partial (debug only), estimate ~half for simplicity
            let freed = if is_full_clean {
                size_before
            } else {
                size_before / 2
            };
            CleanResult {
                path: project_path,
                name,
                freed_bytes: freed,
                success: true,
                error: None,
            }
        }
        Err(e) => CleanResult {
            path: project_path,
            name,
            freed_bytes: 0,
            success: false,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn clean_projects(
    project_paths: Vec<String>,
    debug_only: bool,
    size_hints: Option<Vec<u64>>,
) -> Vec<CleanResult> {
    project_paths
        .into_iter()
        .enumerate()
        .map(|(i, path)| {
            let hint = size_hints.as_ref().and_then(|h| h.get(i).copied());
            clean_project(path, debug_only, hint)
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutdatedDep {
    pub name: String,
    pub current: String,
    pub latest: String,
    pub kind: String, // "Normal", "Development", "Build"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutdatedResult {
    pub project_path: String,
    pub project_name: String,
    pub dependencies: Vec<OutdatedDep>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CargoOutdatedOutput {
    dependencies: Vec<CargoOutdatedDep>,
}

#[derive(Debug, Deserialize)]
struct CargoOutdatedDep {
    name: String,
    project: String,
    latest: String,
    kind: Option<String>,
}

#[tauri::command]
pub fn check_outdated(project_path: String) -> OutdatedResult {
    let path = PathBuf::from(&project_path);
    let project_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Run cargo outdated with JSON output, only showing root deps
    let output = Command::new("cargo")
        .args(["outdated", "--format", "json", "--root-deps-only"])
        .current_dir(&path)
        .output();

    match output {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return OutdatedResult {
                    project_path,
                    project_name,
                    dependencies: vec![],
                    success: false,
                    error: Some(stderr.to_string()),
                };
            }

            let stdout = String::from_utf8_lossy(&output.stdout);

            // Parse JSON output
            match serde_json::from_str::<CargoOutdatedOutput>(&stdout) {
                Ok(parsed) => {
                    let dependencies: Vec<OutdatedDep> = parsed
                        .dependencies
                        .into_iter()
                        .filter(|d| d.project != d.latest) // Only include outdated ones
                        .map(|d| OutdatedDep {
                            name: d.name,
                            current: d.project,
                            latest: d.latest,
                            kind: d.kind.unwrap_or_else(|| "Normal".to_string()),
                        })
                        .collect();

                    OutdatedResult {
                        project_path,
                        project_name,
                        dependencies,
                        success: true,
                        error: None,
                    }
                }
                Err(e) => OutdatedResult {
                    project_path,
                    project_name,
                    dependencies: vec![],
                    success: false,
                    error: Some(format!("Failed to parse output: {}", e)),
                },
            }
        }
        Err(e) => OutdatedResult {
            project_path,
            project_name,
            dependencies: vec![],
            success: false,
            error: Some(format!("Failed to run cargo outdated: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn check_all_outdated(project_paths: Vec<String>) -> Vec<OutdatedResult> {
    tokio::task::spawn_blocking(move || project_paths.into_iter().map(check_outdated).collect())
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_scan_root() -> Option<String> {
    load_config().scan_root
}

#[tauri::command]
pub fn set_scan_root(path: String) -> Result<(), String> {
    let mut config = load_config();
    config.scan_root = Some(path);
    save_config(&config)
}

#[tauri::command]
pub fn get_default_scan_root() -> String {
    dirs::home_dir()
        .map(|h| h.join("Workspace").to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string())
}

// ============ Security Audit ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vulnerability {
    pub id: String,
    pub package: String,
    pub version: String,
    pub title: String,
    pub description: String,
    pub severity: String,
    pub url: Option<String>,
    pub patched_versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditWarning {
    pub kind: String,
    pub package: String,
    pub version: String,
    pub title: String,
    pub advisory_id: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditResult {
    pub project_path: String,
    pub project_name: String,
    pub vulnerabilities: Vec<Vulnerability>,
    pub warnings: Vec<AuditWarning>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CargoAuditOutput {
    vulnerabilities: CargoAuditVulns,
    warnings: Option<CargoAuditWarnings>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct CargoAuditVulns {
    list: Vec<CargoAuditVuln>,
    count: usize,
}

#[derive(Debug, Deserialize)]
struct CargoAuditVuln {
    advisory: CargoAuditAdvisory,
    package: CargoAuditPackage,
    versions: Option<CargoAuditVersions>,
}

#[derive(Debug, Deserialize)]
struct CargoAuditAdvisory {
    id: String,
    title: String,
    description: String,
    url: Option<String>,
    cvss: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CargoAuditPackage {
    name: String,
    version: String,
}

#[derive(Debug, Deserialize)]
struct CargoAuditVersions {
    patched: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CargoAuditWarnings {
    unmaintained: Option<Vec<CargoAuditWarning>>,
    unsound: Option<Vec<CargoAuditWarning>>,
    yanked: Option<Vec<CargoAuditWarning>>,
}

#[derive(Debug, Deserialize)]
struct CargoAuditWarning {
    kind: String,
    package: CargoAuditPackage,
    advisory: CargoAuditAdvisory,
}

#[tauri::command]
pub fn check_audit(project_path: String) -> AuditResult {
    let path = PathBuf::from(&project_path);
    let project_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Run cargo audit with JSON output
    let output = Command::new("cargo")
        .args(["audit", "--json"])
        .current_dir(&path)
        .output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);

            // Parse JSON output (cargo audit may return non-zero exit code if vulnerabilities found)
            match serde_json::from_str::<CargoAuditOutput>(&stdout) {
                Ok(parsed) => {
                    let vulnerabilities: Vec<Vulnerability> = parsed
                        .vulnerabilities
                        .list
                        .into_iter()
                        .map(|v| Vulnerability {
                            id: v.advisory.id,
                            package: v.package.name,
                            version: v.package.version,
                            title: v.advisory.title,
                            description: v.advisory.description,
                            severity: v.advisory.cvss.unwrap_or_else(|| "unknown".to_string()),
                            url: v.advisory.url,
                            patched_versions: v.versions.map(|v| v.patched).unwrap_or_default(),
                        })
                        .collect();

                    let mut warnings: Vec<AuditWarning> = Vec::new();
                    if let Some(w) = parsed.warnings {
                        for warn in w.unmaintained.unwrap_or_default() {
                            warnings.push(AuditWarning {
                                kind: warn.kind,
                                package: warn.package.name,
                                version: warn.package.version,
                                title: warn.advisory.title,
                                advisory_id: warn.advisory.id,
                                url: warn.advisory.url,
                            });
                        }
                        for warn in w.unsound.unwrap_or_default() {
                            warnings.push(AuditWarning {
                                kind: warn.kind,
                                package: warn.package.name,
                                version: warn.package.version,
                                title: warn.advisory.title,
                                advisory_id: warn.advisory.id,
                                url: warn.advisory.url,
                            });
                        }
                        for warn in w.yanked.unwrap_or_default() {
                            warnings.push(AuditWarning {
                                kind: warn.kind,
                                package: warn.package.name,
                                version: warn.package.version,
                                title: warn.advisory.title,
                                advisory_id: warn.advisory.id,
                                url: warn.advisory.url,
                            });
                        }
                    }

                    AuditResult {
                        project_path,
                        project_name,
                        vulnerabilities,
                        warnings,
                        success: true,
                        error: None,
                    }
                }
                Err(e) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    AuditResult {
                        project_path,
                        project_name,
                        vulnerabilities: vec![],
                        warnings: vec![],
                        success: false,
                        error: Some(format!("Failed to parse output: {}. Stderr: {}", e, stderr)),
                    }
                }
            }
        }
        Err(e) => AuditResult {
            project_path,
            project_name,
            vulnerabilities: vec![],
            warnings: vec![],
            success: false,
            error: Some(format!("Failed to run cargo audit: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn check_all_audits(project_paths: Vec<String>) -> Vec<AuditResult> {
    tokio::task::spawn_blocking(move || project_paths.into_iter().map(check_audit).collect())
        .await
        .unwrap_or_default()
}

// ============ Cargo Commands ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CargoCommandResult {
    pub project_path: String,
    pub command: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

fn run_cargo_command_sync(
    project_path: String,
    command: String,
    args: Vec<String>,
) -> CargoCommandResult {
    let path = PathBuf::from(&project_path);

    let output = Command::new("cargo")
        .arg(&command)
        .args(&args)
        .current_dir(&path)
        .output();

    match output {
        Ok(output) => CargoCommandResult {
            project_path,
            command,
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
        },
        Err(e) => CargoCommandResult {
            project_path,
            command,
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to execute command: {}", e),
            exit_code: None,
        },
    }
}

#[tauri::command]
pub async fn run_cargo_command(
    project_path: String,
    command: String,
    args: Vec<String>,
) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || run_cargo_command_sync(project_path, command, args))
        .await
        .unwrap_or_else(|_| CargoCommandResult {
            project_path: String::new(),
            command: String::new(),
            success: false,
            stdout: String::new(),
            stderr: "Task panicked".to_string(),
            exit_code: None,
        })
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandOutputEvent {
    pub line: String,
    pub stream: String, // "stdout" or "stderr"
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandCompleteEvent {
    pub project_path: String,
    pub command: String,
    pub success: bool,
    pub exit_code: Option<i32>,
}

#[tauri::command]
pub async fn run_cargo_command_streaming(
    app: AppHandle,
    project_path: String,
    command: String,
    args: Vec<String>,
) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    let path_clone = project_path.clone();

    tokio::task::spawn(async move {
        let mut child = match Command::new("cargo")
            .arg(&command)
            .args(&args)
            .current_dir(&path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let _ = app.emit(
                    "cargo-output",
                    CommandOutputEvent {
                        line: format!("Failed to start command: {}", e),
                        stream: "stderr".to_string(),
                    },
                );
                let _ = app.emit(
                    "cargo-complete",
                    CommandCompleteEvent {
                        project_path: path_clone,
                        command,
                        success: false,
                        exit_code: None,
                    },
                );
                return;
            }
        };

        // Read stdout in a separate thread
        let stdout = child.stdout.take();
        let app_stdout = app.clone();
        let stdout_handle = std::thread::spawn(move || {
            if let Some(stdout) = stdout {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    let _ = app_stdout.emit(
                        "cargo-output",
                        CommandOutputEvent {
                            line,
                            stream: "stdout".to_string(),
                        },
                    );
                }
            }
        });

        // Read stderr in a separate thread
        let stderr = child.stderr.take();
        let app_stderr = app.clone();
        let stderr_handle = std::thread::spawn(move || {
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    let _ = app_stderr.emit(
                        "cargo-output",
                        CommandOutputEvent {
                            line,
                            stream: "stderr".to_string(),
                        },
                    );
                }
            }
        });

        // Wait for process to complete
        let status = child.wait();
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        let (success, exit_code) = match status {
            Ok(status) => (status.success(), status.code()),
            Err(_) => (false, None),
        };

        let _ = app.emit(
            "cargo-complete",
            CommandCompleteEvent {
                project_path: path_clone,
                command,
                success,
                exit_code,
            },
        );
    });

    Ok(())
}

// Convenience commands for common operations - these also run async via spawn_blocking
#[tauri::command]
pub async fn run_cargo_fmt_check(project_path: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        run_cargo_command_sync(
            project_path,
            "fmt".to_string(),
            vec!["--".to_string(), "--check".to_string()],
        )
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "fmt".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_clippy(project_path: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        run_cargo_command_sync(
            project_path,
            "clippy".to_string(),
            vec!["--".to_string(), "-D".to_string(), "warnings".to_string()],
        )
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "clippy".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_test(project_path: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        run_cargo_command_sync(project_path, "test".to_string(), vec![])
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "test".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_build(project_path: String, release: bool) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        let args = if release {
            vec!["--release".to_string()]
        } else {
            vec![]
        };
        run_cargo_command_sync(project_path, "build".to_string(), args)
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "build".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_check(project_path: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        run_cargo_command_sync(project_path, "check".to_string(), vec![])
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "check".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_doc(project_path: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        run_cargo_command_sync(
            project_path,
            "doc".to_string(),
            vec!["--no-deps".to_string()],
        )
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "doc".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_update(project_path: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        run_cargo_command_sync(project_path, "update".to_string(), vec![])
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "update".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_run(project_path: String, release: bool) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        let args = if release {
            vec!["--release".to_string()]
        } else {
            vec![]
        };
        run_cargo_command_sync(project_path, "run".to_string(), args)
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "run".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_bench(project_path: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        run_cargo_command_sync(project_path, "bench".to_string(), vec![])
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "bench".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

#[tauri::command]
pub async fn run_cargo_tree(project_path: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        run_cargo_command_sync(project_path, "tree".to_string(), vec![])
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: "tree".to_string(),
        success: false,
        stdout: String::new(),
        stderr: "Task panicked".to_string(),
        exit_code: None,
    })
}

// ============ Dependency Analysis ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepUsage {
    pub name: String,
    pub versions: Vec<VersionUsage>,
    pub project_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionUsage {
    pub version: String,
    pub projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DepAnalysis {
    pub dependencies: Vec<DepUsage>,
    pub total_unique_deps: usize,
    pub deps_with_mismatches: usize,
}

#[derive(Debug, Deserialize)]
struct CargoTomlDeps {
    dependencies: Option<toml::Table>,
    #[serde(rename = "dev-dependencies")]
    dev_dependencies: Option<toml::Table>,
    #[serde(rename = "build-dependencies")]
    build_dependencies: Option<toml::Table>,
}

fn extract_version(value: &toml::Value) -> Option<String> {
    match value {
        toml::Value::String(s) => Some(s.clone()),
        toml::Value::Table(t) => t.get("version").and_then(|v| v.as_str().map(String::from)),
        _ => None,
    }
}

fn analyze_dependencies_sync(project_paths: Vec<String>) -> DepAnalysis {
    use std::collections::HashMap;

    // Map: dep_name -> version -> list of projects
    let mut dep_map: HashMap<String, HashMap<String, Vec<String>>> = HashMap::new();

    for project_path in project_paths {
        let cargo_path = PathBuf::from(&project_path).join("Cargo.toml");
        if let Ok(content) = fs::read_to_string(&cargo_path) {
            if let Ok(cargo) = toml::from_str::<CargoTomlDeps>(&content) {
                let project_name = PathBuf::from(&project_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| project_path.clone());

                // Collect all dependencies
                let mut all_deps = Vec::new();
                if let Some(deps) = cargo.dependencies {
                    all_deps.extend(deps.into_iter());
                }
                if let Some(deps) = cargo.dev_dependencies {
                    all_deps.extend(deps.into_iter());
                }
                if let Some(deps) = cargo.build_dependencies {
                    all_deps.extend(deps.into_iter());
                }

                for (name, value) in all_deps {
                    if let Some(version) = extract_version(&value) {
                        dep_map
                            .entry(name)
                            .or_default()
                            .entry(version)
                            .or_default()
                            .push(project_name.clone());
                    }
                }
            }
        }
    }

    // Convert to output format
    let mut dependencies: Vec<DepUsage> = dep_map
        .into_iter()
        .map(|(name, versions)| {
            let project_count: usize = versions.values().map(|p| p.len()).sum();
            let versions: Vec<VersionUsage> = versions
                .into_iter()
                .map(|(version, projects)| VersionUsage { version, projects })
                .collect();
            DepUsage {
                name,
                versions,
                project_count,
            }
        })
        .collect();

    // Sort by usage count (most used first)
    dependencies.sort_by(|a, b| b.project_count.cmp(&a.project_count));

    let total_unique_deps = dependencies.len();
    let deps_with_mismatches = dependencies.iter().filter(|d| d.versions.len() > 1).count();

    DepAnalysis {
        dependencies,
        total_unique_deps,
        deps_with_mismatches,
    }
}

#[tauri::command]
pub async fn analyze_dependencies(project_paths: Vec<String>) -> DepAnalysis {
    tokio::task::spawn_blocking(move || analyze_dependencies_sync(project_paths))
        .await
        .unwrap_or_default()
}

// ============ License Analysis ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInfo {
    pub name: String,
    pub version: String,
    pub license: String,
    pub authors: Option<String>,
    pub repository: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseGroup {
    pub license: String,
    pub packages: Vec<String>,
    pub is_problematic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseResult {
    pub project_path: String,
    pub project_name: String,
    pub licenses: Vec<LicenseInfo>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LicenseAnalysis {
    pub projects: Vec<LicenseResult>,
    pub license_groups: Vec<LicenseGroup>,
    pub total_packages: usize,
    pub problematic_count: usize,
}

#[derive(Debug, Deserialize)]
struct CargoLicenseEntry {
    name: String,
    version: String,
    authors: Option<String>,
    repository: Option<String>,
    license: Option<String>,
}

// Licenses that may have problematic requirements for commercial use
const PROBLEMATIC_LICENSES: &[&str] = &[
    "GPL",
    "AGPL",
    "LGPL",
    "CC-BY-SA",
    "CC-BY-NC",
    "SSPL",
    "BSL",
    "BUSL",
    "Elastic",
    "Commons Clause",
];

fn is_problematic_license(license: &str) -> bool {
    let upper = license.to_uppercase();
    PROBLEMATIC_LICENSES
        .iter()
        .any(|p| upper.contains(&p.to_uppercase()))
}

#[tauri::command]
pub fn check_licenses(project_path: String) -> LicenseResult {
    let path = PathBuf::from(&project_path);
    let project_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path.clone());

    // Run cargo-license with JSON output
    let output = Command::new("cargo")
        .args(["license", "--json"])
        .current_dir(&path)
        .output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);

            match serde_json::from_str::<Vec<CargoLicenseEntry>>(&stdout) {
                Ok(parsed) => {
                    let licenses: Vec<LicenseInfo> = parsed
                        .into_iter()
                        .map(|e| LicenseInfo {
                            name: e.name,
                            version: e.version,
                            license: e.license.unwrap_or_else(|| "Unknown".to_string()),
                            authors: e.authors,
                            repository: e.repository,
                        })
                        .collect();

                    LicenseResult {
                        project_path,
                        project_name,
                        licenses,
                        success: true,
                        error: None,
                    }
                }
                Err(e) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    LicenseResult {
                        project_path,
                        project_name,
                        licenses: vec![],
                        success: false,
                        error: Some(format!("Failed to parse output: {}. Stderr: {}", e, stderr)),
                    }
                }
            }
        }
        Err(e) => LicenseResult {
            project_path,
            project_name,
            licenses: vec![],
            success: false,
            error: Some(format!("Failed to run cargo-license: {}", e)),
        },
    }
}

fn check_all_licenses_sync(project_paths: Vec<String>) -> LicenseAnalysis {
    use std::collections::HashMap;

    let projects: Vec<LicenseResult> = project_paths.into_iter().map(check_licenses).collect();

    // Aggregate licenses across all projects
    let mut license_map: HashMap<String, Vec<String>> = HashMap::new();

    for proj in &projects {
        if proj.success {
            for lic in &proj.licenses {
                license_map
                    .entry(lic.license.clone())
                    .or_default()
                    .push(format!("{}@{}", lic.name, lic.version));
            }
        }
    }

    // Deduplicate packages per license
    for packages in license_map.values_mut() {
        packages.sort();
        packages.dedup();
    }

    let mut license_groups: Vec<LicenseGroup> = license_map
        .into_iter()
        .map(|(license, packages)| {
            let is_problematic = is_problematic_license(&license);
            LicenseGroup {
                license,
                packages,
                is_problematic,
            }
        })
        .collect();

    // Sort: problematic first, then by package count
    license_groups.sort_by(|a, b| {
        if a.is_problematic != b.is_problematic {
            b.is_problematic.cmp(&a.is_problematic)
        } else {
            b.packages.len().cmp(&a.packages.len())
        }
    });

    let total_packages: usize = license_groups.iter().map(|g| g.packages.len()).sum();
    let problematic_count = license_groups
        .iter()
        .filter(|g| g.is_problematic)
        .map(|g| g.packages.len())
        .sum();

    LicenseAnalysis {
        projects,
        license_groups,
        total_packages,
        problematic_count,
    }
}

#[tauri::command]
pub async fn check_all_licenses(project_paths: Vec<String>) -> LicenseAnalysis {
    tokio::task::spawn_blocking(move || check_all_licenses_sync(project_paths))
        .await
        .unwrap_or_default()
}

// ============ Toolchain Analysis ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainInfo {
    pub project_path: String,
    pub project_name: String,
    pub toolchain: Option<String>,
    pub msrv: Option<String>,
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainGroup {
    pub version: String,
    pub projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolchainAnalysis {
    pub projects: Vec<ToolchainInfo>,
    pub toolchain_groups: Vec<ToolchainGroup>,
    pub msrv_groups: Vec<ToolchainGroup>,
    pub has_mismatches: bool,
}

#[derive(Debug, Deserialize)]
struct RustToolchainToml {
    toolchain: Option<RustToolchainSpec>,
}

#[derive(Debug, Deserialize)]
struct RustToolchainSpec {
    channel: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CargoTomlPackage {
    package: Option<CargoPackageInfo>,
}

#[derive(Debug, Deserialize)]
struct CargoPackageInfo {
    #[serde(rename = "rust-version")]
    rust_version: Option<String>,
}

fn analyze_toolchains_sync(project_paths: Vec<String>) -> ToolchainAnalysis {
    use std::collections::HashMap;

    let mut projects: Vec<ToolchainInfo> = Vec::new();
    let mut toolchain_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut msrv_map: HashMap<String, Vec<String>> = HashMap::new();

    for project_path in project_paths {
        let path = PathBuf::from(&project_path);
        let project_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| project_path.clone());

        let mut toolchain: Option<String> = None;
        let mut channel: Option<String> = None;
        let mut msrv: Option<String> = None;

        // Read rust-toolchain.toml
        let toolchain_path = path.join("rust-toolchain.toml");
        if toolchain_path.exists() {
            if let Ok(content) = fs::read_to_string(&toolchain_path) {
                if let Ok(parsed) = toml::from_str::<RustToolchainToml>(&content) {
                    if let Some(spec) = parsed.toolchain {
                        channel = spec.channel.clone();
                        toolchain = spec.channel;
                    }
                }
            }
        }

        // Also check rust-toolchain (plain file)
        let toolchain_plain = path.join("rust-toolchain");
        if toolchain.is_none() && toolchain_plain.exists() {
            if let Ok(content) = fs::read_to_string(&toolchain_plain) {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    toolchain = Some(trimmed.clone());
                    channel = Some(trimmed);
                }
            }
        }

        // Read Cargo.toml for rust-version (MSRV)
        let cargo_path = path.join("Cargo.toml");
        if cargo_path.exists() {
            if let Ok(content) = fs::read_to_string(&cargo_path) {
                if let Ok(parsed) = toml::from_str::<CargoTomlPackage>(&content) {
                    if let Some(pkg) = parsed.package {
                        msrv = pkg.rust_version;
                    }
                }
            }
        }

        // Track in groups
        if let Some(ref tc) = toolchain {
            toolchain_map
                .entry(tc.clone())
                .or_default()
                .push(project_name.clone());
        }
        if let Some(ref m) = msrv {
            msrv_map
                .entry(m.clone())
                .or_default()
                .push(project_name.clone());
        }

        projects.push(ToolchainInfo {
            project_path,
            project_name,
            toolchain,
            msrv,
            channel,
        });
    }

    // Convert maps to groups
    let mut toolchain_groups: Vec<ToolchainGroup> = toolchain_map
        .into_iter()
        .map(|(version, projects)| ToolchainGroup { version, projects })
        .collect();
    toolchain_groups.sort_by(|a, b| b.projects.len().cmp(&a.projects.len()));

    let mut msrv_groups: Vec<ToolchainGroup> = msrv_map
        .into_iter()
        .map(|(version, projects)| ToolchainGroup { version, projects })
        .collect();
    msrv_groups.sort_by(|a, b| b.projects.len().cmp(&a.projects.len()));

    let has_mismatches = toolchain_groups.len() > 1 || msrv_groups.len() > 1;

    ToolchainAnalysis {
        projects,
        toolchain_groups,
        msrv_groups,
        has_mismatches,
    }
}

#[tauri::command]
pub async fn analyze_toolchains(project_paths: Vec<String>) -> ToolchainAnalysis {
    tokio::task::spawn_blocking(move || analyze_toolchains_sync(project_paths))
        .await
        .unwrap_or_default()
}

// ============ Cache Management ============

#[tauri::command]
pub fn get_cache() -> ScanCache {
    load_cache()
}

#[tauri::command]
pub fn save_outdated_cache(results: Vec<OutdatedResult>) -> Result<(), String> {
    let mut cache = load_cache();
    cache.outdated_results = Some(results);
    cache.outdated_timestamp = Some(get_current_timestamp());
    save_cache(&cache)
}

#[tauri::command]
pub fn save_audit_cache(results: Vec<AuditResult>) -> Result<(), String> {
    let mut cache = load_cache();
    cache.audit_results = Some(results);
    cache.audit_timestamp = Some(get_current_timestamp());
    save_cache(&cache)
}

#[tauri::command]
pub fn save_dep_analysis_cache(analysis: DepAnalysis) -> Result<(), String> {
    let mut cache = load_cache();
    cache.dep_analysis = Some(analysis);
    cache.dep_analysis_timestamp = Some(get_current_timestamp());
    save_cache(&cache)
}

#[tauri::command]
pub fn save_toolchain_cache(analysis: ToolchainAnalysis) -> Result<(), String> {
    let mut cache = load_cache();
    cache.toolchain_analysis = Some(analysis);
    cache.toolchain_timestamp = Some(get_current_timestamp());
    save_cache(&cache)
}

#[tauri::command]
pub fn save_license_cache(analysis: LicenseAnalysis) -> Result<(), String> {
    let mut cache = load_cache();
    cache.license_analysis = Some(analysis);
    cache.license_timestamp = Some(get_current_timestamp());
    save_cache(&cache)
}

// ============ Required Tools ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolStatus {
    pub name: String,
    pub command: String,
    pub installed: bool,
    pub install_cmd: String,
    pub description: String,
}

fn check_tool_installed(_command: &str, subcommand: &str) -> bool {
    Command::new("cargo")
        .args([subcommand, "--help"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn check_required_tools() -> Vec<ToolStatus> {
    vec![
        ToolStatus {
            name: "cargo-outdated".to_string(),
            command: "outdated".to_string(),
            installed: check_tool_installed("cargo", "outdated"),
            install_cmd: "cargo install cargo-outdated".to_string(),
            description: "Check for outdated dependencies".to_string(),
        },
        ToolStatus {
            name: "cargo-edit".to_string(),
            command: "upgrade".to_string(),
            installed: check_tool_installed("cargo", "upgrade"),
            install_cmd: "cargo install cargo-edit".to_string(),
            description: "Upgrade dependencies in Cargo.toml".to_string(),
        },
        ToolStatus {
            name: "cargo-audit".to_string(),
            command: "audit".to_string(),
            installed: check_tool_installed("cargo", "audit"),
            install_cmd: "cargo install cargo-audit".to_string(),
            description: "Security vulnerability scanner".to_string(),
        },
        ToolStatus {
            name: "cargo-license".to_string(),
            command: "license".to_string(),
            installed: check_tool_installed("cargo", "license"),
            install_cmd: "cargo install cargo-license".to_string(),
            description: "Check dependency licenses".to_string(),
        },
        ToolStatus {
            name: "cargo-bloat".to_string(),
            command: "bloat".to_string(),
            installed: check_tool_installed("cargo", "bloat"),
            install_cmd: "cargo install cargo-bloat".to_string(),
            description: "Analyze binary size and bloat".to_string(),
        },
        ToolStatus {
            name: "cargo-tarpaulin".to_string(),
            command: "tarpaulin".to_string(),
            installed: check_tool_installed("cargo", "tarpaulin"),
            install_cmd: "cargo install cargo-tarpaulin".to_string(),
            description: "Code coverage reporting".to_string(),
        },
    ]
}

#[tauri::command]
pub async fn install_tool(install_cmd: String) -> CargoCommandResult {
    tokio::task::spawn_blocking(move || {
        let parts: Vec<&str> = install_cmd.split_whitespace().collect();
        if parts.len() < 3 || parts[0] != "cargo" || parts[1] != "install" {
            return CargoCommandResult {
                project_path: String::new(),
                command: install_cmd,
                success: false,
                stdout: String::new(),
                stderr: "Invalid install command".to_string(),
                exit_code: Some(1),
            };
        }

        let output = Command::new("cargo").args(&parts[1..]).output();

        match output {
            Ok(output) => CargoCommandResult {
                project_path: String::new(),
                command: install_cmd,
                success: output.status.success(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code(),
            },
            Err(e) => CargoCommandResult {
                project_path: String::new(),
                command: install_cmd,
                success: false,
                stdout: String::new(),
                stderr: e.to_string(),
                exit_code: Some(1),
            },
        }
    })
    .await
    .unwrap_or_else(|_| CargoCommandResult {
        project_path: String::new(),
        command: String::new(),
        success: false,
        stdout: String::new(),
        stderr: "Task failed".to_string(),
        exit_code: Some(1),
    })
}

#[tauri::command]
pub fn read_cargo_toml(project_path: String) -> Result<String, String> {
    let path = PathBuf::from(&project_path).join("Cargo.toml");
    fs::read_to_string(&path).map_err(|e| format!("Failed to read Cargo.toml: {}", e))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    pub remote_url: Option<String>,
    pub github_url: Option<String>,
    pub commit_count: u32,
}

#[tauri::command]
pub fn get_git_info(project_path: String) -> GitInfo {
    let path = PathBuf::from(&project_path);

    // Get remote URL
    let remote_url = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&path)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    // Convert to GitHub HTTPS URL if it's a git URL
    let github_url = remote_url.as_ref().and_then(|url| {
        if url.contains("github.com") {
            let clean = url
                .replace("git@github.com:", "https://github.com/")
                .replace(".git", "");
            Some(clean)
        } else {
            None
        }
    });

    // Get commit count
    let commit_count = Command::new("git")
        .args(["rev-list", "--count", "HEAD"])
        .current_dir(&path)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8_lossy(&o.stdout)
                    .trim()
                    .parse::<u32>()
                    .ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    GitInfo {
        remote_url,
        github_url,
        commit_count,
    }
}

#[tauri::command]
pub fn open_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open Finder: {}", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocResult {
    pub success: bool,
    pub doc_path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn generate_docs(project_path: String) -> DocResult {
    let path = PathBuf::from(&project_path);

    // Run cargo doc
    let output = tokio::task::spawn_blocking(move || {
        Command::new("cargo")
            .args(["doc", "--no-deps", "--quiet"])
            .current_dir(&path)
            .output()
    })
    .await
    .ok()
    .and_then(|r| r.ok());

    match output {
        Some(output) if output.status.success() => {
            // Find the doc path - it's in target/doc/<crate_name>/index.html
            // The crate name is derived from Cargo.toml package name with hyphens replaced by underscores
            let cargo_toml_path = PathBuf::from(&project_path).join("Cargo.toml");
            let crate_name = fs::read_to_string(&cargo_toml_path)
                .ok()
                .and_then(|content| content.parse::<toml::Table>().ok())
                .and_then(|table| {
                    table
                        .get("package")
                        .and_then(|p| p.get("name"))
                        .and_then(|n| n.as_str())
                        .map(|s| s.replace("-", "_"))
                });

            if let Some(name) = crate_name {
                let doc_path = PathBuf::from(&project_path)
                    .join("target")
                    .join("doc")
                    .join(&name)
                    .join("index.html");

                if doc_path.exists() {
                    return DocResult {
                        success: true,
                        doc_path: Some(doc_path.to_string_lossy().to_string()),
                        error: None,
                    };
                }
            }

            DocResult {
                success: true,
                doc_path: None,
                error: Some("Documentation generated but index.html not found".to_string()),
            }
        }
        Some(output) => DocResult {
            success: false,
            doc_path: None,
            error: Some(String::from_utf8_lossy(&output.stderr).to_string()),
        },
        None => DocResult {
            success: false,
            doc_path: None,
            error: Some("Failed to run cargo doc".to_string()),
        },
    }
}

// === New Features ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CargoFeature {
    pub name: String,
    pub dependencies: Vec<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CargoFeatures {
    pub features: Vec<CargoFeature>,
    pub default_features: Vec<String>,
}

#[tauri::command]
pub fn get_cargo_features(project_path: String) -> Result<CargoFeatures, String> {
    let path = PathBuf::from(&project_path).join("Cargo.toml");
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let table: toml::Table = content
        .parse()
        .map_err(|e: toml::de::Error| e.to_string())?;

    let mut features = Vec::new();
    let mut default_features = Vec::new();

    if let Some(features_table) = table.get("features").and_then(|f| f.as_table()) {
        // Get default features first
        if let Some(default) = features_table.get("default").and_then(|d| d.as_array()) {
            default_features = default
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
        }

        for (name, deps) in features_table {
            if name == "default" {
                continue;
            }
            let dependencies = deps
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            features.push(CargoFeature {
                name: name.clone(),
                dependencies,
                is_default: default_features.contains(name),
            });
        }
    }

    // Sort features alphabetically
    features.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(CargoFeatures {
        features,
        default_features,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinarySizes {
    pub debug: Option<u64>,
    pub release: Option<u64>,
    pub binaries: Vec<BinaryInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryInfo {
    pub name: String,
    pub debug_size: Option<u64>,
    pub release_size: Option<u64>,
}

#[tauri::command]
pub fn get_binary_sizes(project_path: String) -> BinarySizes {
    let path = PathBuf::from(&project_path);
    let debug_dir = path.join("target").join("debug");
    let release_dir = path.join("target").join("release");

    // Get crate name from Cargo.toml
    let cargo_toml_path = path.join("Cargo.toml");
    let crate_name = fs::read_to_string(&cargo_toml_path)
        .ok()
        .and_then(|content| content.parse::<toml::Table>().ok())
        .and_then(|table| {
            table
                .get("package")
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .map(String::from)
        });

    let mut binaries = Vec::new();

    if let Some(name) = &crate_name {
        let debug_binary = debug_dir.join(name);
        let release_binary = release_dir.join(name);

        let debug_size = fs::metadata(&debug_binary).ok().map(|m| m.len());
        let release_size = fs::metadata(&release_binary).ok().map(|m| m.len());

        binaries.push(BinaryInfo {
            name: name.clone(),
            debug_size,
            release_size,
        });
    }

    // Also check for additional binaries in src/bin/
    let bin_dir = path.join("src").join("bin");
    if bin_dir.exists() {
        if let Ok(entries) = fs::read_dir(&bin_dir) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let name = file_name.to_string_lossy();
                if name.ends_with(".rs") {
                    let bin_name = name.trim_end_matches(".rs");
                    let debug_binary = debug_dir.join(bin_name);
                    let release_binary = release_dir.join(bin_name);

                    binaries.push(BinaryInfo {
                        name: bin_name.to_string(),
                        debug_size: fs::metadata(&debug_binary).ok().map(|m| m.len()),
                        release_size: fs::metadata(&release_binary).ok().map(|m| m.len()),
                    });
                }
            }
        }
    }

    let debug_total = binaries.iter().filter_map(|b| b.debug_size).sum();
    let release_total = binaries.iter().filter_map(|b| b.release_size).sum();

    BinarySizes {
        debug: if debug_total > 0 {
            Some(debug_total)
        } else {
            None
        },
        release: if release_total > 0 {
            Some(release_total)
        } else {
            None
        },
        binaries,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsrvInfo {
    pub msrv: Option<String>,
    pub rust_version: Option<String>,
    pub edition: Option<String>,
}

#[tauri::command]
pub fn get_msrv(project_path: String) -> MsrvInfo {
    let path = PathBuf::from(&project_path).join("Cargo.toml");
    let content = fs::read_to_string(&path).ok();

    content
        .and_then(|c| c.parse::<toml::Table>().ok())
        .map(|table| {
            let package = table.get("package").and_then(|p| p.as_table());
            MsrvInfo {
                msrv: package
                    .and_then(|p| p.get("rust-version"))
                    .and_then(|v| v.as_str())
                    .map(String::from),
                rust_version: package
                    .and_then(|p| p.get("rust-version"))
                    .and_then(|v| v.as_str())
                    .map(String::from),
                edition: package
                    .and_then(|p| p.get("edition"))
                    .and_then(|v| v.as_str())
                    .map(String::from),
            }
        })
        .unwrap_or(MsrvInfo {
            msrv: None,
            rust_version: None,
            edition: None,
        })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub is_workspace: bool,
    pub members: Vec<WorkspaceMember>,
    pub root_path: Option<String>,
    pub is_member_of_workspace: bool,
    pub parent_workspace_path: Option<String>,
    pub parent_workspace_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceMember {
    pub name: String,
    pub path: String,
    pub is_current: bool,
}

// Helper to find parent workspace by walking up directories
fn find_parent_workspace(project_path: &PathBuf) -> Option<(String, String)> {
    let mut current = project_path.parent()?;

    while current.parent().is_some() {
        let cargo_toml = current.join("Cargo.toml");
        if cargo_toml.exists() {
            if let Ok(content) = fs::read_to_string(&cargo_toml) {
                if let Ok(table) = content.parse::<toml::Table>() {
                    if let Some(workspace) = table.get("workspace").and_then(|w| w.as_table()) {
                        if let Some(members) = workspace.get("members").and_then(|m| m.as_array()) {
                            // Check if any member pattern matches this project
                            for member in members.iter().filter_map(|m| m.as_str()) {
                                if member.contains('*') {
                                    // Glob pattern
                                    if let Ok(paths) =
                                        glob::glob(&current.join(member).to_string_lossy())
                                    {
                                        for path in paths.flatten() {
                                            if path == *project_path {
                                                let name = current
                                                    .file_name()
                                                    .map(|n| n.to_string_lossy().to_string())
                                                    .unwrap_or_else(|| "workspace".to_string());
                                                return Some((
                                                    current.to_string_lossy().to_string(),
                                                    name,
                                                ));
                                            }
                                        }
                                    }
                                } else {
                                    // Direct path
                                    let member_path = current.join(member);
                                    if member_path == *project_path {
                                        let name = current
                                            .file_name()
                                            .map(|n| n.to_string_lossy().to_string())
                                            .unwrap_or_else(|| "workspace".to_string());
                                        return Some((current.to_string_lossy().to_string(), name));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        current = current.parent()?;
    }
    None
}

#[tauri::command]
pub fn get_workspace_info(project_path: String) -> WorkspaceInfo {
    let path = PathBuf::from(&project_path);
    let cargo_toml = path.join("Cargo.toml");

    // Check for parent workspace first
    let parent_workspace = find_parent_workspace(&path);

    let content = fs::read_to_string(&cargo_toml).ok();
    let table = content.and_then(|c| c.parse::<toml::Table>().ok());

    if let Some(table) = table {
        // Check if this is a workspace root
        if let Some(workspace) = table.get("workspace").and_then(|w| w.as_table()) {
            if let Some(members) = workspace.get("members").and_then(|m| m.as_array()) {
                let member_list: Vec<WorkspaceMember> = members
                    .iter()
                    .filter_map(|m| m.as_str())
                    .flat_map(|pattern| {
                        // Handle glob patterns
                        if pattern.contains('*') {
                            glob::glob(&path.join(pattern).to_string_lossy())
                                .ok()
                                .map(|paths| {
                                    paths
                                        .flatten()
                                        .filter_map(|p| {
                                            let member_cargo = p.join("Cargo.toml");
                                            if member_cargo.exists() {
                                                let name = fs::read_to_string(&member_cargo)
                                                    .ok()
                                                    .and_then(|c| c.parse::<toml::Table>().ok())
                                                    .and_then(|t| {
                                                        t.get("package")
                                                            .and_then(|p| p.get("name"))
                                                            .and_then(|n| n.as_str())
                                                            .map(String::from)
                                                    })
                                                    .unwrap_or_else(|| {
                                                        p.file_name()
                                                            .map(|n| {
                                                                n.to_string_lossy().to_string()
                                                            })
                                                            .unwrap_or_default()
                                                    });
                                                Some(WorkspaceMember {
                                                    name,
                                                    path: p.to_string_lossy().to_string(),
                                                    is_current: p == path,
                                                })
                                            } else {
                                                None
                                            }
                                        })
                                        .collect::<Vec<_>>()
                                })
                                .unwrap_or_default()
                        } else {
                            let member_path = path.join(pattern);
                            let member_cargo = member_path.join("Cargo.toml");
                            if member_cargo.exists() {
                                let name = fs::read_to_string(&member_cargo)
                                    .ok()
                                    .and_then(|c| c.parse::<toml::Table>().ok())
                                    .and_then(|t| {
                                        t.get("package")
                                            .and_then(|p| p.get("name"))
                                            .and_then(|n| n.as_str())
                                            .map(String::from)
                                    })
                                    .unwrap_or_else(|| pattern.to_string());
                                vec![WorkspaceMember {
                                    name,
                                    path: member_path.to_string_lossy().to_string(),
                                    is_current: member_path == path,
                                }]
                            } else {
                                vec![]
                            }
                        }
                    })
                    .collect();

                return WorkspaceInfo {
                    is_workspace: true,
                    members: member_list,
                    root_path: Some(project_path),
                    is_member_of_workspace: false,
                    parent_workspace_path: None,
                    parent_workspace_name: None,
                };
            }
        }
    }

    WorkspaceInfo {
        is_workspace: false,
        members: vec![],
        root_path: None,
        is_member_of_workspace: parent_workspace.is_some(),
        parent_workspace_path: parent_workspace.as_ref().map(|(p, _)| p.clone()),
        parent_workspace_name: parent_workspace.map(|(_, n)| n),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubActionsStatus {
    pub has_workflows: bool,
    pub workflows: Vec<String>,
    pub badge_url: Option<String>,
}

#[tauri::command]
pub fn get_github_actions_status(project_path: String) -> GitHubActionsStatus {
    let path = PathBuf::from(&project_path);
    let workflows_dir = path.join(".github").join("workflows");

    if !workflows_dir.exists() {
        return GitHubActionsStatus {
            has_workflows: false,
            workflows: vec![],
            badge_url: None,
        };
    }

    let workflows: Vec<String> = fs::read_dir(&workflows_dir)
        .ok()
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.ends_with(".yml") || name.ends_with(".yaml") {
                        Some(name)
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    // Try to get GitHub URL for badge
    let git_info = get_git_info(project_path);
    let badge_url = git_info.github_url.map(|url| {
        let repo = url.replace("https://github.com/", "");
        format!(
            "https://github.com/{}/actions/workflows/ci.yml/badge.svg",
            repo
        )
    });

    GitHubActionsStatus {
        has_workflows: !workflows.is_empty(),
        workflows,
        badge_url,
    }
}

#[tauri::command]
pub fn open_in_vscode(project_path: String) -> Result<(), String> {
    Command::new("code")
        .arg(&project_path)
        .spawn()
        .map_err(|e| format!("Failed to open VS Code: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn open_file_in_vscode(file_path: String, line_number: u32) -> Result<(), String> {
    // VS Code supports --goto file:line:column
    let location = format!("{}:{}", file_path, line_number);
    Command::new("code")
        .args(["--goto", &location])
        .spawn()
        .map_err(|e| format!("Failed to open VS Code: {}", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustVersionInfo {
    pub rustc_version: Option<String>,
    pub cargo_version: Option<String>,
    pub default_toolchain: Option<String>,
    pub installed_toolchains: Vec<String>,
    pub active_toolchain: Option<String>,
}

#[tauri::command]
pub fn get_rust_version_info() -> RustVersionInfo {
    // Get rustc version
    let rustc_version = Command::new("rustc")
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string());

    // Get cargo version
    let cargo_version = Command::new("cargo")
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string());

    // Get installed toolchains
    let toolchains_output = Command::new("rustup")
        .args(["toolchain", "list"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok());

    let mut installed_toolchains = Vec::new();
    let mut default_toolchain = None;
    let mut active_toolchain = None;

    if let Some(output) = toolchains_output {
        for line in output.lines() {
            let is_default = line.contains("(default)");
            let is_active = line.contains("(active)") || line.contains("(default)");
            let name = line
                .replace("(default)", "")
                .replace("(active)", "")
                .trim()
                .to_string();

            if !name.is_empty() {
                if is_default {
                    default_toolchain = Some(name.clone());
                }
                if is_active {
                    active_toolchain = Some(name.clone());
                }
                installed_toolchains.push(name);
            }
        }
    }

    RustVersionInfo {
        rustc_version,
        cargo_version,
        default_toolchain,
        installed_toolchains,
        active_toolchain,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextLine {
    pub line_number: u32,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub project_path: String,
    pub project_name: String,
    pub file_path: String,
    pub line_number: u32,
    pub line_content: String,
    pub matches: Vec<SearchMatch>,
    pub context_before: Vec<ContextLine>,
    pub context_after: Vec<ContextLine>,
}

#[tauri::command]
pub async fn global_search(query: String, scan_root: Option<String>) -> Vec<SearchResult> {
    // Require minimum 2 characters to prevent massive result sets
    if query.trim().len() < 2 {
        return Vec::new();
    }

    let root = scan_root.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    let mut results = Vec::new();
    const MAX_RESULTS: usize = 500; // Limit total results to prevent UI freezing

    // Use ripgrep with context lines
    let rg_output = Command::new("rg")
        .args([
            "--json",
            "--max-count",
            "50",
            "--type",
            "rust",
            "-C",
            "1", // 1 line of context before and after
            &query,
            &root,
        ])
        .output()
        .ok();

    if let Some(output) = rg_output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);

            // Collect all lines grouped by file and match
            let mut current_match: Option<SearchResult> = None;
            let mut pending_context: Vec<ContextLine> = Vec::new();

            for line in stdout.lines() {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                    let msg_type = json.get("type").and_then(|t| t.as_str()).unwrap_or("");

                    match msg_type {
                        "context" => {
                            if let Some(data) = json.get("data") {
                                let line_number = data
                                    .get("line_number")
                                    .and_then(|n| n.as_u64())
                                    .unwrap_or(0) as u32;
                                let content = data
                                    .get("lines")
                                    .and_then(|l| l.get("text"))
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("")
                                    .trim_end()
                                    .to_string();

                                let ctx = ContextLine {
                                    line_number,
                                    content,
                                };

                                // If we have a current match, this is context_after
                                if let Some(ref mut m) = current_match {
                                    if line_number > m.line_number {
                                        m.context_after.push(ctx);
                                    }
                                } else {
                                    // This is context_before for the next match
                                    pending_context.push(ctx);
                                }
                            }
                        }
                        "match" => {
                            // Save previous match if any
                            if let Some(m) = current_match.take() {
                                results.push(m);
                                if results.len() >= MAX_RESULTS {
                                    return results;
                                }
                            }

                            if let Some(data) = json.get("data") {
                                let file_path = data
                                    .get("path")
                                    .and_then(|p| p.get("text"))
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("");

                                // Find the project root
                                let mut project_path = PathBuf::from(file_path);
                                let mut project_name = String::new();
                                while project_path.pop() {
                                    if project_path.join("Cargo.toml").exists() {
                                        project_name = project_path
                                            .file_name()
                                            .map(|n| n.to_string_lossy().to_string())
                                            .unwrap_or_default();
                                        break;
                                    }
                                }

                                let line_content = data
                                    .get("lines")
                                    .and_then(|l| l.get("text"))
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("")
                                    .trim_end()
                                    .to_string();

                                let line_number = data
                                    .get("line_number")
                                    .and_then(|n| n.as_u64())
                                    .unwrap_or(0) as u32;

                                // Extract match positions from submatches
                                let matches: Vec<SearchMatch> = data
                                    .get("submatches")
                                    .and_then(|s| s.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|m| {
                                                let start =
                                                    m.get("start").and_then(|s| s.as_u64())? as u32;
                                                let end =
                                                    m.get("end").and_then(|e| e.as_u64())? as u32;
                                                Some(SearchMatch { start, end })
                                            })
                                            .collect()
                                    })
                                    .unwrap_or_default();

                                // Filter pending context to only lines before this match
                                let context_before: Vec<ContextLine> = pending_context
                                    .drain(..)
                                    .filter(|c| c.line_number < line_number)
                                    .collect();

                                current_match = Some(SearchResult {
                                    project_path: project_path.to_string_lossy().to_string(),
                                    project_name,
                                    file_path: file_path.to_string(),
                                    line_number,
                                    line_content,
                                    matches,
                                    context_before,
                                    context_after: Vec::new(),
                                });
                            }
                        }
                        "end" => {
                            // End of results for a file, save current match
                            if let Some(m) = current_match.take() {
                                results.push(m);
                                if results.len() >= MAX_RESULTS {
                                    return results;
                                }
                            }
                            pending_context.clear();
                        }
                        _ => {}
                    }
                }
            }

            // Don't forget the last match
            if let Some(m) = current_match {
                if results.len() < MAX_RESULTS {
                    results.push(m);
                }
            }
        }
    }

    // Truncate to MAX_RESULTS if somehow exceeded
    results.truncate(MAX_RESULTS);
    results
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomebrewStatus {
    pub installed_via_homebrew: bool,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub formula_name: Option<String>,
}

#[tauri::command]
pub fn check_homebrew_status() -> HomebrewStatus {
    // Check if brew is available
    let brew_check = Command::new("brew").arg("--version").output();
    if brew_check.is_err() {
        return HomebrewStatus {
            installed_via_homebrew: false,
            current_version: None,
            latest_version: None,
            update_available: false,
            formula_name: None,
        };
    }

    // Check if rust-helper is installed via homebrew
    // Try both possible formula names
    let formula_names = ["rust-helper", "thrashr888/tap/rust-helper"];

    for formula in &formula_names {
        let info_output = Command::new("brew")
            .args(["info", formula, "--json=v2"])
            .output();

        if let Ok(output) = info_output {
            if output.status.success() {
                let json_str = String::from_utf8_lossy(&output.stdout);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    // Extract current installed version
                    let current_version = json
                        .get("formulae")
                        .and_then(|f| f.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|formula| {
                            formula
                                .get("installed")
                                .and_then(|i| i.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|v| v.get("version"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        });

                    // Extract latest version
                    let latest_version = json
                        .get("formulae")
                        .and_then(|f| f.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|formula| {
                            formula
                                .get("versions")
                                .and_then(|v| v.get("stable"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        });

                    if current_version.is_some() {
                        let update_available = match (&current_version, &latest_version) {
                            (Some(current), Some(latest)) => current != latest,
                            _ => false,
                        };

                        return HomebrewStatus {
                            installed_via_homebrew: true,
                            current_version,
                            latest_version,
                            update_available,
                            formula_name: Some(formula.to_string()),
                        };
                    }
                }
            }
        }
    }

    HomebrewStatus {
        installed_via_homebrew: false,
        current_version: None,
        latest_version: None,
        update_available: false,
        formula_name: None,
    }
}

#[tauri::command]
pub async fn upgrade_homebrew(formula_name: String) -> Result<String, String> {
    // First update homebrew
    let update_output = Command::new("brew")
        .arg("update")
        .output()
        .map_err(|e| e.to_string())?;

    if !update_output.status.success() {
        return Err(String::from_utf8_lossy(&update_output.stderr).to_string());
    }

    // Then upgrade the formula
    let upgrade_output = Command::new("brew")
        .args(["upgrade", &formula_name])
        .output()
        .map_err(|e| e.to_string())?;

    if upgrade_output.status.success() {
        Ok(format!(
            "Successfully upgraded {}. Please restart the app.",
            formula_name
        ))
    } else {
        Err(String::from_utf8_lossy(&upgrade_output.stderr).to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustHomebrewStatus {
    pub installed_via_homebrew: bool,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
}

#[tauri::command]
pub fn check_rust_homebrew_status() -> RustHomebrewStatus {
    // First check if rustc shows "(Homebrew)" in its version
    let rustc_output = Command::new("rustc")
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string());

    let is_homebrew = rustc_output
        .as_ref()
        .map(|v| v.contains("(Homebrew)"))
        .unwrap_or(false);

    if !is_homebrew {
        return RustHomebrewStatus {
            installed_via_homebrew: false,
            current_version: None,
            latest_version: None,
            update_available: false,
        };
    }

    // Extract current version from rustc output (e.g., "rustc 1.92.0 (hash) (Homebrew)")
    let current_version = rustc_output
        .as_ref()
        .and_then(|v| v.split_whitespace().nth(1).map(|s| s.to_string()));

    // Check brew info for latest version
    let brew_output = Command::new("brew")
        .args(["info", "rust", "--json=v2"])
        .output();

    let latest_version = brew_output.ok().and_then(|output| {
        if output.status.success() {
            let json_str = String::from_utf8_lossy(&output.stdout);
            serde_json::from_str::<serde_json::Value>(&json_str)
                .ok()
                .and_then(|json| {
                    json.get("formulae")
                        .and_then(|f| f.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|formula| {
                            formula
                                .get("versions")
                                .and_then(|v| v.get("stable"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        })
                })
        } else {
            None
        }
    });

    let update_available = match (&current_version, &latest_version) {
        (Some(current), Some(latest)) => current != latest,
        _ => false,
    };

    RustHomebrewStatus {
        installed_via_homebrew: true,
        current_version,
        latest_version,
        update_available,
    }
}

#[tauri::command]
pub async fn upgrade_rust_homebrew() -> Result<String, String> {
    // First update homebrew
    let update_output = Command::new("brew")
        .arg("update")
        .output()
        .map_err(|e| e.to_string())?;

    if !update_output.status.success() {
        return Err(String::from_utf8_lossy(&update_output.stderr).to_string());
    }

    // Then upgrade rust
    let upgrade_output = Command::new("brew")
        .args(["upgrade", "rust"])
        .output()
        .map_err(|e| e.to_string())?;

    if upgrade_output.status.success() {
        Ok("Successfully upgraded Rust. Restart your terminal to use the new version.".to_string())
    } else {
        Err(String::from_utf8_lossy(&upgrade_output.stderr).to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloatCrate {
    pub name: String,
    pub size: u64,
    pub size_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloatFunction {
    pub name: String,
    pub size: u64,
    pub size_percent: f64,
    pub crate_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloatAnalysis {
    pub file_size: u64,
    pub text_size: u64,
    pub crates: Vec<BloatCrate>,
    pub functions: Vec<BloatFunction>,
}

#[tauri::command]
pub async fn analyze_bloat(project_path: String, release: bool) -> Result<BloatAnalysis, String> {
    tokio::task::spawn_blocking(move || {
        // First check if cargo-bloat is installed
        let check = Command::new("cargo")
            .args(["bloat", "--version"])
            .output();

        if check.is_err() || !check.unwrap().status.success() {
            return Err(
                "cargo-bloat is not installed. Install with: cargo install cargo-bloat".to_string(),
            );
        }

        // Run cargo-bloat for crates (it builds automatically)
        let mut bloat_args = vec!["bloat", "--crates", "--message-format", "json", "-n", "50"];
        if release {
            bloat_args.push("--release");
        }

        let crates_output = Command::new("cargo")
            .args(&bloat_args)
            .current_dir(&project_path)
            .output()
            .map_err(|e| e.to_string())?;

        if !crates_output.status.success() {
            return Err(format!(
                "cargo-bloat failed: {}",
                String::from_utf8_lossy(&crates_output.stderr)
            ));
        }

        // Parse crates JSON
        let crates_json: serde_json::Value =
            serde_json::from_slice(&crates_output.stdout).map_err(|e| e.to_string())?;

        let file_size = crates_json
            .get("file-size")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let text_size = crates_json
            .get("text-section-size")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let crates: Vec<BloatCrate> = crates_json
            .get("crates")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        let size = c.get("size")?.as_u64()?;
                        let size_percent = if text_size > 0 {
                            (size as f64 / text_size as f64) * 100.0
                        } else {
                            0.0
                        };
                        Some(BloatCrate {
                            name: c.get("name")?.as_str()?.to_string(),
                            size,
                            size_percent,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Run cargo-bloat for functions
        let mut fn_args = vec!["bloat", "--message-format", "json", "-n", "30"];
        if release {
            fn_args.push("--release");
        }

        let fn_output = Command::new("cargo")
            .args(&fn_args)
            .current_dir(&project_path)
            .output()
            .map_err(|e| e.to_string())?;

        let functions: Vec<BloatFunction> = if fn_output.status.success() {
            let fn_json: serde_json::Value =
                serde_json::from_slice(&fn_output.stdout).unwrap_or_default();

            fn_json
                .get("functions")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|f| {
                            let size = f.get("size")?.as_u64()?;
                            let size_percent = if text_size > 0 {
                                (size as f64 / text_size as f64) * 100.0
                            } else {
                                0.0
                            };
                            Some(BloatFunction {
                                name: f.get("name")?.as_str()?.to_string(),
                                size,
                                size_percent,
                                crate_name: f
                                    .get("crate")
                                    .and_then(|c| c.as_str())
                                    .map(String::from),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        Ok(BloatAnalysis {
            file_size,
            text_size,
            crates,
            functions,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn run_cargo_tarpaulin(project_path: String) -> Result<String, String> {
    // Check if cargo-tarpaulin is installed
    let check = Command::new("cargo")
        .args(["tarpaulin", "--version"])
        .output();

    if check.is_err() || !check.unwrap().status.success() {
        return Err(
            "cargo-tarpaulin is not installed. Install with: cargo install cargo-tarpaulin"
                .to_string(),
        );
    }

    // Run tarpaulin
    let output = Command::new("cargo")
        .args(["tarpaulin", "--out", "Json", "--output-dir", "target"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        // Read the JSON output file
        let json_path = PathBuf::from(&project_path)
            .join("target")
            .join("tarpaulin-report.json");

        if json_path.exists() {
            fs::read_to_string(&json_path).map_err(|e| e.to_string())
        } else {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        }
    } else {
        Err(format!(
            "cargo-tarpaulin failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
