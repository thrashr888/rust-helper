use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub path: String,
    pub target_size: u64,
    pub dep_count: usize,
}

#[derive(Debug, Deserialize)]
struct CargoToml {
    package: Option<Package>,
    dependencies: Option<toml::Table>,
}

#[derive(Debug, Deserialize)]
struct Package {
    name: Option<String>,
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

fn parse_cargo_toml(path: &Path) -> Option<(String, usize)> {
    let content = fs::read_to_string(path).ok()?;
    let cargo: CargoToml = toml::from_str(&content).ok()?;

    let name = cargo
        .package
        .and_then(|p| p.name)
        .unwrap_or_else(|| "unknown".to_string());

    let dep_count = cargo.dependencies.map(|d| d.len()).unwrap_or(0);

    Some((name, dep_count))
}

#[tauri::command]
pub fn scan_projects(root_path: String) -> Vec<Project> {
    let mut projects = Vec::new();

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

            if let Some((name, dep_count)) = parse_cargo_toml(path) {
                let target_path = project_dir.join("target");
                let target_size = get_dir_size(&target_path);

                projects.push(Project {
                    name,
                    path: project_dir.to_string_lossy().to_string(),
                    target_size,
                    dep_count,
                });
            }
        }
    }

    // Sort by name
    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    projects
}
