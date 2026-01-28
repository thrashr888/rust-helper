//! Text parsing functions for command output

/// Parse rustup toolchain list output and return installed toolchains with default/active info
pub fn parse_rustup_toolchain_list(output: &str) -> (Vec<String>, Option<String>, Option<String>) {
    let mut installed_toolchains = Vec::new();
    let mut default_toolchain = None;
    let mut active_toolchain = None;

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

    (installed_toolchains, default_toolchain, active_toolchain)
}

/// Parse rustc --version output to extract version and check if homebrew
pub fn parse_rustc_version(version_output: &str) -> (Option<String>, bool) {
    let is_homebrew = version_output.contains("(Homebrew)");
    let version = version_output.split_whitespace().nth(1).map(String::from);
    (version, is_homebrew)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Rustup Toolchain Parser Tests ============

    #[test]
    fn test_parse_rustup_toolchain_list_basic() {
        let output = "stable-x86_64-apple-darwin (default)\nnightly-x86_64-apple-darwin";
        let (toolchains, default, active) = parse_rustup_toolchain_list(output);
        assert_eq!(toolchains.len(), 2);
        assert_eq!(toolchains[0], "stable-x86_64-apple-darwin");
        assert_eq!(toolchains[1], "nightly-x86_64-apple-darwin");
        assert_eq!(default, Some("stable-x86_64-apple-darwin".to_string()));
        assert_eq!(active, Some("stable-x86_64-apple-darwin".to_string()));
    }

    #[test]
    fn test_parse_rustup_toolchain_list_with_active() {
        let output = "stable-x86_64-apple-darwin (default)\nnightly-x86_64-apple-darwin (active)";
        let (toolchains, default, active) = parse_rustup_toolchain_list(output);
        assert_eq!(toolchains.len(), 2);
        assert_eq!(default, Some("stable-x86_64-apple-darwin".to_string()));
        assert_eq!(active, Some("nightly-x86_64-apple-darwin".to_string()));
    }

    #[test]
    fn test_parse_rustup_toolchain_list_empty() {
        let output = "";
        let (toolchains, default, active) = parse_rustup_toolchain_list(output);
        assert!(toolchains.is_empty());
        assert!(default.is_none());
        assert!(active.is_none());
    }

    #[test]
    fn test_parse_rustup_toolchain_list_multiple() {
        let output = "stable-x86_64-apple-darwin (default)\nnightly-x86_64-apple-darwin\nbeta-x86_64-apple-darwin\n1.70.0-x86_64-apple-darwin";
        let (toolchains, default, active) = parse_rustup_toolchain_list(output);
        assert_eq!(toolchains.len(), 4);
        assert_eq!(default, Some("stable-x86_64-apple-darwin".to_string()));
        assert_eq!(active, Some("stable-x86_64-apple-darwin".to_string()));
    }

    #[test]
    fn test_parse_rustup_toolchain_list_no_default() {
        let output = "stable-x86_64-apple-darwin\nnightly-x86_64-apple-darwin";
        let (toolchains, default, active) = parse_rustup_toolchain_list(output);
        assert_eq!(toolchains.len(), 2);
        assert!(default.is_none());
        assert!(active.is_none());
    }

    // ============ Rustc Version Parser Tests ============

    #[test]
    fn test_parse_rustc_version_homebrew() {
        let output = "rustc 1.92.0 (abc123 2024-01-15) (Homebrew)";
        let (version, is_homebrew) = parse_rustc_version(output);
        assert_eq!(version, Some("1.92.0".to_string()));
        assert!(is_homebrew);
    }

    #[test]
    fn test_parse_rustc_version_rustup() {
        let output = "rustc 1.82.0 (f6e511eec 2024-10-15)";
        let (version, is_homebrew) = parse_rustc_version(output);
        assert_eq!(version, Some("1.82.0".to_string()));
        assert!(!is_homebrew);
    }

    #[test]
    fn test_parse_rustc_version_nightly() {
        let output = "rustc 1.83.0-nightly (abc123 2024-09-01)";
        let (version, is_homebrew) = parse_rustc_version(output);
        assert_eq!(version, Some("1.83.0-nightly".to_string()));
        assert!(!is_homebrew);
    }

    #[test]
    fn test_parse_rustc_version_empty() {
        let output = "";
        let (version, is_homebrew) = parse_rustc_version(output);
        assert!(version.is_none());
        assert!(!is_homebrew);
    }
}
