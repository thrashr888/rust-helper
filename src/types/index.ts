// View and navigation types
export type View =
  | "projects"
  | "search"
  | "cleanup"
  | "dependencies"
  | "security"
  | "health"
  | "analysis"
  | "licenses"
  | "settings"
  | "project-detail";

export type ProjectDetailTab =
  | "commands"
  | "tests"
  | "cleanup"
  | "dependencies"
  | "security"
  | "licenses"
  | "git"
  | "cargo-toml"
  | "docs";

export type SortBy = "name" | "lastModified" | "size" | "deps";

// Project types
export interface Project {
  name: string;
  path: string;
  target_size: number;
  dep_count: number;
  last_modified: number;
  is_workspace_member: boolean;
  workspace_root: string | null;
  git_url: string | null;
  commit_count: number;
  version: string | null;
  rust_version: string | null;
  homepage: string | null;
}

export interface CleanResult {
  path: string;
  name: string;
  freed_bytes: number;
  success: boolean;
  error: string | null;
}

// Vulnerability and audit types
export interface Vulnerability {
  id: string;
  package: string;
  version: string;
  title: string;
  description: string;
  severity: string;
  url: string | null;
  patched_versions: string[];
}

export interface AuditWarning {
  kind: string;
  package: string;
  version: string;
  title: string;
  advisory_id: string;
  url: string | null;
}

export interface AuditResult {
  project_path: string;
  project_name: string;
  vulnerabilities: Vulnerability[];
  warnings: AuditWarning[];
  success: boolean;
  error: string | null;
}

// Cargo command types
export interface CargoCommandResult {
  project_path: string;
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

export interface CommandHistoryEntry {
  id: string;
  timestamp: number;
  startTime: number;
  durationMs: number;
  command: string;
  success: boolean;
  exitCode: number | null;
  output: string[];
  isCollapsed: boolean;
}

// Dependency types
export interface OutdatedDep {
  name: string;
  current: string;
  latest: string;
  kind: string;
}

export interface OutdatedResult {
  project_path: string;
  project_name: string;
  dependencies: OutdatedDep[];
  success: boolean;
  error: string | null;
}

export interface VersionUsage {
  version: string;
  projects: string[];
}

export interface DepUsage {
  name: string;
  versions: VersionUsage[];
  project_count: number;
}

export interface DepAnalysis {
  dependencies: DepUsage[];
  total_unique_deps: number;
  deps_with_mismatches: number;
}

// Toolchain types
export interface ToolchainInfo {
  project_path: string;
  project_name: string;
  toolchain: string | null;
  msrv: string | null;
  channel: string | null;
}

export interface ToolchainGroup {
  version: string;
  projects: string[];
}

export interface ToolchainAnalysis {
  projects: ToolchainInfo[];
  toolchain_groups: ToolchainGroup[];
  msrv_groups: ToolchainGroup[];
  has_mismatches: boolean;
}

// License types
export interface LicenseInfo {
  name: string;
  version: string;
  license: string;
  authors: string | null;
  repository: string | null;
}

export interface LicenseGroup {
  license: string;
  packages: string[];
  is_problematic: boolean;
}

export interface LicenseResult {
  project_path: string;
  project_name: string;
  licenses: LicenseInfo[];
  success: boolean;
  error: string | null;
}

export interface LicenseAnalysis {
  projects: LicenseResult[];
  license_groups: LicenseGroup[];
  total_packages: number;
  problematic_count: number;
}

// Git types
export interface GitInfo {
  remote_url: string | null;
  github_url: string | null;
  commit_count: number;
}

export interface GitTag {
  name: string;
  message: string;
  date: string;
  commit_hash: string;
}

export interface GitStats {
  contributors: number;
  commits: number;
  branches: number;
  tags: number;
  first_commit_date: string | null;
}

// IDE types
export interface InstalledIde {
  id: string;
  name: string;
  command: string;
}

// Documentation types
export interface DocResult {
  success: boolean;
  doc_path: string | null;
  error: string | null;
}

// Cargo features types
export interface CargoFeature {
  name: string;
  dependencies: string[];
  is_default: boolean;
}

export interface CargoFeatures {
  features: CargoFeature[];
  default_features: string[];
}

// Binary size types
export interface BinaryInfo {
  name: string;
  debug_size: number | null;
  release_size: number | null;
}

export interface BinarySizes {
  debug: number | null;
  release: number | null;
  binaries: BinaryInfo[];
}

// Bloat analysis types
export interface BloatCrate {
  name: string;
  size: number;
  size_percent: number;
}

export interface BloatFunction {
  name: string;
  size: number;
  size_percent: number;
  crate_name: string | null;
}

export interface BloatAnalysis {
  file_size: number;
  text_size: number;
  crates: BloatCrate[];
  functions: BloatFunction[];
}

// Coverage types
export interface CoverageFile {
  path: string;
  covered: number;
  coverable: number;
  percent: number;
}

export interface CoverageResult {
  files: CoverageFile[];
  total_covered: number;
  total_coverable: number;
  coverage_percent: number;
}

// MSRV types
export interface MsrvInfo {
  msrv: string | null;
  rust_version: string | null;
  edition: string | null;
}

// Workspace types
export interface WorkspaceMember {
  name: string;
  path: string;
  is_current: boolean;
}

export interface WorkspaceInfo {
  is_workspace: boolean;
  members: WorkspaceMember[];
  root_path: string | null;
  is_member_of_workspace: boolean;
  parent_workspace_path: string | null;
  parent_workspace_name: string | null;
}

// GitHub Actions types
export interface GitHubActionsStatus {
  has_workflows: boolean;
  workflows: string[];
  badge_url: string | null;
}

export interface GithubActionsInfo {
  has_workflows: boolean;
  workflow_files: string[];
  github_url: string | null;
  actions_url: string | null;
}

// Rust version types
export interface RustVersionInfo {
  rustc_version: string | null;
  cargo_version: string | null;
  default_toolchain: string | null;
  installed_toolchains: string[];
  active_toolchain: string | null;
}

// Homebrew types
export interface HomebrewStatus {
  installed_via_homebrew: boolean;
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
  formula_name: string | null;
}

export interface RustHomebrewStatus {
  installed_via_homebrew: boolean;
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

// Search types
export interface SearchMatch {
  start: number;
  end: number;
}

export interface ContextLine {
  line_number: number;
  content: string;
}

export interface SearchResult {
  project_path: string;
  project_name: string;
  file_path: string;
  line_number: number;
  line_content: string;
  matches: SearchMatch[];
  context_before: ContextLine[];
  context_after: ContextLine[];
}

// Cache types
export interface ScanCache {
  outdated_results: OutdatedResult[] | null;
  outdated_timestamp: number | null;
  audit_results: AuditResult[] | null;
  audit_timestamp: number | null;
  dep_analysis: DepAnalysis | null;
  dep_analysis_timestamp: number | null;
  toolchain_analysis: ToolchainAnalysis | null;
  toolchain_timestamp: number | null;
  license_analysis: LicenseAnalysis | null;
  license_timestamp: number | null;
}

// Tool status types
export interface ToolStatus {
  name: string;
  command: string;
  installed: boolean;
  install_cmd: string;
  description: string;
}

// Test result types
export interface TestResult {
  name: string;
  classname: string;
  time_seconds: number;
  status: "passed" | "failed" | "skipped";
  failure_message: string | null;
}

export interface TestSuiteResult {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time_seconds: number;
  test_cases: TestResult[];
}

export interface NextestResults {
  suites: TestSuiteResult[];
  total_tests: number;
  total_passed: number;
  total_failed: number;
  total_skipped: number;
  total_time_seconds: number;
}

// UI types
export interface BackgroundJob {
  id: string;
  label: string;
  startTime: number;
}
