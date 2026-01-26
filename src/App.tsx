import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import AnsiToHtml from "ansi-to-html";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import toml from "highlight.js/lib/languages/ini"; // TOML uses INI-like syntax
import "highlight.js/styles/github-dark.css";

hljs.registerLanguage("toml", toml);
import {
  Folder,
  FolderOpen,
  Broom,
  Package,
  ShieldCheck,
  Heartbeat,
  ChartBar,
  Gear,
  Star,
  Eye,
  EyeSlash,
  CaretDown,
  TreeStructure,
  Trash,
  CheckCircle,
  XCircle,
  Spinner,
  ArrowUp,
  Warning,
  ArrowLeft,
  Play,
  Code,
  Bug,
  FileCode,
  Wrench,
  ArrowsClockwise,
  Tree,
  Timer,
  Scroll,
  GithubLogo,
  Book,
  MagnifyingGlass,
  GitBranch,
  Cpu,
  X,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type View =
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

type ProjectDetailTab =
  | "commands"
  | "tests"
  | "cleanup"
  | "dependencies"
  | "security"
  | "licenses"
  | "cargo-toml"
  | "docs";

type SortBy = "name" | "lastModified" | "size" | "deps";

interface Vulnerability {
  id: string;
  package: string;
  version: string;
  title: string;
  description: string;
  severity: string;
  url: string | null;
  patched_versions: string[];
}

interface AuditWarning {
  kind: string;
  package: string;
  version: string;
  title: string;
  advisory_id: string;
  url: string | null;
}

interface AuditResult {
  project_path: string;
  project_name: string;
  vulnerabilities: Vulnerability[];
  warnings: AuditWarning[];
  success: boolean;
  error: string | null;
}

interface CargoCommandResult {
  project_path: string;
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

interface VersionUsage {
  version: string;
  projects: string[];
}

interface DepUsage {
  name: string;
  versions: VersionUsage[];
  project_count: number;
}

interface DepAnalysis {
  dependencies: DepUsage[];
  total_unique_deps: number;
  deps_with_mismatches: number;
}

interface ToolchainInfo {
  project_path: string;
  project_name: string;
  toolchain: string | null;
  msrv: string | null;
  channel: string | null;
}

interface ToolchainGroup {
  version: string;
  projects: string[];
}

interface ToolchainAnalysis {
  projects: ToolchainInfo[];
  toolchain_groups: ToolchainGroup[];
  msrv_groups: ToolchainGroup[];
  has_mismatches: boolean;
}

interface LicenseInfo {
  name: string;
  version: string;
  license: string;
  authors: string | null;
  repository: string | null;
}

interface LicenseGroup {
  license: string;
  packages: string[];
  is_problematic: boolean;
}

interface LicenseResult {
  project_path: string;
  project_name: string;
  licenses: LicenseInfo[];
  success: boolean;
  error: string | null;
}

interface LicenseAnalysis {
  projects: LicenseResult[];
  license_groups: LicenseGroup[];
  total_packages: number;
  problematic_count: number;
}

interface GitInfo {
  remote_url: string | null;
  github_url: string | null;
  commit_count: number;
}

interface DocResult {
  success: boolean;
  doc_path: string | null;
  error: string | null;
}

interface CargoFeature {
  name: string;
  dependencies: string[];
  is_default: boolean;
}

interface CargoFeatures {
  features: CargoFeature[];
  default_features: string[];
}

interface BinaryInfo {
  name: string;
  debug_size: number | null;
  release_size: number | null;
}

interface BinarySizes {
  debug: number | null;
  release: number | null;
  binaries: BinaryInfo[];
}

interface BloatCrate {
  name: string;
  size: number;
  size_percent: number;
}

interface BloatFunction {
  name: string;
  size: number;
  size_percent: number;
  crate_name: string | null;
}

interface BloatAnalysis {
  file_size: number;
  text_size: number;
  crates: BloatCrate[];
  functions: BloatFunction[];
}

interface CoverageFile {
  path: string;
  covered: number;
  coverable: number;
  percent: number;
}

interface CoverageResult {
  files: CoverageFile[];
  total_covered: number;
  total_coverable: number;
  coverage_percent: number;
}

interface MsrvInfo {
  msrv: string | null;
  rust_version: string | null;
  edition: string | null;
}

interface WorkspaceMember {
  name: string;
  path: string;
  is_current: boolean;
}

interface WorkspaceInfo {
  is_workspace: boolean;
  members: WorkspaceMember[];
  root_path: string | null;
  is_member_of_workspace: boolean;
  parent_workspace_path: string | null;
  parent_workspace_name: string | null;
}

interface GitHubActionsStatus {
  has_workflows: boolean;
  workflows: string[];
  badge_url: string | null;
}

interface RustVersionInfo {
  rustc_version: string | null;
  cargo_version: string | null;
  default_toolchain: string | null;
  installed_toolchains: string[];
  active_toolchain: string | null;
}

interface HomebrewStatus {
  installed_via_homebrew: boolean;
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
  formula_name: string | null;
}

interface RustHomebrewStatus {
  installed_via_homebrew: boolean;
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

interface SearchMatch {
  start: number;
  end: number;
}

interface ContextLine {
  line_number: number;
  content: string;
}

interface SearchResult {
  project_path: string;
  project_name: string;
  file_path: string;
  line_number: number;
  line_content: string;
  matches: SearchMatch[];
  context_before: ContextLine[];
  context_after: ContextLine[];
}

interface ScanCache {
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

interface ToolStatus {
  name: string;
  command: string;
  installed: boolean;
  install_cmd: string;
  description: string;
}

interface Project {
  name: string;
  path: string;
  target_size: number;
  dep_count: number;
  last_modified: number;
  is_workspace_member: boolean;
  workspace_root: string | null;
}

interface CleanResult {
  path: string;
  name: string;
  freed_bytes: number;
  success: boolean;
  error: string | null;
}

interface OutdatedDep {
  name: string;
  current: string;
  latest: string;
  kind: string;
}

interface OutdatedResult {
  project_path: string;
  project_name: string;
  dependencies: OutdatedDep[];
  success: boolean;
  error: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatTimeAgo(timestamp: number): string {
  if (timestamp === 0) return "never";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function App() {
  const [view, setView] = useState<View>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("lastModified");
  const [showWorkspaceMembers, setShowWorkspaceMembers] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [cleaning, setCleaning] = useState<Set<string>>(new Set());
  const [cleaningDebug, setCleaningDebug] = useState<Set<string>>(new Set());
  const [cleanResults, setCleanResults] = useState<CleanResult[]>([]);
  const [cleaningAll, setCleaningAll] = useState(false);
  const [cleaningAllDebug, setCleaningAllDebug] = useState(false);
  const [outdatedResults, setOutdatedResults] = useState<OutdatedResult[]>([]);
  const [checkingOutdated, setCheckingOutdated] = useState(false);
  const [scanRoot, setScanRoot] = useState<string>("");
  const [scanRootInput, setScanRootInput] = useState<string>("");
  const [configLoaded, setConfigLoaded] = useState(false);

  // Security audit state
  const [auditResults, setAuditResults] = useState<AuditResult[]>([]);
  const [checkingAudit, setCheckingAudit] = useState(false);

  // Project detail state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [commandOutput, setCommandOutput] = useState<CargoCommandResult | null>(null);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [projectDetailTab, setProjectDetailTab] = useState<ProjectDetailTab>("commands");
  const [streamingOutput, setStreamingOutput] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const ansiConverter = useRef(new AnsiToHtml({ fg: "#d4d4d4", bg: "#1e1e1e" }));
  const outputRef = useRef<HTMLPreElement>(null);

  // Per-project analysis state
  const [projectOutdated, setProjectOutdated] = useState<OutdatedResult | null>(null);
  const [checkingProjectOutdated, setCheckingProjectOutdated] = useState(false);
  const [upgradingPackage, setUpgradingPackage] = useState<string | null>(null);
  const [projectAudit, setProjectAudit] = useState<AuditResult | null>(null);
  const [checkingProjectAudit, setCheckingProjectAudit] = useState(false);
  const [projectLicenses, setProjectLicenses] = useState<LicenseResult | null>(null);
  const [checkingProjectLicenses, setCheckingProjectLicenses] = useState(false);
  const [cargoTomlContent, setCargoTomlContent] = useState<string | null>(null);
  const [loadingCargoToml, setLoadingCargoToml] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [docPath, setDocPath] = useState<string | null>(null);
  const [generatingDocs, setGeneratingDocs] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  // New feature state
  const [cargoFeatures, setCargoFeatures] = useState<CargoFeatures | null>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const [binarySizes, setBinarySizes] = useState<BinarySizes | null>(null);
  const [bloatAnalysis, setBloatAnalysis] = useState<BloatAnalysis | null>(
    null,
  );
  const [analyzingBloat, setAnalyzingBloat] = useState(false);
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(
    null,
  );
  const [runningCoverage, setRunningCoverage] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [msrvInfo, setMsrvInfo] = useState<MsrvInfo | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [githubActionsStatus, setGithubActionsStatus] = useState<GitHubActionsStatus | null>(null);
  const [rustVersionInfo, setRustVersionInfo] = useState<RustVersionInfo | null>(null);
  const [homebrewStatus, setHomebrewStatus] = useState<HomebrewStatus | null>(null);
  const [upgradingHomebrew, setUpgradingHomebrew] = useState(false);
  const [rustHomebrewStatus, setRustHomebrewStatus] = useState<RustHomebrewStatus | null>(null);
  const [upgradingRustHomebrew, setUpgradingRustHomebrew] = useState(false);
  const [appUpdate, setAppUpdate] = useState<Update | null>(null);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");

  // Dependency analysis state
  const [depAnalysis, setDepAnalysis] = useState<DepAnalysis | null>(null);
  const [analyzingDeps, setAnalyzingDeps] = useState(false);

  // Toolchain analysis state
  const [toolchainAnalysis, setToolchainAnalysis] = useState<ToolchainAnalysis | null>(null);
  const [analyzingToolchains, setAnalyzingToolchains] = useState(false);

  // License analysis state
  const [licenseAnalysis, setLicenseAnalysis] = useState<LicenseAnalysis | null>(null);
  const [analyzingLicenses, setAnalyzingLicenses] = useState(false);

  // Required tools state
  const [requiredTools, setRequiredTools] = useState<ToolStatus[]>([]);
  const [checkingTools, setCheckingTools] = useState(false);
  const [installingTools, setInstallingTools] = useState<Set<string>>(new Set());
  const [installQueue, setInstallQueue] = useState<ToolStatus[]>([]);

  // Timestamps for cached results
  const [outdatedTimestamp, setOutdatedTimestamp] = useState<number | null>(null);
  const [auditTimestamp, setAuditTimestamp] = useState<number | null>(null);
  const [depAnalysisTimestamp, setDepAnalysisTimestamp] = useState<number | null>(null);
  const [toolchainTimestamp, setToolchainTimestamp] = useState<number | null>(null);
  const [licenseTimestamp, setLicenseTimestamp] = useState<number | null>(null);

  // Background job queue
  interface BackgroundJob {
    id: string;
    label: string;
    startTime: number;
  }
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);

  const addJob = (id: string, label: string) => {
    setJobs((prev) => [...prev, { id, label, startTime: Date.now() }]);
  };

  const removeJob = (id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const loadConfig = async () => {
    try {
      const favs = await invoke<string[]>("get_favorites");
      setFavorites(new Set(favs));
      const hid = await invoke<string[]>("get_hidden");
      setHidden(new Set(hid));

      // Load scan root
      let root = await invoke<string | null>("get_scan_root");
      if (!root) {
        root = await invoke<string>("get_default_scan_root");
      }
      setScanRoot(root);
      setScanRootInput(root);

      // Load cached scan results
      const cache = await invoke<ScanCache>("get_cache");
      if (cache.outdated_results) {
        setOutdatedResults(cache.outdated_results);
        setOutdatedTimestamp(cache.outdated_timestamp);
      }
      if (cache.audit_results) {
        setAuditResults(cache.audit_results);
        setAuditTimestamp(cache.audit_timestamp);
      }
      if (cache.dep_analysis) {
        setDepAnalysis(cache.dep_analysis);
        setDepAnalysisTimestamp(cache.dep_analysis_timestamp);
      }
      if (cache.toolchain_analysis) {
        setToolchainAnalysis(cache.toolchain_analysis);
        setToolchainTimestamp(cache.toolchain_timestamp);
      }
      if (cache.license_analysis) {
        setLicenseAnalysis(cache.license_analysis);
        setLicenseTimestamp(cache.license_timestamp);
      }

      // Check required tools
      const tools = await invoke<ToolStatus[]>("check_required_tools");
      setRequiredTools(tools);

      setConfigLoaded(true);
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  };

  const scanProjects = async (rootPath?: string) => {
    const pathToScan = rootPath || scanRoot;
    if (!pathToScan) return;

    setScanning(true);
    addJob("scan", "Scanning projects...");
    try {
      const found = await invoke<Project[]>("scan_projects", {
        rootPath: pathToScan,
      });
      setProjects(found);
    } catch (e) {
      console.error("Failed to scan projects:", e);
    }
    removeJob("scan");
    setScanning(false);
  };

  const toggleFavorite = async (path: string) => {
    const isFav = favorites.has(path);
    try {
      await invoke("set_favorite", { path, isFavorite: !isFav });
      setFavorites((prev) => {
        const next = new Set(prev);
        if (isFav) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
    }
  };

  const toggleHidden = async (path: string) => {
    const isHid = hidden.has(path);
    try {
      await invoke("set_hidden", { path, isHidden: !isHid });
      setHidden((prev) => {
        const next = new Set(prev);
        if (isHid) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    } catch (e) {
      console.error("Failed to toggle hidden:", e);
    }
  };

  const cleanProject = async (projectPath: string, debugOnly: boolean = false, sizeHint?: number) => {
    const setStateFunc = debugOnly ? setCleaningDebug : setCleaning;
    setStateFunc((prev) => new Set(prev).add(projectPath));
    try {
      const result = await invoke<CleanResult>("clean_project", {
        projectPath,
        debugOnly,
        sizeHint: sizeHint ?? null,
      });
      setCleanResults((prev) => [...prev.filter((r) => r.path !== projectPath), result]);
      // Refresh project list to update sizes
      await scanProjects();
    } catch (e) {
      console.error("Failed to clean project:", e);
    }
    setStateFunc((prev) => {
      const next = new Set(prev);
      next.delete(projectPath);
      return next;
    });
  };

  const cleanAllProjects = async (debugOnly: boolean = false) => {
    const setStateFunc = debugOnly ? setCleaningAllDebug : setCleaningAll;
    setStateFunc(true);
    setCleanResults([]);
    // Yield to event loop to allow React to render loading state
    await new Promise(resolve => setTimeout(resolve, 50));
    const projectsToClean = projectsWithTargets.map((p) => p.path);
    const sizeHints = projectsWithTargets.map((p) => p.target_size);
    try {
      const results = await invoke<CleanResult[]>("clean_projects", {
        projectPaths: projectsToClean,
        debugOnly,
        sizeHints,
      });
      setCleanResults(results);
      await scanProjects();
    } catch (e) {
      console.error("Failed to clean projects:", e);
    }
    setStateFunc(false);
  };

  const checkAllOutdated = async () => {
    setCheckingOutdated(true);
    setOutdatedResults([]);
    addJob("outdated", "Checking dependencies...");
    // Only check non-workspace-member projects
    const projectsToCheck = projects
      .filter((p) => !p.is_workspace_member)
      .map((p) => p.path);
    try {
      const results = await invoke<OutdatedResult[]>("check_all_outdated", {
        projectPaths: projectsToCheck,
      });
      setOutdatedResults(results);
      // Save to cache
      await invoke("save_outdated_cache", { results });
      setOutdatedTimestamp(Math.floor(Date.now() / 1000));
    } catch (e) {
      console.error("Failed to check outdated:", e);
    }
    removeJob("outdated");
    setCheckingOutdated(false);
  };

  const saveScanRoot = async () => {
    if (!scanRootInput) return;
    try {
      await invoke("set_scan_root", { path: scanRootInput });
      setScanRoot(scanRootInput);
      await scanProjects(scanRootInput);
    } catch (e) {
      console.error("Failed to save scan root:", e);
    }
  };

  const checkRequiredTools = async () => {
    setCheckingTools(true);
    try {
      const tools = await invoke<ToolStatus[]>("check_required_tools");
      setRequiredTools(tools);
    } catch (e) {
      console.error("Failed to check tools:", e);
    }
    setCheckingTools(false);
  };

  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  const queueToolInstall = (tool: ToolStatus) => {
    setInstallQueue((prev) => {
      // Don't add if already in queue
      if (prev.some((t) => t.name === tool.name)) return prev;
      return [...prev, tool];
    });
  };

  // Process install queue
  useEffect(() => {
    if (installQueue.length === 0 || isProcessingQueue) return;

    const processNext = async () => {
      setIsProcessingQueue(true);

      while (true) {
        // Get current queue state
        const currentQueue = installQueue;
        if (currentQueue.length === 0) break;

        const tool = currentQueue[0];

        // Mark as installing
        setInstallingTools((prev) => new Set(prev).add(tool.name));
        addJob(`install-${tool.name}`, `Installing ${tool.name}...`);

        try {
          const result = await invoke<CargoCommandResult>("install_tool", { installCmd: tool.install_cmd });
          if (!result.success) {
            console.error(`Failed to install ${tool.name}:`, result.stderr);
          }
        } catch (e) {
          console.error("Failed to install tool:", e);
        }

        removeJob(`install-${tool.name}`);
        setInstallingTools((prev) => {
          const next = new Set(prev);
          next.delete(tool.name);
          return next;
        });

        // Remove from queue
        setInstallQueue((prev) => prev.slice(1));

        // Small delay to let state update
        await new Promise((r) => setTimeout(r, 100));

        // Check if queue is now empty
        // We need to break and let useEffect re-run to get fresh state
        break;
      }

      setIsProcessingQueue(false);
    };

    processNext();
  }, [installQueue, isProcessingQueue]);

  // Refresh tools when queue empties
  useEffect(() => {
    if (installQueue.length === 0 && !isProcessingQueue && installingTools.size === 0) {
      // Only refresh if we had tools installing before
      checkRequiredTools();
    }
  }, [installQueue.length, isProcessingQueue, installingTools.size]);

  // Listen for streaming command output
  useEffect(() => {
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenComplete: UnlistenFn | null = null;

    const setupListeners = async () => {
      unlistenOutput = await listen<{ line: string; stream: string }>(
        "cargo-output",
        (event) => {
          setStreamingOutput((prev) => [...prev, event.payload.line]);
          // Auto-scroll to bottom
          if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
          }
        }
      );

      unlistenComplete = await listen<{
        project_path: string;
        command: string;
        success: boolean;
        exit_code: number | null;
      }>("cargo-complete", async (event) => {
        setIsStreaming(false);
        setRunningCommand(null);
        setRunningCoverage(false);
        // Remove any pending cargo jobs
        setJobs((prev) => prev.filter((job) => !job.id.startsWith("cargo-")));
        // Convert streaming output to command result
        setCommandOutput({
          project_path: event.payload.project_path,
          command: event.payload.command,
          success: event.payload.success,
          stdout: "", // Output is in streamingOutput
          stderr: "",
          exit_code: event.payload.exit_code,
        });

        // Handle tarpaulin coverage results
        if (event.payload.command === "tarpaulin" && event.payload.success) {
          try {
            const jsonStr = await invoke<string>("read_tarpaulin_results", {
              projectPath: event.payload.project_path,
            });
            const data = JSON.parse(jsonStr);
            let files: CoverageFile[] = [];
            let totalCovered = 0;
            let totalCoverable = 0;

            if (Array.isArray(data)) {
              data.forEach((file: { path?: string[]; covered?: number; coverable?: number }) => {
                if (file.path && Array.isArray(file.path)) {
                  const filePath = file.path.join("/");
                  const covered = file.covered || 0;
                  const coverable = file.coverable || 0;
                  totalCovered += covered;
                  totalCoverable += coverable;
                  if (coverable > 0) {
                    files.push({ path: filePath, covered, coverable, percent: (covered / coverable) * 100 });
                  }
                }
              });
            } else if (data.files) {
              data.files.forEach((file: { path: string; covered: number; coverable: number }) => {
                totalCovered += file.covered;
                totalCoverable += file.coverable;
                if (file.coverable > 0) {
                  files.push({
                    path: file.path,
                    covered: file.covered,
                    coverable: file.coverable,
                    percent: (file.covered / file.coverable) * 100,
                  });
                }
              });
            }
            files.sort((a, b) => a.percent - b.percent);
            setCoverageResult({
              files,
              total_covered: totalCovered,
              total_coverable: totalCoverable,
              coverage_percent: totalCoverable > 0 ? (totalCovered / totalCoverable) * 100 : 0,
            });
          } catch (e) {
            console.error("Failed to parse coverage results:", e);
            setCoverageError(String(e));
          }
        } else if (event.payload.command === "tarpaulin" && !event.payload.success) {
          setCoverageError("Coverage analysis failed - check output for details");
        }
      });
    };

    setupListeners();

    return () => {
      if (unlistenOutput) unlistenOutput();
      if (unlistenComplete) unlistenComplete();
    };
  }, []);

  const checkAllAudits = async () => {
    setCheckingAudit(true);
    setAuditResults([]);
    addJob("audit", "Auditing security...");
    const projectsToCheck = projects
      .filter((p) => !p.is_workspace_member)
      .map((p) => p.path);
    try {
      const results = await invoke<AuditResult[]>("check_all_audits", {
        projectPaths: projectsToCheck,
      });
      setAuditResults(results);
      // Save to cache
      await invoke("save_audit_cache", { results });
      setAuditTimestamp(Math.floor(Date.now() / 1000));
    } catch (e) {
      console.error("Failed to check audits:", e);
    }
    removeJob("audit");
    setCheckingAudit(false);
  };

  const openProjectDetail = async (project: Project) => {
    setSelectedProject(project);
    setCommandOutput(null);
    setProjectDetailTab("commands");
    setProjectOutdated(null);
    setProjectAudit(null);
    setProjectLicenses(null);
    setCargoTomlContent(null);
    setGitInfo(null);
    setDocPath(null);
    setDocError(null);
    setCargoFeatures(null);
    setSelectedFeatures(new Set());
    setBinarySizes(null);
    setMsrvInfo(null);
    setWorkspaceInfo(null);
    setGithubActionsStatus(null);
    setBloatAnalysis(null);
    setView("project-detail");

    // Load project info in background (parallel)
    const loadGitInfo = invoke<GitInfo>("get_git_info", { projectPath: project.path })
      .then(setGitInfo)
      .catch((e) => console.error("Failed to get git info:", e));

    const loadFeatures = invoke<CargoFeatures>("get_cargo_features", { projectPath: project.path })
      .then((features) => {
        setCargoFeatures(features);
        setSelectedFeatures(new Set(features.default_features));
      })
      .catch((e) => console.error("Failed to get cargo features:", e));

    const loadBinarySizes = invoke<BinarySizes>("get_binary_sizes", { projectPath: project.path })
      .then(setBinarySizes)
      .catch((e) => console.error("Failed to get binary sizes:", e));

    const loadMsrv = invoke<MsrvInfo>("get_msrv", { projectPath: project.path })
      .then(setMsrvInfo)
      .catch((e) => console.error("Failed to get MSRV:", e));

    const loadWorkspace = invoke<WorkspaceInfo>("get_workspace_info", { projectPath: project.path })
      .then(setWorkspaceInfo)
      .catch((e) => console.error("Failed to get workspace info:", e));

    const loadGitHubActions = invoke<GitHubActionsStatus>("get_github_actions_status", { projectPath: project.path })
      .then(setGithubActionsStatus)
      .catch((e) => console.error("Failed to get GitHub Actions status:", e));

    await Promise.all([loadGitInfo, loadFeatures, loadBinarySizes, loadMsrv, loadWorkspace, loadGitHubActions]);
  };

  const checkProjectOutdated = async () => {
    if (!selectedProject) return;
    setCheckingProjectOutdated(true);
    const jobId = `project-outdated-${Date.now()}`;
    addJob(jobId, "Checking dependencies...");
    try {
      const result = await invoke<OutdatedResult>("check_outdated", {
        projectPath: selectedProject.path,
      });
      setProjectOutdated(result);
    } catch (e) {
      console.error("Failed to check outdated:", e);
    }
    removeJob(jobId);
    setCheckingProjectOutdated(false);
  };

  const checkProjectAudit = async () => {
    if (!selectedProject) return;
    setCheckingProjectAudit(true);
    const jobId = `project-audit-${Date.now()}`;
    addJob(jobId, "Running security audit...");
    try {
      const result = await invoke<AuditResult>("check_audit", {
        projectPath: selectedProject.path,
      });
      setProjectAudit(result);
    } catch (e) {
      console.error("Failed to check audit:", e);
    }
    removeJob(jobId);
    setCheckingProjectAudit(false);
  };

  const checkProjectLicenses = async () => {
    if (!selectedProject) return;
    setCheckingProjectLicenses(true);
    const jobId = `project-licenses-${Date.now()}`;
    addJob(jobId, "Checking licenses...");
    try {
      const result = await invoke<LicenseResult>("check_licenses", {
        projectPath: selectedProject.path,
      });
      setProjectLicenses(result);
    } catch (e) {
      console.error("Failed to check licenses:", e);
    }
    removeJob(jobId);
    setCheckingProjectLicenses(false);
  };

  const loadCargoToml = async () => {
    if (!selectedProject) return;
    setLoadingCargoToml(true);
    try {
      const content = await invoke<string>("read_cargo_toml", {
        projectPath: selectedProject.path,
      });
      setCargoTomlContent(content);
    } catch (e) {
      console.error("Failed to load Cargo.toml:", e);
      setCargoTomlContent(null);
    }
    setLoadingCargoToml(false);
  };

  const generateProjectDocs = async () => {
    if (!selectedProject) return;
    setGeneratingDocs(true);
    setDocError(null);
    const jobId = `generate-docs-${Date.now()}`;
    addJob(jobId, "Generating documentation...");
    try {
      const result = await invoke<DocResult>("generate_docs", {
        projectPath: selectedProject.path,
      });
      if (result.success && result.doc_path) {
        setDocPath(result.doc_path);
      } else {
        setDocError(result.error || "Failed to generate docs");
      }
    } catch (e) {
      console.error("Failed to generate docs:", e);
      setDocError("Failed to generate documentation");
    }
    removeJob(jobId);
    setGeneratingDocs(false);
  };

  const openInVSCode = async () => {
    if (!selectedProject) return;
    try {
      await invoke("open_in_vscode", { projectPath: selectedProject.path });
    } catch (e) {
      console.error("Failed to open in VS Code:", e);
    }
  };

  const loadRustVersionInfo = async () => {
    try {
      const info = await invoke<RustVersionInfo>("get_rust_version_info");
      setRustVersionInfo(info);
    } catch (e) {
      console.error("Failed to get Rust version info:", e);
    }
  };

  const checkHomebrewStatus = async () => {
    try {
      const status = await invoke<HomebrewStatus>("check_homebrew_status");
      setHomebrewStatus(status);
    } catch (e) {
      console.error("Failed to check Homebrew status:", e);
    }
  };

  const upgradeHomebrew = async () => {
    if (!homebrewStatus?.formula_name) return;
    setUpgradingHomebrew(true);
    try {
      const result = await invoke<string>("upgrade_homebrew", {
        formulaName: homebrewStatus.formula_name,
      });
      alert(result);
      checkHomebrewStatus();
    } catch (e) {
      alert(`Upgrade failed: ${e}`);
    } finally {
      setUpgradingHomebrew(false);
    }
  };

  const checkRustHomebrewStatus = async () => {
    try {
      const status = await invoke<RustHomebrewStatus>("check_rust_homebrew_status");
      setRustHomebrewStatus(status);
    } catch (e) {
      console.error("Failed to check Rust Homebrew status:", e);
    }
  };

  const upgradeRustHomebrew = async () => {
    if (!rustHomebrewStatus?.installed_via_homebrew) return;
    setUpgradingRustHomebrew(true);
    try {
      const result = await invoke<string>("upgrade_rust_homebrew");
      alert(result);
      checkRustHomebrewStatus();
      loadRustVersionInfo();
    } catch (e) {
      alert(`Upgrade failed: ${e}`);
    } finally {
      setUpgradingRustHomebrew(false);
    }
  };

  const checkForAppUpdate = async () => {
    setCheckingForUpdates(true);
    try {
      const update = await check();
      setAppUpdate(update);
      if (!update) {
        console.log("No updates available");
      }
    } catch (e) {
      console.error("Failed to check for updates:", e);
    } finally {
      setCheckingForUpdates(false);
    }
  };

  const installAppUpdate = async () => {
    if (!appUpdate) return;
    setInstallingUpdate(true);
    setUpdateProgress(0);
    try {
      let downloaded = 0;
      let contentLength = 0;
      await appUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setUpdateProgress(Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === "Finished") {
          setUpdateProgress(100);
        }
      });
      await relaunch();
    } catch (e) {
      console.error("Failed to install update:", e);
      alert(`Update failed: ${e}`);
    } finally {
      setInstallingUpdate(false);
      setUpdateProgress(null);
    }
  };

  const performGlobalSearch = async () => {
    if (!globalSearchQuery.trim() || globalSearchQuery.trim().length < 2) return;
    setSearching(true);
    setHasSearched(false);
    try {
      const results = await invoke<SearchResult[]>("global_search", {
        query: globalSearchQuery,
        scanRoot: scanRoot,
      });
      setGlobalSearchResults(results);
    } catch (e) {
      console.error("Failed to perform global search:", e);
    }
    setSearching(false);
    setHasSearched(true);
  };

  const analyzeBloat = async (release: boolean = true) => {
    if (!selectedProject) return;
    setAnalyzingBloat(true);
    const jobId = `bloat-${Date.now()}`;
    addJob(jobId, `Analyzing ${release ? "release" : "debug"} binary...`);
    try {
      const result = await invoke<BloatAnalysis>("analyze_bloat", {
        projectPath: selectedProject.path,
        release,
      });
      setBloatAnalysis(result);
    } catch (e) {
      console.error("Failed to analyze bloat:", e);
      alert(`Bloat analysis failed: ${e}`);
    }
    removeJob(jobId);
    setAnalyzingBloat(false);
  };

  // All cargo commands use streaming for consistent UX
  const runCargoCommand = async (command: string, args: string[] = []) => {
    if (!selectedProject) return;
    setRunningCommand(command);
    setCommandOutput(null);
    setStreamingOutput([]);
    setIsStreaming(true);
    const jobId = `cargo-${command}-${Date.now()}`;
    addJob(jobId, `cargo ${command}...`);

    try {
      await invoke("run_cargo_command_streaming", {
        projectPath: selectedProject.path,
        command,
        args,
      });
      // Command completion handled by cargo-complete event listener
    } catch (e) {
      console.error("Failed to run command:", e);
      removeJob(jobId);
      setRunningCommand(null);
      setIsStreaming(false);
    }
  };

  const upgradePackage = async (packageName: string) => {
    if (!selectedProject) return;
    setUpgradingPackage(packageName);
    setCommandOutput(null);
    const jobId = `cargo-upgrade-${packageName}-${Date.now()}`;
    addJob(jobId, `cargo upgrade --package ${packageName}...`);
    try {
      const result = await invoke<CargoCommandResult>("run_cargo_command", {
        projectPath: selectedProject.path,
        command: "upgrade",
        args: ["--package", packageName],
      });
      setCommandOutput(result);
    } catch (e) {
      console.error("Failed to upgrade package:", e);
    }
    removeJob(jobId);
    setUpgradingPackage(null);
  };

  const analyzeDependencies = async () => {
    setAnalyzingDeps(true);
    addJob("deps", "Analyzing dependencies...");
    const projectsToAnalyze = projects
      .filter((p) => !p.is_workspace_member)
      .map((p) => p.path);
    try {
      const result = await invoke<DepAnalysis>("analyze_dependencies", {
        projectPaths: projectsToAnalyze,
      });
      setDepAnalysis(result);
      // Save to cache
      await invoke("save_dep_analysis_cache", { analysis: result });
      setDepAnalysisTimestamp(Math.floor(Date.now() / 1000));
    } catch (e) {
      console.error("Failed to analyze dependencies:", e);
    }
    removeJob("deps");
    setAnalyzingDeps(false);
  };

  const analyzeToolchains = async () => {
    setAnalyzingToolchains(true);
    addJob("toolchains", "Analyzing toolchains...");
    const projectsToAnalyze = projects
      .filter((p) => !p.is_workspace_member)
      .map((p) => p.path);
    try {
      const result = await invoke<ToolchainAnalysis>("analyze_toolchains", {
        projectPaths: projectsToAnalyze,
      });
      setToolchainAnalysis(result);
      // Save to cache
      await invoke("save_toolchain_cache", { analysis: result });
      setToolchainTimestamp(Math.floor(Date.now() / 1000));
    } catch (e) {
      console.error("Failed to analyze toolchains:", e);
    }
    removeJob("toolchains");
    setAnalyzingToolchains(false);
  };

  const analyzeLicenses = async () => {
    setAnalyzingLicenses(true);
    addJob("licenses", "Scanning licenses...");
    const projectsToAnalyze = projects
      .filter((p) => !p.is_workspace_member)
      .map((p) => p.path);
    try {
      const result = await invoke<LicenseAnalysis>("check_all_licenses", {
        projectPaths: projectsToAnalyze,
      });
      setLicenseAnalysis(result);
      // Save to cache
      await invoke("save_license_cache", { analysis: result });
      setLicenseTimestamp(Math.floor(Date.now() / 1000));
    } catch (e) {
      console.error("Failed to analyze licenses:", e);
    }
    removeJob("licenses");
    setAnalyzingLicenses(false);
  };

  useEffect(() => {
    loadConfig();
    loadRustVersionInfo();
    checkHomebrewStatus();
    checkRustHomebrewStatus();
    checkForAppUpdate();
  }, []);

  useEffect(() => {
    if (configLoaded && scanRoot) {
      scanProjects(scanRoot);
    }
  }, [configLoaded, scanRoot]);

  const filteredAndSortedProjects = useMemo(() => {
    let filtered = projects.filter((p) => {
      // Filter hidden
      if (!showHidden && hidden.has(p.path)) return false;
      // Filter workspace members
      if (!showWorkspaceMembers && p.is_workspace_member) return false;
      // Filter by name/path search
      if (projectFilter) {
        const query = projectFilter.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesPath = p.path.toLowerCase().includes(query);
        if (!matchesName && !matchesPath) return false;
      }
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      // Favorites always first
      const aFav = favorites.has(a.path);
      const bFav = favorites.has(b.path);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;

      switch (sortBy) {
        case "lastModified":
          return b.last_modified - a.last_modified;
        case "size":
          return b.target_size - a.target_size;
        case "deps":
          return b.dep_count - a.dep_count;
        case "name":
        default:
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
    });

    return filtered;
  }, [projects, favorites, hidden, sortBy, showWorkspaceMembers, showHidden, projectFilter]);

  const stats = useMemo(() => {
    const total = projects.length;
    const workspaceMembers = projects.filter((p) => p.is_workspace_member).length;
    const displayed = filteredAndSortedProjects.length;
    const totalSize = projects.reduce((sum, p) => sum + p.target_size, 0);
    return { total, workspaceMembers, displayed, totalSize };
  }, [projects, filteredAndSortedProjects]);

  const projectsWithTargets = useMemo(() => {
    return projects
      .filter((p) => p.target_size > 0)
      .sort((a, b) => b.target_size - a.target_size);
  }, [projects]);

  const totalCleanableSize = useMemo(() => {
    return projectsWithTargets.reduce((sum, p) => sum + p.target_size, 0);
  }, [projectsWithTargets]);

  const totalFreed = useMemo(() => {
    return cleanResults
      .filter((r) => r.success)
      .reduce((sum, r) => sum + r.freed_bytes, 0);
  }, [cleanResults]);

  const outdatedStats = useMemo(() => {
    const projectsWithOutdated = outdatedResults.filter(
      (r) => r.success && r.dependencies.length > 0
    );
    const totalOutdatedDeps = projectsWithOutdated.reduce(
      (sum, r) => sum + r.dependencies.length,
      0
    );
    return {
      projectsChecked: outdatedResults.filter((r) => r.success).length,
      projectsWithOutdated: projectsWithOutdated.length,
      totalOutdatedDeps,
    };
  }, [outdatedResults]);

  const auditStats = useMemo(() => {
    const projectsWithVulns = auditResults.filter(
      (r) => r.success && r.vulnerabilities.length > 0
    );
    const totalVulns = projectsWithVulns.reduce(
      (sum, r) => sum + r.vulnerabilities.length,
      0
    );
    const totalWarnings = auditResults
      .filter((r) => r.success)
      .reduce((sum, r) => sum + r.warnings.length, 0);
    return {
      projectsChecked: auditResults.filter((r) => r.success).length,
      projectsWithVulns: projectsWithVulns.length,
      totalVulns,
      totalWarnings,
    };
  }, [auditResults]);

  const navItems = [
    { id: "projects" as View, label: "Projects", icon: Folder },
    { id: "search" as View, label: "Search", icon: MagnifyingGlass },
    { id: "cleanup" as View, label: "Cleanup", icon: Broom },
    { id: "dependencies" as View, label: "Dependencies", icon: Package },
    { id: "security" as View, label: "Security", icon: ShieldCheck },
    { id: "health" as View, label: "Health", icon: Heartbeat },
    { id: "analysis" as View, label: "Analysis", icon: ChartBar },
    { id: "licenses" as View, label: "Licenses", icon: Scroll },
    { id: "settings" as View, label: "Settings", icon: Gear },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <nav>
          {navItems.map(({ id, label, icon: Icon }) => (
            <div key={id}>
              <div
                className={`nav-item ${view === id ? "active" : ""}`}
                onClick={() => setView(id)}
              >
                <Icon size={20} />
                {label}
              </div>
              {id === "projects" && favorites.size > 0 && (
                <div className="nav-favorites">
                  {projects
                    .filter((p) => favorites.has(p.path))
                    .map((project) => (
                      <div
                        key={project.path}
                        className="nav-favorite-item"
                        onClick={() => openProjectDetail(project)}
                        title={project.path}
                      >
                        <Star size={12} weight="fill" />
                        {project.name}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        {jobs.length > 0 && (
          <div className="job-queue">
            <div className="job-queue-header">
              <Spinner size={14} className="spinning" />
              Running ({jobs.length})
            </div>
            {jobs.map((job) => (
              <div key={job.id} className="job-item">
                <span className="job-label">{job.label}</span>
                <button
                  className="job-cancel"
                  onClick={() => {
                    removeJob(job.id);
                    // Reset relevant state if this was a cargo command
                    if (job.id.startsWith("cargo-")) {
                      setRunningCommand(null);
                      setIsStreaming(false);
                      setRunningCoverage(false);
                    }
                  }}
                  title="Cancel"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      <main className="main">
        {view === "projects" && (
          <>
            <div className="header-row">
              <h2>
                Projects ({stats.displayed}
                {stats.displayed !== stats.total && ` of ${stats.total}`})
              </h2>
              <span className="total-size">
                {formatBytes(stats.totalSize)} total
              </span>
            </div>

            {scanning ? (
              <div className="loading">Scanning for Rust projects...</div>
            ) : projects.length === 0 ? (
              <div className="empty-state">
                <p>No Rust projects found</p>
                <button onClick={() => scanProjects()}>Scan ~/Workspace</button>
              </div>
            ) : (
              <>
                <div className="toolbar">
                  <button onClick={() => scanProjects()}>Rescan</button>

                  <div className="search-box">
                    <MagnifyingGlass size={16} />
                    <input
                      type="text"
                      placeholder="Filter projects..."
                      value={projectFilter}
                      onChange={(e) => setProjectFilter(e.target.value)}
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                    />
                    {projectFilter && (
                      <button
                        className="clear-filter"
                        onClick={() => setProjectFilter("")}
                        title="Clear filter"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <div className="sort-control">
                    <label>Sort:</label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortBy)}
                    >
                      <option value="lastModified">Last Modified</option>
                      <option value="name">Name</option>
                      <option value="size">Target Size</option>
                      <option value="deps">Dependencies</option>
                    </select>
                    <CaretDown size={14} />
                  </div>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={showWorkspaceMembers}
                      onChange={(e) =>
                        setShowWorkspaceMembers(e.target.checked)
                      }
                    />
                    <TreeStructure size={16} />
                    Show workspace members ({stats.workspaceMembers})
                  </label>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={showHidden}
                      onChange={(e) => setShowHidden(e.target.checked)}
                    />
                    <EyeSlash size={16} />
                    Show hidden ({hidden.size})
                  </label>
                </div>

                <div className="project-grid">
                  {filteredAndSortedProjects.map((project) => (
                    <div
                      key={project.path}
                      className={`project-card clickable ${
                        favorites.has(project.path) ? "favorite" : ""
                      } ${hidden.has(project.path) ? "hidden-project" : ""} ${
                        project.is_workspace_member ? "workspace-member" : ""
                      }`}
                      onClick={() => openProjectDetail(project)}
                    >
                      <div className="card-header">
                        <h3>{project.name}</h3>
                        <div className="card-actions">
                          <button
                            className={`icon-btn ${
                              favorites.has(project.path) ? "active" : ""
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(project.path);
                            }}
                            title={
                              favorites.has(project.path)
                                ? "Remove from favorites"
                                : "Add to favorites"
                            }
                          >
                            <Star
                              size={16}
                              weight={
                                favorites.has(project.path) ? "fill" : "regular"
                              }
                            />
                          </button>
                          <button
                            className={`icon-btn ${
                              hidden.has(project.path) ? "active" : ""
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHidden(project.path);
                            }}
                            title={hidden.has(project.path) ? "Unhide" : "Hide"}
                          >
                            {hidden.has(project.path) ? (
                              <EyeSlash size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                      <p className="path">{project.path}</p>
                      {project.is_workspace_member && (
                        <p className="workspace-badge">workspace member</p>
                      )}
                      <div className="stats">
                        <span className="stat size">
                          {formatBytes(project.target_size)}
                        </span>
                        <span className="stat deps">
                          {project.dep_count} deps
                        </span>
                        <span className="stat time">
                          {formatTimeAgo(project.last_modified)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {view === "search" && (
          <>
            <h2>Search Code</h2>
            <p className="page-description">
              Search across all Rust projects in your workspace.
            </p>

            <div className="toolbar">
              <div className="search-box large">
                <MagnifyingGlass size={18} />
                <input
                  type="text"
                  placeholder="Search code across all projects..."
                  value={globalSearchQuery}
                  onChange={(e) => setGlobalSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && performGlobalSearch()}
                  autoFocus
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {searching ? (
                  <Spinner size={16} className="spinning" />
                ) : (
                  <button
                    onClick={performGlobalSearch}
                    disabled={globalSearchQuery.trim().length < 2}
                  >
                    Search
                  </button>
                )}
              </div>
            </div>

            {globalSearchResults.length > 0 && (
              <div className="search-results full-page">
                <div className="search-results-header">
                  <h3>
                    Results ({globalSearchResults.length}
                    {globalSearchResults.length >= 500 ? "+ - limited" : ""})
                  </h3>
                  <button
                    className="small"
                    onClick={() => {
                      setGlobalSearchResults([]);
                      setHasSearched(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
                <div className="search-results-list">
                  {globalSearchResults.map((result, i) => {
                    // Build highlighted HTML string to avoid React whitespace issues
                    const highlightMatchesHtml = (
                      content: string,
                      matches: SearchMatch[],
                    ): string => {
                      if (!matches || matches.length === 0) {
                        return content
                          .replace(/&/g, "&amp;")
                          .replace(/</g, "&lt;")
                          .replace(/>/g, "&gt;");
                      }

                      let html = "";
                      let lastEnd = 0;

                      matches.forEach((match) => {
                        // Add escaped text before match
                        if (match.start > lastEnd) {
                          html += content
                            .slice(lastEnd, match.start)
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;");
                        }
                        // Add highlighted match
                        const matchText = content
                          .slice(match.start, match.end)
                          .replace(/&/g, "&amp;")
                          .replace(/</g, "&lt;")
                          .replace(/>/g, "&gt;");
                        html += `<mark class="search-highlight">${matchText}</mark>`;
                        lastEnd = match.end;
                      });

                      // Add remaining escaped text
                      if (lastEnd < content.length) {
                        html += content
                          .slice(lastEnd)
                          .replace(/&/g, "&amp;")
                          .replace(/</g, "&lt;")
                          .replace(/>/g, "&gt;");
                      }

                      return html;
                    };

                    return (
                      <div
                        key={`${result.file_path}-${result.line_number}-${i}`}
                        className="search-result-item"
                      >
                        <div className="search-result-header">
                          <div className="search-result-location">
                            <span className="search-result-project">
                              {result.project_name}
                            </span>
                            <span className="search-result-file">
                              {result.file_path.replace(
                                result.project_path + "/",
                                "",
                              )}
                              :{result.line_number}
                            </span>
                          </div>
                          <button
                            className="icon-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              invoke("open_file_in_vscode", {
                                filePath: result.file_path,
                                lineNumber: result.line_number,
                              });
                            }}
                            title="Open in VS Code"
                          >
                            <Code size={16} />
                          </button>
                        </div>
                        <div className="search-result-code">
                          {result.context_before.map((ctx) => (
                            <pre
                              key={`before-${ctx.line_number}`}
                              className="search-context-line"
                            >
                              <span className="line-number">
                                {ctx.line_number}
                              </span>
                              {ctx.content}
                            </pre>
                          ))}
                          <pre
                            className="search-match-line"
                            dangerouslySetInnerHTML={{
                              __html: `<span class="line-number">${result.line_number}</span>${highlightMatchesHtml(result.line_content, result.matches)}`,
                            }}
                          />
                          {result.context_after.map((ctx) => (
                            <pre
                              key={`after-${ctx.line_number}`}
                              className="search-context-line"
                            >
                              <span className="line-number">
                                {ctx.line_number}
                              </span>
                              {ctx.content}
                            </pre>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {globalSearchResults.length === 0 && !searching && hasSearched && (
              <div className="empty-state">
                <p>No results found for "{globalSearchQuery}"</p>
                <p className="hint">
                  Try different keywords or check your scan directory
                </p>
              </div>
            )}

            {!hasSearched && !searching && (
              <div className="empty-state">
                <Code size={48} />
                <p>Enter a search term to find code across all projects</p>
                <p className="hint">
                  Uses ripgrep for fast searching. Minimum 2 characters
                  required.
                </p>
              </div>
            )}
          </>
        )}

        {view === "cleanup" && (
          <>
            <div className="header-row">
              <h2>Cleanup</h2>
              <span className="total-size">
                {formatBytes(totalCleanableSize)} cleanable
                {totalFreed > 0 && ` | ${formatBytes(totalFreed)} freed`}
              </span>
            </div>

            {projectsWithTargets.length === 0 ? (
              <div className="empty-state">
                <p>No build artifacts to clean</p>
                <button onClick={() => scanProjects()}>Rescan Projects</button>
              </div>
            ) : (
              <>
                <div className="toolbar">
                  <button
                    onClick={() => cleanAllProjects(false)}
                    disabled={cleaningAll || cleaningAllDebug}
                  >
                    {cleaningAll ? (
                      <>
                        <Spinner size={16} className="spinning" />
                        Cleaning...
                      </>
                    ) : (
                      <>
                        <Trash size={16} />
                        Clean All ({formatBytes(totalCleanableSize)})
                      </>
                    )}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => cleanAllProjects(true)}
                    disabled={cleaningAll || cleaningAllDebug}
                  >
                    {cleaningAllDebug ? (
                      <>
                        <Spinner size={16} className="spinning" />
                        Cleaning Debug...
                      </>
                    ) : (
                      "Clean Debug Only"
                    )}
                  </button>
                  <button className="secondary" onClick={() => scanProjects()}>
                    Refresh
                  </button>
                </div>

                <div className="cleanup-list">
                  {projectsWithTargets.map((project) => {
                    const result = cleanResults.find(
                      (r) => r.path === project.path,
                    );
                    const isCleaningFull = cleaning.has(project.path);
                    const isCleaningDebug = cleaningDebug.has(project.path);
                    const isCurrentlyCleaning =
                      isCleaningFull || isCleaningDebug;

                    return (
                      <div key={project.path} className="cleanup-row">
                        <div className="cleanup-info">
                          <span className="cleanup-name">{project.name}</span>
                          <span className="cleanup-path">{project.path}</span>
                        </div>
                        <div className="cleanup-size">
                          {formatBytes(project.target_size)}
                        </div>
                        <div className="cleanup-actions">
                          {result ? (
                            result.success ? (
                              <span className="cleanup-success">
                                <CheckCircle size={16} weight="fill" />
                                {result.freed_bytes > 0
                                  ? `Freed ${formatBytes(result.freed_bytes)}`
                                  : "Clean"}
                              </span>
                            ) : (
                              <span
                                className="cleanup-error"
                                title={result.error || ""}
                              >
                                <XCircle size={16} weight="fill" />
                                Failed
                              </span>
                            )
                          ) : isCurrentlyCleaning ? (
                            <span className="cleanup-progress">
                              <Spinner size={16} className="spinning" />
                              {isCleaningDebug
                                ? "Cleaning debug..."
                                : "Cleaning..."}
                            </span>
                          ) : (
                            <>
                              <button
                                className="small"
                                onClick={() =>
                                  cleanProject(
                                    project.path,
                                    false,
                                    project.target_size,
                                  )
                                }
                                disabled={cleaningAll || cleaningAllDebug}
                              >
                                Clean
                              </button>
                              <button
                                className="small secondary"
                                onClick={() =>
                                  cleanProject(
                                    project.path,
                                    true,
                                    project.target_size,
                                  )
                                }
                                disabled={cleaningAll || cleaningAllDebug}
                              >
                                Debug
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {view === "dependencies" && (
          <>
            <div className="header-row">
              <h2>Dependencies</h2>
              {outdatedStats.projectsChecked > 0 && (
                <span className="total-size">
                  {outdatedStats.totalOutdatedDeps} outdated in{" "}
                  {outdatedStats.projectsWithOutdated} projects
                  {outdatedTimestamp &&
                    ` • Last scan: ${formatTimeAgo(outdatedTimestamp)}`}
                </span>
              )}
            </div>

            <div className="toolbar">
              <button onClick={checkAllOutdated} disabled={checkingOutdated}>
                {checkingOutdated ? (
                  <>
                    <Spinner size={16} className="spinning" />
                    Checking...
                  </>
                ) : (
                  <>
                    <Package size={16} />
                    Check All Projects
                  </>
                )}
              </button>
            </div>

            {checkingOutdated ? (
              <div className="empty-state">
                <Spinner size={24} className="spinning" />
                <p>Checking all projects for outdated dependencies...</p>
              </div>
            ) : outdatedResults.length === 0 ? (
              <div className="empty-state">
                <p>
                  Click "Check All Projects" to scan for outdated dependencies
                </p>
              </div>
            ) : (
              <div className="deps-list">
                {outdatedResults
                  .filter((r) => r.success)
                  .sort((a, b) => b.dependencies.length - a.dependencies.length)
                  .map((result) => {
                    const project = projects.find(
                      (p) => p.path === result.project_path,
                    );
                    return (
                      <div key={result.project_path} className="deps-project">
                        <div className="deps-project-header">
                          <div className="deps-project-info">
                            <span
                              className="deps-project-name clickable-project-name"
                              onClick={() =>
                                project && openProjectDetail(project)
                              }
                            >
                              {result.project_name}
                            </span>
                            <span className="deps-project-path">
                              {result.project_path}
                            </span>
                          </div>
                          <div className="deps-project-count">
                            {result.dependencies.length === 0 ? (
                              <span className="deps-uptodate">
                                <CheckCircle size={16} weight="fill" />
                                Up to date
                              </span>
                            ) : (
                              <span className="deps-outdated-count">
                                <Warning size={16} weight="fill" />
                                {result.dependencies.length} outdated
                              </span>
                            )}
                          </div>
                        </div>
                        {result.dependencies.length > 0 && (
                          <div className="deps-table">
                            <div className="deps-table-header">
                              <span>Package</span>
                              <span>Current</span>
                              <span>Latest</span>
                              <span>Type</span>
                            </div>
                            {result.dependencies.map((dep) => (
                              <div key={dep.name} className="deps-table-row">
                                <span className="dep-name">{dep.name}</span>
                                <span className="dep-version dep-current">
                                  {dep.current}
                                </span>
                                <span className="dep-version dep-latest">
                                  <ArrowUp size={12} />
                                  {dep.latest}
                                </span>
                                <span className="dep-kind">{dep.kind}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                {outdatedResults.filter((r) => !r.success).length > 0 && (
                  <div className="deps-errors">
                    <h4>Errors</h4>
                    {outdatedResults
                      .filter((r) => !r.success)
                      .map((result) => (
                        <div
                          key={result.project_path}
                          className="deps-error-row"
                        >
                          <span>{result.project_name}</span>
                          <span className="error-text">{result.error}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {view === "security" && (
          <>
            <div className="header-row">
              <h2>Security Audit</h2>
              {auditStats.projectsChecked > 0 && (
                <span className="total-size">
                  {auditStats.totalVulns} vulnerabilities,{" "}
                  {auditStats.totalWarnings} warnings
                  {auditTimestamp &&
                    ` • Last scan: ${formatTimeAgo(auditTimestamp)}`}
                </span>
              )}
            </div>

            <div className="toolbar">
              <button onClick={checkAllAudits} disabled={checkingAudit}>
                {checkingAudit ? (
                  <>
                    <Spinner size={16} className="spinning" />
                    Auditing...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    Audit All Projects
                  </>
                )}
              </button>
            </div>

            {auditResults.length === 0 && !checkingAudit ? (
              <div className="empty-state">
                <p>
                  Click "Audit All Projects" to scan for security
                  vulnerabilities
                </p>
              </div>
            ) : (
              <div className="deps-list">
                {auditResults
                  .filter((r) => r.success)
                  .sort(
                    (a, b) =>
                      b.vulnerabilities.length - a.vulnerabilities.length,
                  )
                  .map((result) => {
                    const project = projects.find(
                      (p) => p.path === result.project_path,
                    );
                    return (
                      <div key={result.project_path} className="deps-project">
                        <div className="deps-project-header">
                          <div className="deps-project-info">
                            <span
                              className="deps-project-name clickable-project-name"
                              onClick={() =>
                                project && openProjectDetail(project)
                              }
                            >
                              {result.project_name}
                            </span>
                            <span className="deps-project-path">
                              {result.project_path}
                            </span>
                          </div>
                          <div className="deps-project-count">
                            {result.vulnerabilities.length === 0 &&
                            result.warnings.length === 0 ? (
                              <span className="deps-uptodate">
                                <CheckCircle size={16} weight="fill" />
                                Secure
                              </span>
                            ) : (
                              <span className="deps-outdated-count">
                                <Warning size={16} weight="fill" />
                                {result.vulnerabilities.length} vulns,{" "}
                                {result.warnings.length} warnings
                              </span>
                            )}
                          </div>
                        </div>
                        {result.vulnerabilities.length > 0 && (
                          <div className="audit-section">
                            <h4
                              className="audit-section-title"
                              style={{ color: "var(--error)" }}
                            >
                              Vulnerabilities
                            </h4>
                            {result.vulnerabilities.map((vuln) => (
                              <div
                                key={vuln.id}
                                className="audit-item vulnerability"
                              >
                                <div className="audit-item-header">
                                  <span className="audit-id">{vuln.id}</span>
                                  <span className="audit-pkg">
                                    {vuln.package}@{vuln.version}
                                  </span>
                                </div>
                                <p className="audit-title">{vuln.title}</p>
                                {vuln.url && (
                                  <a
                                    href={vuln.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="audit-link"
                                  >
                                    View Advisory
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {result.warnings.length > 0 && (
                          <div className="audit-section">
                            <h4
                              className="audit-section-title"
                              style={{ color: "var(--warning)" }}
                            >
                              Warnings ({result.warnings.length})
                            </h4>
                            <div className="audit-warnings-summary">
                              {result.warnings.slice(0, 5).map((warn) => (
                                <span
                                  key={warn.advisory_id}
                                  className="audit-warning-badge"
                                  title={warn.title}
                                >
                                  {warn.package} ({warn.kind})
                                </span>
                              ))}
                              {result.warnings.length > 5 && (
                                <span className="audit-warning-badge">
                                  +{result.warnings.length - 5} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                {auditResults.filter((r) => !r.success).length > 0 && (
                  <div className="deps-errors">
                    <h4>Errors</h4>
                    {auditResults
                      .filter((r) => !r.success)
                      .map((result) => (
                        <div
                          key={result.project_path}
                          className="deps-error-row"
                        >
                          <span>{result.project_name}</span>
                          <span className="error-text">{result.error}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {view === "health" && (
          <>
            <div className="header-row">
              <h2>Toolchain Consistency</h2>
              {toolchainAnalysis && (
                <span className="total-size">
                  {toolchainAnalysis.toolchain_groups.length} toolchain
                  versions, {toolchainAnalysis.msrv_groups.length} MSRV versions
                  {toolchainTimestamp &&
                    ` • Last scan: ${formatTimeAgo(toolchainTimestamp)}`}
                </span>
              )}
            </div>

            <div className="toolbar">
              <button
                onClick={analyzeToolchains}
                disabled={analyzingToolchains}
              >
                {analyzingToolchains ? (
                  <>
                    <Spinner size={16} className="spinning" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Heartbeat size={16} />
                    Analyze Toolchains
                  </>
                )}
              </button>
            </div>

            {!toolchainAnalysis && !analyzingToolchains ? (
              <div className="empty-state">
                <p>
                  Click "Analyze Toolchains" to check rust-toolchain.toml files
                  and MSRV settings
                </p>
              </div>
            ) : (
              toolchainAnalysis && (
                <>
                  {toolchainAnalysis.has_mismatches && (
                    <div className="toolchain-warning">
                      <Warning size={20} weight="fill" />
                      <span>
                        Toolchain or MSRV mismatches detected across projects
                      </span>
                    </div>
                  )}

                  <div className="analysis-section">
                    <h3>
                      Toolchain Versions (
                      {toolchainAnalysis.toolchain_groups.length})
                    </h3>
                    <p className="section-description">
                      Rust toolchain versions specified in rust-toolchain.toml
                    </p>
                    <div className="analysis-list">
                      {toolchainAnalysis.toolchain_groups.map((group) => (
                        <div key={group.version} className="analysis-item">
                          <div className="analysis-item-header">
                            <span className="version-badge">
                              {group.version}
                            </span>
                            <span className="analysis-count">
                              {group.projects.length} projects
                            </span>
                          </div>
                          <div className="version-projects">
                            {group.projects.join(", ")}
                          </div>
                        </div>
                      ))}
                      {toolchainAnalysis.toolchain_groups.length === 0 && (
                        <p className="no-items">
                          No rust-toolchain.toml files found
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="analysis-section">
                    <h3>
                      MSRV Settings ({toolchainAnalysis.msrv_groups.length})
                    </h3>
                    <p className="section-description">
                      Minimum Supported Rust Version from package.rust-version
                      in Cargo.toml
                    </p>
                    <div className="analysis-list">
                      {toolchainAnalysis.msrv_groups.map((group) => (
                        <div key={group.version} className="analysis-item">
                          <div className="analysis-item-header">
                            <span className="version-badge">
                              {group.version}
                            </span>
                            <span className="analysis-count">
                              {group.projects.length} projects
                            </span>
                          </div>
                          <div className="version-projects">
                            {group.projects.join(", ")}
                          </div>
                        </div>
                      ))}
                      {toolchainAnalysis.msrv_groups.length === 0 && (
                        <p className="no-items">No MSRV settings found</p>
                      )}
                    </div>
                  </div>

                  <div className="analysis-section">
                    <h3>All Projects</h3>
                    <div className="toolchain-table">
                      <div className="toolchain-table-header">
                        <span>Project</span>
                        <span>Toolchain</span>
                        <span>MSRV</span>
                      </div>
                      {toolchainAnalysis.projects.map((proj) => (
                        <div
                          key={proj.project_path}
                          className="toolchain-table-row"
                        >
                          <span className="toolchain-project-name">
                            {proj.project_name}
                          </span>
                          <span className="toolchain-version">
                            {proj.toolchain || "-"}
                          </span>
                          <span className="toolchain-version">
                            {proj.msrv || "-"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )
            )}
          </>
        )}

        {view === "analysis" && (
          <>
            <div className="header-row">
              <h2>Dependency Analysis</h2>
              {depAnalysis && (
                <span className="total-size">
                  {depAnalysis.total_unique_deps} deps,{" "}
                  {depAnalysis.deps_with_mismatches} with version mismatches
                  {depAnalysisTimestamp &&
                    ` • Last scan: ${formatTimeAgo(depAnalysisTimestamp)}`}
                </span>
              )}
            </div>

            <div className="toolbar">
              <button onClick={analyzeDependencies} disabled={analyzingDeps}>
                {analyzingDeps ? (
                  <>
                    <Spinner size={16} className="spinning" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <ChartBar size={16} />
                    Analyze Dependencies
                  </>
                )}
              </button>
            </div>

            {!depAnalysis && !analyzingDeps ? (
              <div className="empty-state">
                <p>
                  Click "Analyze Dependencies" to scan Cargo.toml files across
                  projects
                </p>
              </div>
            ) : (
              depAnalysis && (
                <>
                  <div className="analysis-section">
                    <h3>
                      Version Mismatches ({depAnalysis.deps_with_mismatches})
                    </h3>
                    <p className="section-description">
                      Dependencies with different versions across projects
                    </p>
                    <div className="analysis-list">
                      {depAnalysis.dependencies
                        .filter((d) => d.versions.length > 1)
                        .map((dep) => (
                          <div
                            key={dep.name}
                            className="analysis-item mismatch"
                          >
                            <div className="analysis-item-header">
                              <span className="analysis-dep-name">
                                {dep.name}
                              </span>
                              <span className="analysis-count">
                                {dep.project_count} projects
                              </span>
                            </div>
                            <div className="analysis-versions">
                              {dep.versions.map((v) => (
                                <div key={v.version} className="version-row">
                                  <span className="version-badge">
                                    {v.version}
                                  </span>
                                  <span className="version-projects">
                                    {v.projects.join(", ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      {depAnalysis.dependencies.filter(
                        (d) => d.versions.length > 1,
                      ).length === 0 && (
                        <p className="no-items">No version mismatches found</p>
                      )}
                    </div>
                  </div>

                  <div className="analysis-section">
                    <h3>Most Used Dependencies</h3>
                    <p className="section-description">
                      Dependencies ranked by usage across projects
                    </p>
                    <div className="analysis-list">
                      {depAnalysis.dependencies.slice(0, 30).map((dep) => (
                        <div
                          key={dep.name}
                          className={`analysis-item ${dep.versions.length > 1 ? "has-mismatch" : ""}`}
                        >
                          <div className="analysis-item-header">
                            <span className="analysis-dep-name">
                              {dep.name}
                            </span>
                            <span className="analysis-count">
                              {dep.project_count} projects
                            </span>
                          </div>
                          <div className="analysis-versions inline">
                            {dep.versions.map((v) => (
                              <span
                                key={v.version}
                                className="version-badge small"
                              >
                                {v.version} ({v.projects.length})
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )
            )}
          </>
        )}

        {view === "licenses" && (
          <>
            <div className="header-row">
              <h2>License Compliance</h2>
              {licenseAnalysis && (
                <span className="total-size">
                  {licenseAnalysis.total_packages} packages,{" "}
                  {licenseAnalysis.problematic_count} potentially problematic
                  {licenseTimestamp &&
                    ` • Last scan: ${formatTimeAgo(licenseTimestamp)}`}
                </span>
              )}
            </div>

            <div className="toolbar">
              <button onClick={analyzeLicenses} disabled={analyzingLicenses}>
                {analyzingLicenses ? (
                  <>
                    <Spinner size={16} className="spinning" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Scroll size={16} />
                    Scan All Licenses
                  </>
                )}
              </button>
            </div>

            {!licenseAnalysis && !analyzingLicenses ? (
              <div className="empty-state">
                <p>
                  Click "Scan All Licenses" to analyze license usage across
                  projects
                </p>
              </div>
            ) : (
              licenseAnalysis && (
                <>
                  {licenseAnalysis.problematic_count > 0 && (
                    <div className="toolchain-warning">
                      <Warning size={20} weight="fill" />
                      <span>
                        {licenseAnalysis.problematic_count} packages with
                        potentially problematic licenses (GPL, AGPL, etc.)
                      </span>
                    </div>
                  )}

                  <div className="analysis-section">
                    <h3>Potentially Problematic Licenses</h3>
                    <p className="section-description">
                      Licenses that may have viral/copyleft requirements (GPL,
                      AGPL, LGPL, etc.)
                    </p>
                    <div className="analysis-list">
                      {licenseAnalysis.license_groups
                        .filter((g) => g.is_problematic)
                        .map((group) => (
                          <div
                            key={group.license}
                            className="analysis-item mismatch"
                          >
                            <div className="analysis-item-header">
                              <span className="version-badge problematic">
                                {group.license}
                              </span>
                              <span className="analysis-count">
                                {group.packages.length} packages
                              </span>
                            </div>
                            <div className="version-projects">
                              {group.packages.slice(0, 10).join(", ")}
                              {group.packages.length > 10 &&
                                ` ...and ${group.packages.length - 10} more`}
                            </div>
                          </div>
                        ))}
                      {licenseAnalysis.license_groups.filter(
                        (g) => g.is_problematic,
                      ).length === 0 && (
                        <p className="no-items">
                          No problematic licenses found
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="analysis-section">
                    <h3>
                      All License Types ({licenseAnalysis.license_groups.length}
                      )
                    </h3>
                    <p className="section-description">
                      License distribution across all dependencies
                    </p>
                    <div className="analysis-list">
                      {licenseAnalysis.license_groups
                        .filter((g) => !g.is_problematic)
                        .slice(0, 30)
                        .map((group) => (
                          <div key={group.license} className="analysis-item">
                            <div className="analysis-item-header">
                              <span className="version-badge">
                                {group.license}
                              </span>
                              <span className="analysis-count">
                                {group.packages.length} packages
                              </span>
                            </div>
                            <div className="version-projects">
                              {group.packages.slice(0, 10).join(", ")}
                              {group.packages.length > 10 &&
                                ` ...and ${group.packages.length - 10} more`}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="analysis-section">
                    <h3>Per-Project Results</h3>
                    <div className="deps-list">
                      {licenseAnalysis.projects
                        .filter((p) => p.success)
                        .sort((a, b) => b.licenses.length - a.licenses.length)
                        .map((result) => {
                          const project = projects.find(
                            (p) => p.path === result.project_path,
                          );
                          return (
                            <div
                              key={result.project_path}
                              className="deps-project"
                            >
                              <div className="deps-project-header">
                                <div className="deps-project-info">
                                  <span
                                    className="deps-project-name clickable-project-name"
                                    onClick={() =>
                                      project && openProjectDetail(project)
                                    }
                                  >
                                    {result.project_name}
                                  </span>
                                  <span className="deps-project-path">
                                    {result.project_path}
                                  </span>
                                </div>
                                <div className="deps-project-count">
                                  <span className="deps-uptodate">
                                    {result.licenses.length} dependencies
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      {licenseAnalysis.projects.filter((r) => !r.success)
                        .length > 0 && (
                        <div className="deps-errors">
                          <h4>Errors</h4>
                          {licenseAnalysis.projects
                            .filter((r) => !r.success)
                            .map((result) => (
                              <div
                                key={result.project_path}
                                className="deps-error-row"
                              >
                                <span>{result.project_name}</span>
                                <span className="error-text">
                                  {result.error}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )
            )}
          </>
        )}

        {view === "project-detail" && selectedProject && (
          <>
            <div className="project-detail-header">
              <div className="project-detail-info">
                <div className="info-row title-row">
                  <button
                    className="icon-btn back-btn"
                    onClick={() => setView("projects")}
                  >
                    <ArrowLeft size={20} />
                  </button>
                  {workspaceInfo?.is_member_of_workspace &&
                    workspaceInfo.parent_workspace_name && (
                      <button
                        className="parent-workspace-link"
                        onClick={() => {
                          const parent = projects.find(
                            (p) =>
                              p.path === workspaceInfo.parent_workspace_path,
                          );
                          if (parent) openProjectDetail(parent);
                        }}
                        title={`Go to parent workspace: ${workspaceInfo.parent_workspace_path}`}
                      >
                        {workspaceInfo.parent_workspace_name}
                        <span className="breadcrumb-sep">›</span>
                      </button>
                    )}
                  <h2>{selectedProject.name}</h2>
                </div>
                <div className="info-row badges-row">
                  {msrvInfo?.edition && (
                    <span className="badge badge-muted" title="Rust Edition">
                      {msrvInfo.edition}
                    </span>
                  )}
                  {msrvInfo?.msrv && (
                    <span
                      className="badge badge-rust"
                      title="Minimum Supported Rust Version"
                    >
                      MSRV {msrvInfo.msrv}
                    </span>
                  )}
                  {githubActionsStatus?.has_workflows && (
                    <span
                      className="badge badge-ci"
                      title="Has GitHub Actions workflows"
                    >
                      <GitBranch size={12} /> CI
                    </span>
                  )}
                  {workspaceInfo?.is_workspace && (
                    <span
                      className="badge badge-workspace"
                      title={`Workspace with ${workspaceInfo.members.length} members`}
                    >
                      <FolderOpen size={12} /> {workspaceInfo.members.length}{" "}
                      crates
                    </span>
                  )}
                  {workspaceInfo?.is_workspace &&
                    workspaceInfo.members.length > 0 && (
                      <select
                        className="workspace-select"
                        value={
                          workspaceInfo.members.find((m) => m.is_current)
                            ?.path || ""
                        }
                        onChange={(e) => {
                          const project = projects.find(
                            (p) => p.path === e.target.value,
                          );
                          if (project) openProjectDetail(project);
                        }}
                      >
                        {workspaceInfo.members.map((member) => (
                          <option key={member.path} value={member.path}>
                            {member.name} {member.is_current ? "(current)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                </div>
                <div className="info-row path-row">
                  <button
                    className="detail-path clickable"
                    onClick={() =>
                      invoke("open_in_finder", { path: selectedProject.path })
                    }
                    title="Open in Finder"
                  >
                    <FolderOpen size={14} />
                    {selectedProject.path}
                  </button>
                  <button
                    className="icon-btn"
                    onClick={openInVSCode}
                    title="Open in VS Code"
                  >
                    <Code size={16} />
                  </button>
                </div>
                {gitInfo?.github_url && (
                  <div className="info-row github-row">
                    <a
                      href={gitInfo.github_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="github-link"
                    >
                      <GithubLogo size={16} weight="fill" />
                      {gitInfo.github_url.replace("https://github.com/", "")}
                    </a>
                  </div>
                )}
              </div>
              <div className="project-stats-compact">
                <div className="stat-row">
                  <span className="stat-label">Modified</span>
                  <span className="stat-value">
                    {formatTimeAgo(selectedProject.last_modified)}
                  </span>
                </div>
                {binarySizes?.release && (
                  <div className="stat-row">
                    <span className="stat-label">Binary</span>
                    <span className="stat-value">
                      {formatBytes(binarySizes.release)}
                    </span>
                  </div>
                )}
                {gitInfo && (
                  <div className="stat-row">
                    <span className="stat-label">Commits</span>
                    <span className="stat-value">
                      {gitInfo.commit_count.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="detail-tabs">
              <button
                className={`detail-tab ${projectDetailTab === "commands" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("commands")}
              >
                <Code size={16} />
                Commands
              </button>
              <button
                className={`detail-tab ${projectDetailTab === "tests" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("tests")}
              >
                <Bug size={16} />
                Tests
              </button>
              <button
                className={`detail-tab ${projectDetailTab === "cleanup" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("cleanup")}
              >
                <Broom size={16} />
                Cleanup
                {selectedProject.target_size > 0 && (
                  <span className="tab-badge">
                    {formatBytes(selectedProject.target_size)}
                  </span>
                )}
              </button>
              <button
                className={`detail-tab ${projectDetailTab === "dependencies" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("dependencies")}
              >
                <Package size={16} />
                Dependencies
                {selectedProject.dep_count > 0 && (
                  <span className="tab-badge">{selectedProject.dep_count}</span>
                )}
              </button>
              <button
                className={`detail-tab ${projectDetailTab === "docs" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("docs")}
              >
                <Book size={16} />
                Docs
              </button>
              <button
                className={`detail-tab ${projectDetailTab === "security" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("security")}
              >
                <ShieldCheck size={16} />
                Security
              </button>
              <button
                className={`detail-tab ${projectDetailTab === "licenses" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("licenses")}
              >
                <Scroll size={16} />
                Licenses
              </button>
              <button
                className={`detail-tab ${projectDetailTab === "cargo-toml" ? "active" : ""}`}
                onClick={() => {
                  setProjectDetailTab("cargo-toml");
                  if (!cargoTomlContent) loadCargoToml();
                }}
              >
                <FileCode size={16} />
                Cargo.toml
              </button>
            </div>

            {projectDetailTab === "commands" && (
              <div className="commands-layout">
                <div className="commands-panel">
                  <div className="command-groups">
                    <div className="command-group">
                      <h4 className="command-group-label">Build & Run</h4>
                      <div className="command-grid">
                        <button
                          onClick={() => runCargoCommand("check", ["--quiet"])}
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "check" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <Code size={16} />
                          )}
                          Check
                        </button>
                        <button
                          onClick={() => runCargoCommand("build", ["--quiet"])}
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "build" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <Wrench size={16} />
                          )}
                          Build
                        </button>
                        <button
                          onClick={() =>
                            runCargoCommand("build", ["--release", "--quiet"])
                          }
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "build" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <Wrench size={16} />
                          )}
                          Build Release
                        </button>
                        <button
                          onClick={() => runCargoCommand("run", [])}
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "run" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <Play size={16} />
                          )}
                          Run
                        </button>
                      </div>
                    </div>

                    <div className="command-group">
                      <h4 className="command-group-label">Code Quality</h4>
                      <div className="command-grid">
                        <button
                          onClick={() =>
                            runCargoCommand("fmt", ["--", "--check"])
                          }
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "fmt" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <FileCode size={16} />
                          )}
                          Fmt Check
                        </button>
                        <button
                          onClick={() => runCargoCommand("fmt", [])}
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "fmt" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <FileCode size={16} />
                          )}
                          Fmt
                        </button>
                        <button
                          onClick={() =>
                            runCargoCommand("clippy", ["--", "-D", "warnings"])
                          }
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "clippy" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <Warning size={16} />
                          )}
                          Clippy
                        </button>
                        <button
                          onClick={() =>
                            runCargoCommand("clippy", [
                              "--fix",
                              "--allow-dirty",
                              "--allow-staged",
                              "--quiet",
                            ])
                          }
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "clippy" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <Warning size={16} />
                          )}
                          Clippy Fix
                        </button>
                      </div>
                    </div>

                    <div className="command-group">
                      <h4 className="command-group-label">Info</h4>
                      <div className="command-grid">
                        <button
                          onClick={() =>
                            runCargoCommand("doc", ["--no-deps", "--quiet"])
                          }
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "doc" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <FileCode size={16} />
                          )}
                          Doc
                        </button>
                        <button
                          onClick={() =>
                            runCargoCommand("tree", ["--color", "always"])
                          }
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "tree" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <Tree size={16} />
                          )}
                          Tree
                        </button>
                      </div>
                    </div>

                    <div className="command-group">
                      <h4 className="command-group-label">Maintenance</h4>
                      <div className="command-grid">
                        <button
                          onClick={() => runCargoCommand("update", ["--quiet"])}
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "update" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <ArrowsClockwise size={16} />
                          )}
                          Update
                        </button>
                        <button
                          onClick={() => runCargoCommand("audit", [])}
                          disabled={runningCommand !== null}
                          className="command-btn"
                        >
                          {runningCommand === "audit" ? (
                            <Spinner size={16} className="spinning" />
                          ) : (
                            <ShieldCheck size={16} />
                          )}
                          Audit
                        </button>
                      </div>
                    </div>
                  </div>

                  {cargoFeatures && cargoFeatures.features.length > 0 && (
                    <div className="cargo-features-section">
                      <h4 className="command-group-label">Features</h4>
                      <div className="feature-toggles">
                        {cargoFeatures.features.map((feature) => (
                          <label key={feature.name} className="feature-toggle">
                            <input
                              type="checkbox"
                              checked={selectedFeatures.has(feature.name)}
                              onChange={(e) => {
                                const newFeatures = new Set(selectedFeatures);
                                if (e.target.checked) {
                                  newFeatures.add(feature.name);
                                } else {
                                  newFeatures.delete(feature.name);
                                }
                                setSelectedFeatures(newFeatures);
                              }}
                            />
                            <span className="feature-name">{feature.name}</span>
                            {feature.is_default && (
                              <span className="feature-badge">default</span>
                            )}
                            {feature.dependencies.length > 0 && (
                              <span
                                className="feature-deps"
                                title={feature.dependencies.join(", ")}
                              >
                                +{feature.dependencies.length}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="output-panel">
                  {runningCommand && !isStreaming && (
                    <div className="command-running">
                      <Spinner size={20} className="spinning" />
                      Running cargo {runningCommand}...
                    </div>
                  )}

                  {isStreaming && (
                    <div className="command-output">
                      <div className="command-output-header">
                        <span className="command-status running">
                          <Spinner size={16} className="spinning" /> Running
                        </span>
                        <span className="command-name">
                          cargo {runningCommand}
                        </span>
                      </div>
                      <pre
                        ref={outputRef}
                        className="command-output-text streaming"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            streamingOutput
                              .map((line) => ansiConverter.current.toHtml(line))
                              .join("\n") || "(waiting for output...)",
                          ),
                        }}
                      />
                    </div>
                  )}

                  {commandOutput && !isStreaming && (
                    <div className="command-output">
                      <div className="command-output-header">
                        <span
                          className={`command-status ${commandOutput.success ? "success" : "error"}`}
                        >
                          {commandOutput.success ? (
                            <>
                              <CheckCircle size={16} weight="fill" /> Success
                            </>
                          ) : (
                            <>
                              <XCircle size={16} weight="fill" /> Failed (exit
                              code: {commandOutput.exit_code})
                            </>
                          )}
                        </span>
                        <span className="command-name">
                          cargo {commandOutput.command}
                        </span>
                      </div>
                      <pre
                        className="command-output-text"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            streamingOutput.length > 0
                              ? streamingOutput
                                  .map((line) =>
                                    ansiConverter.current.toHtml(line),
                                  )
                                  .join("\n")
                              : ansiConverter.current.toHtml(
                                  commandOutput.stdout ||
                                    commandOutput.stderr ||
                                    "(no output)",
                                ),
                          ),
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {projectDetailTab === "tests" && (
              <div className="detail-tab-content tests-tab">
                <div className="tests-toolbar">
                  <button
                    onClick={() =>
                      runCargoCommand("test", ["--color", "always"])
                    }
                    disabled={runningCommand !== null}
                    className="test-btn primary"
                  >
                    {runningCommand === "test" ? (
                      <Spinner size={16} className="spinning" />
                    ) : (
                      <Bug size={16} />
                    )}
                    Run Tests
                  </button>
                  <button
                    onClick={() => runCargoCommand("bench", [])}
                    disabled={runningCommand !== null}
                    className="test-btn"
                  >
                    {runningCommand === "bench" ? (
                      <Spinner size={16} className="spinning" />
                    ) : (
                      <Timer size={16} />
                    )}
                    Run Benchmarks
                  </button>
                  <button
                    onClick={() => {
                      setCoverageError(null);
                      setCoverageResult(null);
                      setRunningCoverage(true);
                      runCargoCommand("tarpaulin", ["--out", "Json", "--output-dir", "target"]);
                    }}
                    disabled={runningCommand !== null || runningCoverage}
                    className="test-btn"
                    title="Run code coverage with cargo-tarpaulin"
                  >
                    {runningCommand === "tarpaulin" || runningCoverage ? (
                      <Spinner size={16} className="spinning" />
                    ) : (
                      <Cpu size={16} />
                    )}
                    Run Coverage
                  </button>
                </div>

                {/* Test Output Section */}
                {(commandOutput &&
                  (commandOutput.command === "test" ||
                    commandOutput.command === "bench" ||
                    commandOutput.command === "tarpaulin")) ||
                (isStreaming &&
                  (runningCommand === "test" || runningCommand === "bench" || runningCommand === "tarpaulin")) ? (
                  <div className="test-results">
                    <div className="test-results-header">
                      <h4>
                        {(commandOutput?.command || runningCommand) === "test"
                          ? "Test Results"
                          : (commandOutput?.command || runningCommand) === "tarpaulin"
                          ? "Coverage Output"
                          : "Benchmark Results"}
                      </h4>
                      {commandOutput && !isStreaming ? (
                        <span
                          className={`test-status-badge ${commandOutput.success ? "passed" : "failed"}`}
                        >
                          {commandOutput.success ? (
                            <>
                              <CheckCircle size={14} /> Passed
                            </>
                          ) : (
                            <>
                              <XCircle size={14} /> Failed
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="test-status-badge running">
                          <Spinner size={14} className="spinning" /> Running...
                        </span>
                      )}
                    </div>
                    <pre
                      className="test-output"
                      ref={outputRef}
                      dangerouslySetInnerHTML={{
                        __html:
                          streamingOutput.length > 0
                            ? streamingOutput
                                .map((line) =>
                                  ansiConverter.current.toHtml(line),
                                )
                                .join("\n")
                            : commandOutput
                              ? ansiConverter.current.toHtml(
                                  commandOutput.stdout ||
                                    commandOutput.stderr ||
                                    "(no output)",
                                )
                              : "",
                      }}
                    />
                  </div>
                ) : null}

                {/* Coverage Section */}
                {coverageError && (
                  <div className="coverage-error">
                    <XCircle size={16} />
                    <span>{coverageError}</span>
                  </div>
                )}

                {coverageResult && (
                  <div className="coverage-results">
                    <div className="coverage-header">
                      <h4>Code Coverage</h4>
                      <span
                        className={`coverage-badge ${coverageResult.coverage_percent >= 80 ? "good" : coverageResult.coverage_percent >= 50 ? "medium" : "low"}`}
                      >
                        {coverageResult.coverage_percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="coverage-summary">
                      <span>
                        {coverageResult.total_covered} /{" "}
                        {coverageResult.total_coverable} lines covered
                      </span>
                    </div>
                    <div className="coverage-files">
                      <h5>Files by Coverage</h5>
                      <div className="coverage-list">
                        {coverageResult.files.slice(0, 20).map((file, i) => (
                          <div key={i} className="coverage-item">
                            <span
                              className="coverage-file-name"
                              title={file.path || "unknown"}
                            >
                              {(file.path || "unknown").split("/").pop()}
                            </span>
                            <div className="coverage-bar-container">
                              <div
                                className={`coverage-bar ${file.percent >= 80 ? "good" : file.percent >= 50 ? "medium" : "low"}`}
                                style={{
                                  width: `${Math.min(file.percent, 100)}%`,
                                }}
                              />
                            </div>
                            <span className="coverage-percent">
                              {file.percent.toFixed(0)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {projectDetailTab === "cleanup" && (
              <div className="detail-tab-content">
                {/* Build Artifacts Section */}
                <div className="cleanup-section">
                  <h3>Build Artifacts</h3>
                  {selectedProject.target_size > 0 ? (
                    <>
                      <p className="tab-description">
                        Clean build artifacts to free up{" "}
                        {formatBytes(selectedProject.target_size)} of disk
                        space.
                      </p>
                      <div className="cleanup-actions-row">
                        <button
                          onClick={() =>
                            cleanProject(
                              selectedProject.path,
                              false,
                              selectedProject.target_size,
                            )
                          }
                          disabled={
                            cleaning.has(selectedProject.path) ||
                            cleaningDebug.has(selectedProject.path)
                          }
                        >
                          {cleaning.has(selectedProject.path) ? (
                            <>
                              <Spinner size={16} className="spinning" />{" "}
                              Cleaning...
                            </>
                          ) : (
                            <>
                              <Trash size={16} /> Clean All (
                              {formatBytes(selectedProject.target_size)})
                            </>
                          )}
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            cleanProject(
                              selectedProject.path,
                              true,
                              selectedProject.target_size,
                            )
                          }
                          disabled={
                            cleaning.has(selectedProject.path) ||
                            cleaningDebug.has(selectedProject.path)
                          }
                        >
                          {cleaningDebug.has(selectedProject.path) ? (
                            <>
                              <Spinner size={16} className="spinning" />{" "}
                              Cleaning Debug...
                            </>
                          ) : (
                            "Clean Debug Only"
                          )}
                        </button>
                      </div>
                      {cleanResults.find(
                        (r) => r.path === selectedProject.path,
                      ) && (
                        <div className="cleanup-result">
                          {cleanResults.find(
                            (r) => r.path === selectedProject.path,
                          )!.success ? (
                            <span className="cleanup-success">
                              <CheckCircle size={16} weight="fill" />
                              Freed{" "}
                              {formatBytes(
                                cleanResults.find(
                                  (r) => r.path === selectedProject.path,
                                )!.freed_bytes,
                              )}
                            </span>
                          ) : (
                            <span className="cleanup-error">
                              <XCircle size={16} weight="fill" />
                              {
                                cleanResults.find(
                                  (r) => r.path === selectedProject.path,
                                )!.error
                              }
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="tab-description muted">
                      No build artifacts to clean.
                    </p>
                  )}
                </div>

                {/* Binary Size Analysis Section */}
                <div className="cleanup-section">
                  <h3>Binary Size Analysis</h3>
                  <p className="tab-description">
                    Analyze what's taking up space in your compiled binary.
                  </p>
                  <div className="cleanup-actions-row">
                    <button
                      onClick={() => analyzeBloat(true)}
                      disabled={analyzingBloat}
                    >
                      {analyzingBloat ? (
                        <>
                          <Spinner size={16} className="spinning" />{" "}
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <ChartBar size={16} /> Analyze Release Build
                        </>
                      )}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => analyzeBloat(false)}
                      disabled={analyzingBloat}
                    >
                      Analyze Debug Build
                    </button>
                  </div>

                  {bloatAnalysis && (
                    <div className="bloat-results">
                      <div className="bloat-summary-bar">
                        <div className="bloat-stat">
                          <span className="bloat-stat-label">Total Size</span>
                          <span className="bloat-stat-value">
                            {formatBytes(bloatAnalysis.file_size)}
                          </span>
                        </div>
                        <div className="bloat-stat">
                          <span className="bloat-stat-label">Code Section</span>
                          <span className="bloat-stat-value">
                            {formatBytes(bloatAnalysis.text_size)}
                          </span>
                        </div>
                      </div>

                      <div className="bloat-section">
                        <h4>Top Crates by Size</h4>
                        <div className="bloat-bar-list">
                          {bloatAnalysis.crates.slice(0, 15).map((crate, i) => (
                            <div key={i} className="bloat-bar-item">
                              <div className="bloat-bar-header">
                                <span className="bloat-bar-name">
                                  {crate.name}
                                </span>
                                <span className="bloat-bar-size">
                                  {formatBytes(crate.size)} (
                                  {crate.size_percent.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="bloat-bar-track">
                                <div
                                  className="bloat-bar-fill"
                                  style={{
                                    width: `${Math.min(crate.size_percent * 2, 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bloat-section">
                        <h4>Top Functions by Size</h4>
                        <div className="bloat-fn-list">
                          {bloatAnalysis.functions.slice(0, 15).map((fn, i) => (
                            <div key={i} className="bloat-fn-item">
                              <span className="bloat-fn-name" title={fn.name}>
                                {fn.name.length > 60
                                  ? fn.name.slice(0, 60) + "..."
                                  : fn.name}
                              </span>
                              <span className="bloat-fn-size">
                                {formatBytes(fn.size)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {projectDetailTab === "dependencies" && (
              <div className="detail-tab-content">
                <div className="toolbar">
                  <button
                    onClick={checkProjectOutdated}
                    disabled={
                      checkingProjectOutdated || runningCommand !== null
                    }
                  >
                    {checkingProjectOutdated ? (
                      <>
                        <Spinner size={16} className="spinning" /> Checking...
                      </>
                    ) : (
                      <>
                        <Package size={16} /> Check Outdated
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => runCargoCommand("upgrade", [])}
                    disabled={
                      runningCommand !== null || checkingProjectOutdated
                    }
                    title="Updates Cargo.toml to latest versions (cargo upgrade)"
                  >
                    {runningCommand === "upgrade" ? (
                      <>
                        <Spinner size={16} className="spinning" /> Upgrading...
                      </>
                    ) : (
                      <>
                        <ArrowUp size={16} /> Upgrade All
                      </>
                    )}
                  </button>
                </div>
                {commandOutput &&
                  (commandOutput.command === "upgrade" ||
                    commandOutput.command.startsWith("upgrade ")) && (
                    <div
                      className="command-output"
                      style={{ marginBottom: 16 }}
                    >
                      <div className="command-output-header">
                        <span
                          className={`command-status ${commandOutput.success ? "success" : "error"}`}
                        >
                          {commandOutput.success ? (
                            <>
                              <CheckCircle size={16} weight="fill" /> Upgraded
                            </>
                          ) : (
                            <>
                              <XCircle size={16} weight="fill" /> Failed
                            </>
                          )}
                        </span>
                        <span className="command-name">
                          cargo {commandOutput.command}
                        </span>
                      </div>
                      <pre
                        className="command-output-text"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            ansiConverter.current.toHtml(
                              commandOutput.stdout ||
                                commandOutput.stderr ||
                                "(no output)",
                            ),
                          ),
                        }}
                      />
                    </div>
                  )}
                {projectOutdated ? (
                  projectOutdated.success ? (
                    projectOutdated.dependencies.length === 0 ? (
                      <div className="deps-status-good">
                        <CheckCircle size={20} weight="fill" />
                        All dependencies are up to date
                      </div>
                    ) : (
                      <>
                        <div className="deps-table">
                          <div className="deps-table-header deps-table-header-with-action">
                            <span>Package</span>
                            <span>Current</span>
                            <span>Latest</span>
                            <span>Type</span>
                            <span></span>
                          </div>
                          {projectOutdated.dependencies.map((dep) => (
                            <div
                              key={dep.name}
                              className="deps-table-row deps-table-row-with-action"
                            >
                              <span className="dep-name">{dep.name}</span>
                              <span className="dep-version dep-current">
                                {dep.current}
                              </span>
                              <span className="dep-version dep-latest">
                                <ArrowUp size={12} />
                                {dep.latest}
                              </span>
                              <span className="dep-kind">{dep.kind}</span>
                              <span className="dep-action">
                                <button
                                  className="small"
                                  onClick={() => upgradePackage(dep.name)}
                                  disabled={
                                    runningCommand !== null ||
                                    upgradingPackage !== null
                                  }
                                  title={`Upgrade ${dep.name} to ${dep.latest}`}
                                >
                                  {upgradingPackage === dep.name ? (
                                    <Spinner size={12} className="spinning" />
                                  ) : (
                                    <ArrowUp size={12} />
                                  )}
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="deps-help-text">
                          Click{" "}
                          <ArrowUp
                            size={12}
                            style={{ verticalAlign: "middle" }}
                          />{" "}
                          to upgrade individual packages in Cargo.toml
                        </p>
                      </>
                    )
                  ) : (
                    <div className="deps-error-message">
                      <XCircle size={16} weight="fill" />
                      {projectOutdated.error}
                    </div>
                  )
                ) : checkingProjectOutdated ? (
                  <div className="empty-state">
                    <Spinner size={24} className="spinning" />
                    <p>Checking for outdated dependencies...</p>
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>
                      Click "Check Outdated" to scan for outdated dependencies
                    </p>
                  </div>
                )}
              </div>
            )}

            {projectDetailTab === "security" && (
              <div className="detail-tab-content">
                <div className="toolbar">
                  <button
                    onClick={checkProjectAudit}
                    disabled={checkingProjectAudit}
                  >
                    {checkingProjectAudit ? (
                      <>
                        <Spinner size={16} className="spinning" /> Auditing...
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={16} /> Run Audit
                      </>
                    )}
                  </button>
                </div>
                {projectAudit ? (
                  projectAudit.success ? (
                    projectAudit.vulnerabilities.length === 0 &&
                    projectAudit.warnings.length === 0 ? (
                      <div className="deps-status-good">
                        <CheckCircle size={20} weight="fill" />
                        No vulnerabilities found
                      </div>
                    ) : (
                      <>
                        {projectAudit.vulnerabilities.length > 0 && (
                          <div className="audit-section">
                            <h4
                              className="audit-section-title"
                              style={{ color: "var(--error)" }}
                            >
                              Vulnerabilities (
                              {projectAudit.vulnerabilities.length})
                            </h4>
                            {projectAudit.vulnerabilities.map((vuln) => (
                              <div
                                key={vuln.id}
                                className="audit-item vulnerability"
                              >
                                <div className="audit-item-header">
                                  <span className="audit-id">{vuln.id}</span>
                                  <span className="audit-pkg">
                                    {vuln.package}@{vuln.version}
                                  </span>
                                </div>
                                <p className="audit-title">{vuln.title}</p>
                                {vuln.url && (
                                  <a
                                    href={vuln.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="audit-link"
                                  >
                                    View Advisory
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {projectAudit.warnings.length > 0 && (
                          <div className="audit-section">
                            <h4
                              className="audit-section-title"
                              style={{ color: "var(--warning)" }}
                            >
                              Warnings ({projectAudit.warnings.length})
                            </h4>
                            <div className="audit-warnings-summary">
                              {projectAudit.warnings.map((warn) => (
                                <span
                                  key={warn.advisory_id}
                                  className="audit-warning-badge"
                                  title={warn.title}
                                >
                                  {warn.package} ({warn.kind})
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )
                  ) : (
                    <div className="deps-error-message">
                      <XCircle size={16} weight="fill" />
                      {projectAudit.error}
                    </div>
                  )
                ) : (
                  <div className="empty-state">
                    <p>
                      Click "Run Audit" to scan for security vulnerabilities
                    </p>
                  </div>
                )}
              </div>
            )}

            {projectDetailTab === "licenses" && (
              <div className="detail-tab-content">
                <div className="toolbar">
                  <button
                    onClick={checkProjectLicenses}
                    disabled={checkingProjectLicenses}
                  >
                    {checkingProjectLicenses ? (
                      <>
                        <Spinner size={16} className="spinning" /> Scanning...
                      </>
                    ) : (
                      <>
                        <Scroll size={16} /> Scan Licenses
                      </>
                    )}
                  </button>
                </div>
                {projectLicenses ? (
                  projectLicenses.success ? (
                    projectLicenses.licenses.length === 0 ? (
                      <div className="empty-state">
                        <p>No dependencies found</p>
                      </div>
                    ) : (
                      <>
                        <p className="tab-description">
                          {projectLicenses.licenses.length} dependencies scanned
                        </p>
                        <div className="license-table">
                          <div className="license-table-header">
                            <span>Package</span>
                            <span>Version</span>
                            <span>License</span>
                          </div>
                          {projectLicenses.licenses.map((lic) => (
                            <div
                              key={`${lic.name}-${lic.version}`}
                              className="license-table-row"
                            >
                              <span className="license-name">{lic.name}</span>
                              <span className="license-version">
                                {lic.version}
                              </span>
                              <span
                                className={`license-type ${lic.license.toLowerCase().includes("gpl") ? "problematic" : ""}`}
                              >
                                {lic.license}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )
                  ) : (
                    <div className="deps-error-message">
                      <XCircle size={16} weight="fill" />
                      {projectLicenses.error}
                    </div>
                  )
                ) : (
                  <div className="empty-state">
                    <p>Click "Scan Licenses" to analyze dependency licenses</p>
                  </div>
                )}
              </div>
            )}

            {projectDetailTab === "cargo-toml" && (
              <div className="detail-tab-content">
                {loadingCargoToml ? (
                  <div className="empty-state">
                    <Spinner size={24} className="spinning" />
                    <p>Loading Cargo.toml...</p>
                  </div>
                ) : cargoTomlContent ? (
                  <pre
                    className="cargo-toml-content"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(
                        hljs.highlight(cargoTomlContent, { language: "toml" })
                          .value,
                      ),
                    }}
                  />
                ) : (
                  <div className="empty-state">
                    <p>Failed to load Cargo.toml</p>
                  </div>
                )}
              </div>
            )}

            {projectDetailTab === "docs" && (
              <div className="detail-tab-content docs-tab">
                <div className="toolbar">
                  <button
                    onClick={generateProjectDocs}
                    disabled={generatingDocs}
                  >
                    {generatingDocs ? (
                      <>
                        <Spinner size={16} className="spinning" /> Generating...
                      </>
                    ) : (
                      <>
                        <Book size={16} /> Generate Docs
                      </>
                    )}
                  </button>
                </div>
                {generatingDocs ? (
                  <div className="empty-state">
                    <Spinner size={24} className="spinning" />
                    <p>Generating documentation...</p>
                  </div>
                ) : docPath ? (
                  <iframe
                    src={`asset://localhost/${encodeURI(docPath)}`}
                    className="docs-iframe"
                    title="Documentation"
                  />
                ) : docError ? (
                  <div className="empty-state">
                    <XCircle size={24} />
                    <p>{docError}</p>
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>Click "Generate Docs" to build and view documentation</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {view === "settings" && (
          <>
            <h2>Settings</h2>

            <div className="settings-section">
              <h3>Scan Directory</h3>
              <p className="settings-description">
                Choose the root folder to scan for Rust projects.
              </p>
              <div className="settings-row">
                <input
                  type="text"
                  value={scanRootInput}
                  onChange={(e) => setScanRootInput(e.target.value)}
                  className="settings-input"
                  placeholder="Path to scan..."
                />
                <button
                  className="secondary"
                  onClick={async () => {
                    const selected = await open({
                      directory: true,
                      multiple: false,
                      defaultPath: scanRootInput || undefined,
                    });
                    if (selected) {
                      setScanRootInput(selected as string);
                    }
                  }}
                >
                  <FolderOpen size={16} />
                  Browse
                </button>
                <button
                  onClick={saveScanRoot}
                  disabled={scanRootInput === scanRoot}
                >
                  Save & Rescan
                </button>
              </div>
              {scanRoot && (
                <p className="settings-current">Current: {scanRoot}</p>
              )}
            </div>

            <div className="settings-section">
              <h3>Statistics</h3>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{stats.total}</span>
                  <span className="stat-label">Total Projects</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">
                    {formatBytes(stats.totalSize)}
                  </span>
                  <span className="stat-label">Total Build Size</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{favorites.size}</span>
                  <span className="stat-label">Favorites</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{hidden.size}</span>
                  <span className="stat-label">Hidden</span>
                </div>
              </div>
            </div>

            {rustVersionInfo && (
              <div className="settings-section">
                <h3>Environment</h3>
                <div className="rust-version-info">
                  <div className="version-row">
                    <span className="version-label">
                      <Gear size={16} /> Rust Helper
                    </span>
                    <span className="version-value version-with-status">
                      {homebrewStatus?.current_version
                        ? `v${homebrewStatus.current_version}`
                        : "v0.1.0"}
                      {homebrewStatus?.installed_via_homebrew ? (
                        homebrewStatus.update_available ? (
                          <span className="update-indicator">
                            <span className="update-badge">
                              v{homebrewStatus.latest_version} available
                            </span>
                            <button
                              onClick={upgradeHomebrew}
                              disabled={upgradingHomebrew}
                              className="upgrade-btn small"
                            >
                              {upgradingHomebrew ? (
                                <Spinner size={12} className="spinning" />
                              ) : (
                                <ArrowUp size={12} />
                              )}
                              Upgrade
                            </button>
                          </span>
                        ) : (
                          <span className="up-to-date" title="Up to date">
                            <CheckCircle size={14} weight="fill" />
                          </span>
                        )
                      ) : appUpdate ? (
                        <span className="update-indicator">
                          <span className="update-badge">
                            v{appUpdate.version} available
                          </span>
                          <button
                            onClick={installAppUpdate}
                            disabled={installingUpdate}
                            className="upgrade-btn small"
                          >
                            {installingUpdate ? (
                              <>
                                <Spinner size={12} className="spinning" />
                                {updateProgress !== null &&
                                  `${updateProgress}%`}
                              </>
                            ) : (
                              <>
                                <ArrowUp size={12} />
                                Update
                              </>
                            )}
                          </button>
                        </span>
                      ) : checkingForUpdates ? (
                        <Spinner size={14} className="spinning" />
                      ) : (
                        <button
                          onClick={checkForAppUpdate}
                          className="icon-btn"
                          title="Check for updates"
                        >
                          <ArrowsClockwise size={14} />
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="version-row">
                    <span className="version-label">
                      <Cpu size={16} /> Rust Compiler
                    </span>
                    <span className="version-value version-with-status">
                      {rustVersionInfo.rustc_version || "Not installed"}
                      {rustHomebrewStatus?.installed_via_homebrew &&
                        (rustHomebrewStatus.update_available ? (
                          <span className="update-indicator">
                            <span className="update-badge">
                              v{rustHomebrewStatus.latest_version} available
                            </span>
                            <button
                              onClick={upgradeRustHomebrew}
                              disabled={upgradingRustHomebrew}
                              className="upgrade-btn small"
                            >
                              {upgradingRustHomebrew ? (
                                <Spinner size={12} className="spinning" />
                              ) : (
                                <ArrowUp size={12} />
                              )}
                              Upgrade
                            </button>
                          </span>
                        ) : (
                          <span className="up-to-date" title="Up to date">
                            <CheckCircle size={14} weight="fill" />
                          </span>
                        ))}
                    </span>
                  </div>
                  <div className="version-row">
                    <span className="version-label">
                      <Package size={16} /> Cargo
                    </span>
                    <span className="version-value">
                      {rustVersionInfo.cargo_version || "Not installed"}
                    </span>
                  </div>
                  {rustVersionInfo.active_toolchain && (
                    <div className="version-row">
                      <span className="version-label">
                        <Wrench size={16} /> Active Toolchain
                      </span>
                      <span className="version-value">
                        {rustVersionInfo.active_toolchain}
                      </span>
                    </div>
                  )}
                  {rustVersionInfo.installed_toolchains.length > 1 && (
                    <div className="version-row">
                      <span className="version-label">
                        Installed Toolchains
                      </span>
                      <span className="version-value toolchain-list">
                        {rustVersionInfo.installed_toolchains.map((tc) => (
                          <span
                            key={tc}
                            className={`toolchain-badge ${tc === rustVersionInfo.active_toolchain ? "active" : ""}`}
                          >
                            {tc}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="settings-section">
              <h3>Required Tools</h3>
              <p className="settings-description">
                These cargo plugins are required for full functionality.
              </p>
              <div className="toolbar" style={{ marginBottom: 16 }}>
                <button onClick={checkRequiredTools} disabled={checkingTools}>
                  {checkingTools ? (
                    <>
                      <Spinner size={16} className="spinning" /> Checking...
                    </>
                  ) : (
                    <>
                      <ArrowsClockwise size={16} /> Refresh
                    </>
                  )}
                </button>
              </div>
              <div className="tools-list">
                {requiredTools.map((tool) => (
                  <div
                    key={tool.name}
                    className={`tool-item ${tool.installed ? "installed" : "missing"}`}
                  >
                    <div className="tool-info">
                      <span className="tool-name">{tool.name}</span>
                      <span className="tool-description">
                        {tool.description}
                      </span>
                    </div>
                    <div className="tool-status">
                      {tool.installed ? (
                        <span className="tool-installed">
                          <CheckCircle size={16} weight="fill" />
                          Installed
                        </span>
                      ) : (
                        <button
                          className="small"
                          onClick={() => queueToolInstall(tool)}
                          disabled={
                            installingTools.has(tool.name) ||
                            installQueue.some((t) => t.name === tool.name)
                          }
                        >
                          {installingTools.has(tool.name) ? (
                            <>
                              <Spinner size={14} className="spinning" />{" "}
                              Installing...
                            </>
                          ) : installQueue.some((t) => t.name === tool.name) ? (
                            <>Queued...</>
                          ) : (
                            <>Install</>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
