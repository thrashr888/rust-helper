//! App configuration and cache management
//!
//! This module handles persistent configuration (favorites, hidden, scan root)
//! and cached analysis results (outdated, audit, deps, toolchains, licenses).

use std::fs;
use std::path::PathBuf;

use super::{AppConfig, ScanCache};

// ============ Path Helpers ============

pub fn get_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rust-helper")
        .join("config.json")
}

pub fn get_cache_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rust-helper")
        .join("cache.json")
}

// ============ Config Operations ============

pub fn load_config() -> AppConfig {
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

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ============ Cache Operations ============

pub fn load_cache() -> ScanCache {
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

pub fn save_cache(cache: &ScanCache) -> Result<(), String> {
    let path = get_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ============ Timestamp Helper ============

pub fn get_current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_config_path() {
        let path = get_config_path();
        assert!(path.to_string_lossy().contains("rust-helper"));
        assert!(path.to_string_lossy().contains("config.json"));
    }

    #[test]
    fn test_get_cache_path() {
        let path = get_cache_path();
        assert!(path.to_string_lossy().contains("rust-helper"));
        assert!(path.to_string_lossy().contains("cache.json"));
    }

    #[test]
    fn test_get_current_timestamp() {
        let ts = get_current_timestamp();
        // Should be after 2024
        assert!(ts > 1700000000);
    }

    #[test]
    fn test_app_config_default() {
        let config = AppConfig::default();
        assert!(config.favorites.is_empty());
        assert!(config.hidden.is_empty());
        assert!(config.scan_root.is_none());
        assert!(config.recent_projects.is_empty());
        assert!(config.preferred_ide.is_none());
    }

    #[test]
    fn test_scan_cache_default() {
        let cache = ScanCache::default();
        assert!(cache.outdated_results.is_none());
        assert!(cache.outdated_timestamp.is_none());
        assert!(cache.audit_results.is_none());
        assert!(cache.audit_timestamp.is_none());
    }
}
