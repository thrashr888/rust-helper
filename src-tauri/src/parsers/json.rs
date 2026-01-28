//! JSON parsing functions for cargo and brew outputs

use serde::{Deserialize, Serialize};

// ============ Outdated Dependencies ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutdatedDep {
    pub name: String,
    pub current: String,
    pub latest: String,
    pub kind: String,
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

/// Parse cargo outdated JSON output and return list of outdated dependencies
pub fn parse_cargo_outdated_json(json_str: &str) -> Result<Vec<OutdatedDep>, String> {
    let parsed: CargoOutdatedOutput =
        serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {}", e))?;

    Ok(parsed
        .dependencies
        .into_iter()
        .filter(|d| d.project != d.latest)
        .map(|d| OutdatedDep {
            name: d.name,
            current: d.project,
            latest: d.latest,
            kind: d.kind.unwrap_or_else(|| "Normal".to_string()),
        })
        .collect())
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

/// Parse cargo-audit JSON output into vulnerabilities and warnings
pub fn parse_cargo_audit_json(
    json_str: &str,
) -> Result<(Vec<Vulnerability>, Vec<AuditWarning>), String> {
    let parsed: CargoAuditOutput =
        serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {}", e))?;

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

    Ok((vulnerabilities, warnings))
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

#[derive(Debug, Deserialize)]
struct CargoLicenseEntry {
    name: String,
    version: String,
    authors: Option<String>,
    repository: Option<String>,
    license: Option<String>,
}

/// Parse cargo-license JSON output into license info
pub fn parse_cargo_license_json(json_str: &str) -> Result<Vec<LicenseInfo>, String> {
    let parsed: Vec<CargoLicenseEntry> =
        serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {}", e))?;

    Ok(parsed
        .into_iter()
        .map(|e| LicenseInfo {
            name: e.name,
            version: e.version,
            license: e.license.unwrap_or_else(|| "Unknown".to_string()),
            authors: e.authors,
            repository: e.repository,
        })
        .collect())
}

// ============ Homebrew ============

#[derive(Debug, Clone, Default)]
pub struct BrewVersionInfo {
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
}

/// Parse brew info --json=v2 output to extract version information
pub fn parse_brew_info_json(json_str: &str) -> Option<BrewVersionInfo> {
    let json: serde_json::Value = serde_json::from_str(json_str).ok()?;

    let formula = json
        .get("formulae")
        .and_then(|f| f.as_array())
        .and_then(|arr| arr.first())?;

    let installed_version = formula
        .get("installed")
        .and_then(|i| i.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.get("version"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let latest_version = formula
        .get("versions")
        .and_then(|v| v.get("stable"))
        .and_then(|v| v.as_str())
        .map(String::from);

    Some(BrewVersionInfo {
        installed_version,
        latest_version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Cargo Outdated Parser Tests ============

    #[test]
    fn test_parse_cargo_outdated_json_basic() {
        let json = r#"{
            "dependencies": [
                {
                    "name": "serde",
                    "project": "1.0.0",
                    "latest": "1.0.200",
                    "kind": "Normal"
                },
                {
                    "name": "tokio",
                    "project": "1.35.0",
                    "latest": "1.40.0",
                    "kind": "Normal"
                }
            ]
        }"#;
        let deps = parse_cargo_outdated_json(json).unwrap();
        assert_eq!(deps.len(), 2);
        assert_eq!(deps[0].name, "serde");
        assert_eq!(deps[0].current, "1.0.0");
        assert_eq!(deps[0].latest, "1.0.200");
        assert_eq!(deps[0].kind, "Normal");
        assert_eq!(deps[1].name, "tokio");
    }

    #[test]
    fn test_parse_cargo_outdated_json_filters_up_to_date() {
        let json = r#"{
            "dependencies": [
                {
                    "name": "uptodate-crate",
                    "project": "1.0.0",
                    "latest": "1.0.0",
                    "kind": "Normal"
                },
                {
                    "name": "outdated-crate",
                    "project": "0.9.0",
                    "latest": "1.0.0",
                    "kind": "Normal"
                }
            ]
        }"#;
        let deps = parse_cargo_outdated_json(json).unwrap();
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].name, "outdated-crate");
    }

    #[test]
    fn test_parse_cargo_outdated_json_default_kind() {
        let json = r#"{
            "dependencies": [
                {
                    "name": "no-kind",
                    "project": "1.0.0",
                    "latest": "2.0.0",
                    "kind": null
                }
            ]
        }"#;
        let deps = parse_cargo_outdated_json(json).unwrap();
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].kind, "Normal");
    }

    #[test]
    fn test_parse_cargo_outdated_json_empty() {
        let json = r#"{"dependencies": []}"#;
        let deps = parse_cargo_outdated_json(json).unwrap();
        assert!(deps.is_empty());
    }

    #[test]
    fn test_parse_cargo_outdated_json_invalid() {
        let json = "not valid json";
        let result = parse_cargo_outdated_json(json);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("JSON parse error"));
    }

    // ============ Cargo Audit Parser Tests ============

    #[test]
    fn test_parse_cargo_audit_json_no_vulnerabilities() {
        let json = r#"{
            "vulnerabilities": {
                "list": [],
                "count": 0
            },
            "warnings": null
        }"#;
        let (vulns, warnings) = parse_cargo_audit_json(json).unwrap();
        assert!(vulns.is_empty());
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_parse_cargo_audit_json_with_vulnerability() {
        let json = r#"{
            "vulnerabilities": {
                "list": [{
                    "advisory": {
                        "id": "RUSTSEC-2021-0001",
                        "title": "Test vulnerability",
                        "description": "A test vulnerability",
                        "url": "https://example.com",
                        "cvss": "HIGH"
                    },
                    "package": {
                        "name": "test-crate",
                        "version": "1.0.0"
                    },
                    "versions": {
                        "patched": ["1.0.1", "1.1.0"]
                    }
                }],
                "count": 1
            },
            "warnings": null
        }"#;
        let (vulns, warnings) = parse_cargo_audit_json(json).unwrap();
        assert_eq!(vulns.len(), 1);
        assert_eq!(vulns[0].id, "RUSTSEC-2021-0001");
        assert_eq!(vulns[0].package, "test-crate");
        assert_eq!(vulns[0].severity, "HIGH");
        assert_eq!(vulns[0].patched_versions, vec!["1.0.1", "1.1.0"]);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_parse_cargo_audit_json_with_warning() {
        let json = r#"{
            "vulnerabilities": {
                "list": [],
                "count": 0
            },
            "warnings": {
                "unmaintained": [{
                    "kind": "unmaintained",
                    "package": {
                        "name": "old-crate",
                        "version": "0.1.0"
                    },
                    "advisory": {
                        "id": "RUSTSEC-2020-0001",
                        "title": "Unmaintained crate",
                        "description": "This crate is unmaintained",
                        "url": null,
                        "cvss": null
                    }
                }],
                "unsound": null,
                "yanked": null
            }
        }"#;
        let (vulns, warnings) = parse_cargo_audit_json(json).unwrap();
        assert!(vulns.is_empty());
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].kind, "unmaintained");
        assert_eq!(warnings[0].package, "old-crate");
    }

    #[test]
    fn test_parse_cargo_audit_json_invalid() {
        let json = "not valid json";
        let result = parse_cargo_audit_json(json);
        assert!(result.is_err());
    }

    // ============ Cargo License Parser Tests ============

    #[test]
    fn test_parse_cargo_license_json_with_licenses() {
        let json = r#"[
            {
                "name": "serde",
                "version": "1.0.200",
                "authors": "Erick Tryzelaar",
                "repository": "https://github.com/serde-rs/serde",
                "license": "MIT OR Apache-2.0"
            },
            {
                "name": "tokio",
                "version": "1.40.0",
                "authors": null,
                "repository": null,
                "license": "MIT"
            }
        ]"#;
        let licenses = parse_cargo_license_json(json).unwrap();
        assert_eq!(licenses.len(), 2);
        assert_eq!(licenses[0].name, "serde");
        assert_eq!(licenses[0].license, "MIT OR Apache-2.0");
        assert_eq!(licenses[1].name, "tokio");
        assert!(licenses[1].authors.is_none());
    }

    #[test]
    fn test_parse_cargo_license_json_empty() {
        let json = "[]";
        let licenses = parse_cargo_license_json(json).unwrap();
        assert!(licenses.is_empty());
    }

    #[test]
    fn test_parse_cargo_license_json_unknown_license() {
        let json = r#"[
            {
                "name": "mystery-crate",
                "version": "0.1.0",
                "authors": null,
                "repository": null,
                "license": null
            }
        ]"#;
        let licenses = parse_cargo_license_json(json).unwrap();
        assert_eq!(licenses.len(), 1);
        assert_eq!(licenses[0].name, "mystery-crate");
        assert_eq!(licenses[0].license, "Unknown");
        assert!(licenses[0].authors.is_none());
    }

    #[test]
    fn test_parse_cargo_license_json_invalid() {
        let json = "not valid json";
        let result = parse_cargo_license_json(json);
        assert!(result.is_err());
    }

    // ============ Brew Info Parser Tests ============

    #[test]
    fn test_parse_brew_info_json_with_installed() {
        let json = r#"{
            "formulae": [{
                "name": "rust-helper",
                "installed": [{"version": "0.2.0"}],
                "versions": {"stable": "0.2.3"}
            }]
        }"#;
        let info = parse_brew_info_json(json).unwrap();
        assert_eq!(info.installed_version, Some("0.2.0".to_string()));
        assert_eq!(info.latest_version, Some("0.2.3".to_string()));
    }

    #[test]
    fn test_parse_brew_info_json_not_installed() {
        let json = r#"{
            "formulae": [{
                "name": "rust-helper",
                "installed": [],
                "versions": {"stable": "0.2.3"}
            }]
        }"#;
        let info = parse_brew_info_json(json).unwrap();
        assert!(info.installed_version.is_none());
        assert_eq!(info.latest_version, Some("0.2.3".to_string()));
    }

    #[test]
    fn test_parse_brew_info_json_empty_formulae() {
        let json = r#"{"formulae": []}"#;
        let info = parse_brew_info_json(json);
        assert!(info.is_none());
    }

    #[test]
    fn test_parse_brew_info_json_invalid() {
        let json = "not valid json";
        let info = parse_brew_info_json(json);
        assert!(info.is_none());
    }
}
