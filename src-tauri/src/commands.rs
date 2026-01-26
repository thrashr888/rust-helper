use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;
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
}

fn get_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rust-helper")
        .join("config.json")
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

#[tauri::command]
pub fn scan_projects(root_path: String) -> Vec<Project> {
    let mut projects = Vec::new();
    let workspace_members = find_workspace_roots(&root_path);

    for entry in WalkDir::new(&root_path)
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

    // Run cargo outdated with JSON output
    let output = Command::new("cargo")
        .args(["outdated", "--format", "json"])
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
pub fn check_all_outdated(project_paths: Vec<String>) -> Vec<OutdatedResult> {
    project_paths.into_iter().map(check_outdated).collect()
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
pub fn check_all_audits(project_paths: Vec<String>) -> Vec<AuditResult> {
    project_paths.into_iter().map(check_audit).collect()
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

#[tauri::command]
pub fn run_cargo_command(
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

// Convenience commands for common operations
#[tauri::command]
pub fn run_cargo_fmt_check(project_path: String) -> CargoCommandResult {
    run_cargo_command(
        project_path,
        "fmt".to_string(),
        vec!["--".to_string(), "--check".to_string()],
    )
}

#[tauri::command]
pub fn run_cargo_clippy(project_path: String) -> CargoCommandResult {
    run_cargo_command(
        project_path,
        "clippy".to_string(),
        vec!["--".to_string(), "-D".to_string(), "warnings".to_string()],
    )
}

#[tauri::command]
pub fn run_cargo_test(project_path: String) -> CargoCommandResult {
    run_cargo_command(project_path, "test".to_string(), vec![])
}

#[tauri::command]
pub fn run_cargo_build(project_path: String, release: bool) -> CargoCommandResult {
    let args = if release {
        vec!["--release".to_string()]
    } else {
        vec![]
    };
    run_cargo_command(project_path, "build".to_string(), args)
}

#[tauri::command]
pub fn run_cargo_check(project_path: String) -> CargoCommandResult {
    run_cargo_command(project_path, "check".to_string(), vec![])
}

#[tauri::command]
pub fn run_cargo_doc(project_path: String) -> CargoCommandResult {
    run_cargo_command(
        project_path,
        "doc".to_string(),
        vec!["--no-deps".to_string()],
    )
}

#[tauri::command]
pub fn run_cargo_update(project_path: String) -> CargoCommandResult {
    run_cargo_command(project_path, "update".to_string(), vec![])
}

#[tauri::command]
pub fn run_cargo_run(project_path: String, release: bool) -> CargoCommandResult {
    let args = if release {
        vec!["--release".to_string()]
    } else {
        vec![]
    };
    run_cargo_command(project_path, "run".to_string(), args)
}

#[tauri::command]
pub fn run_cargo_bench(project_path: String) -> CargoCommandResult {
    run_cargo_command(project_path, "bench".to_string(), vec![])
}

#[tauri::command]
pub fn run_cargo_tree(project_path: String) -> CargoCommandResult {
    run_cargo_command(project_path, "tree".to_string(), vec![])
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[tauri::command]
pub fn analyze_dependencies(project_paths: Vec<String>) -> DepAnalysis {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[tauri::command]
pub fn analyze_toolchains(project_paths: Vec<String>) -> ToolchainAnalysis {
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
