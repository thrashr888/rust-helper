use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
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
