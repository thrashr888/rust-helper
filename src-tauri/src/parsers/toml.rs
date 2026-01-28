//! TOML parsing functions for Cargo.toml

use serde::{Deserialize, Serialize};

// ============ Cargo Features ============

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

/// Parse Cargo.toml features table and return structured features info
pub fn parse_cargo_features_toml(table: &toml::Table) -> CargoFeatures {
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

    CargoFeatures {
        features,
        default_features,
    }
}

// ============ MSRV Info ============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MsrvInfo {
    pub msrv: Option<String>,
    pub rust_version: Option<String>,
    pub edition: Option<String>,
}

/// Parse MSRV (Minimum Supported Rust Version) info from Cargo.toml table
pub fn parse_msrv_toml(table: &toml::Table) -> MsrvInfo {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Cargo Features Parser Tests ============

    #[test]
    fn test_parse_cargo_features_toml_basic() {
        let toml_str = r#"
[package]
name = "test-crate"

[features]
default = ["serde"]
serde = ["dep:serde"]
full = ["serde", "async"]
async = []
"#;
        let table: toml::Table = toml_str.parse().unwrap();
        let features = parse_cargo_features_toml(&table);

        assert_eq!(features.default_features, vec!["serde"]);
        assert_eq!(features.features.len(), 3);

        // Features should be sorted alphabetically
        assert_eq!(features.features[0].name, "async");
        assert_eq!(features.features[1].name, "full");
        assert_eq!(features.features[2].name, "serde");

        // Check is_default flag
        assert!(!features.features[0].is_default);
        assert!(!features.features[1].is_default);
        assert!(features.features[2].is_default);
    }

    #[test]
    fn test_parse_cargo_features_toml_no_features() {
        let toml_str = r#"
[package]
name = "test-crate"
"#;
        let table: toml::Table = toml_str.parse().unwrap();
        let features = parse_cargo_features_toml(&table);

        assert!(features.features.is_empty());
        assert!(features.default_features.is_empty());
    }

    #[test]
    fn test_parse_cargo_features_toml_no_default() {
        let toml_str = r#"
[features]
serde = []
async = []
"#;
        let table: toml::Table = toml_str.parse().unwrap();
        let features = parse_cargo_features_toml(&table);

        assert!(features.default_features.is_empty());
        assert_eq!(features.features.len(), 2);
        assert!(!features.features[0].is_default);
        assert!(!features.features[1].is_default);
    }

    #[test]
    fn test_parse_cargo_features_toml_with_dependencies() {
        let toml_str = r#"
[features]
full = ["serde", "tokio", "async-std"]
minimal = []
"#;
        let table: toml::Table = toml_str.parse().unwrap();
        let features = parse_cargo_features_toml(&table);

        let full_feature = features.features.iter().find(|f| f.name == "full").unwrap();
        assert_eq!(full_feature.dependencies.len(), 3);
        assert!(full_feature.dependencies.contains(&"serde".to_string()));
        assert!(full_feature.dependencies.contains(&"tokio".to_string()));
    }

    // ============ MSRV Parser Tests ============

    #[test]
    fn test_parse_msrv_toml_full() {
        let toml_str = r#"
[package]
name = "test-crate"
rust-version = "1.70.0"
edition = "2021"
"#;
        let table: toml::Table = toml_str.parse().unwrap();
        let msrv = parse_msrv_toml(&table);

        assert_eq!(msrv.msrv, Some("1.70.0".to_string()));
        assert_eq!(msrv.rust_version, Some("1.70.0".to_string()));
        assert_eq!(msrv.edition, Some("2021".to_string()));
    }

    #[test]
    fn test_parse_msrv_toml_no_rust_version() {
        let toml_str = r#"
[package]
name = "test-crate"
edition = "2018"
"#;
        let table: toml::Table = toml_str.parse().unwrap();
        let msrv = parse_msrv_toml(&table);

        assert!(msrv.msrv.is_none());
        assert!(msrv.rust_version.is_none());
        assert_eq!(msrv.edition, Some("2018".to_string()));
    }

    #[test]
    fn test_parse_msrv_toml_no_package() {
        let toml_str = r#"
[workspace]
members = ["crate-a", "crate-b"]
"#;
        let table: toml::Table = toml_str.parse().unwrap();
        let msrv = parse_msrv_toml(&table);

        assert!(msrv.msrv.is_none());
        assert!(msrv.rust_version.is_none());
        assert!(msrv.edition.is_none());
    }

    #[test]
    fn test_parse_msrv_toml_empty() {
        let table = toml::Table::new();
        let msrv = parse_msrv_toml(&table);

        assert!(msrv.msrv.is_none());
        assert!(msrv.rust_version.is_none());
        assert!(msrv.edition.is_none());
    }
}
