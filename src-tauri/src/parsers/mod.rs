//! Parsing functions for various data formats
//!
//! This module contains pure parsing functions that convert
//! string/text data into structured types for the application.

pub mod json;
pub mod text;
pub mod toml;
pub mod xml;

// Re-export commonly used parsers
pub use json::{
    parse_brew_info_json, parse_cargo_audit_json, parse_cargo_license_json,
    parse_cargo_outdated_json,
};
pub use text::{parse_rustc_version, parse_rustup_toolchain_list};
pub use toml::{parse_cargo_features_toml, parse_msrv_toml};
pub use xml::parse_junit_xml;
