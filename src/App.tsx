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
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";

type View =
  | "projects"
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
  | "cleanup"
  | "dependencies"
  | "security"
  | "licenses"
  | "cargo-toml";

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
      }>("cargo-complete", (event) => {
        setIsStreaming(false);
        setRunningCommand(null);
        // Remove any pending job
        jobs.forEach((job) => {
          if (job.id.startsWith("cargo-")) removeJob(job.id);
        });
        // Convert streaming output to command result
        setCommandOutput({
          project_path: event.payload.project_path,
          command: event.payload.command,
          success: event.payload.success,
          stdout: "", // Output is in streamingOutput
          stderr: "",
          exit_code: event.payload.exit_code,
        });
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

  const openProjectDetail = (project: Project) => {
    setSelectedProject(project);
    setCommandOutput(null);
    setProjectDetailTab("commands");
    setProjectOutdated(null);
    setProjectAudit(null);
    setProjectLicenses(null);
    setCargoTomlContent(null);
    setView("project-detail");
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

  // Commands that benefit from streaming output
  const streamingCommands = ["run", "bench", "test", "audit", "clippy"];

  const runCargoCommand = async (command: string, args: string[] = []) => {
    if (!selectedProject) return;
    setRunningCommand(command);
    setCommandOutput(null);
    setStreamingOutput([]);
    const jobId = `cargo-${command}-${Date.now()}`;
    addJob(jobId, `cargo ${command}...`);

    // Use streaming for slow commands
    if (streamingCommands.includes(command)) {
      setIsStreaming(true);
      try {
        await invoke("run_cargo_command_streaming", {
          projectPath: selectedProject.path,
          command,
          args,
        });
        // The command completion will be handled by the event listener
      } catch (e) {
        console.error("Failed to run streaming command:", e);
        removeJob(jobId);
        setRunningCommand(null);
        setIsStreaming(false);
      }
    } else {
      // Use regular command for fast commands
      try {
        const result = await invoke<CargoCommandResult>("run_cargo_command", {
          projectPath: selectedProject.path,
          command,
          args,
        });
        setCommandOutput(result);
      } catch (e) {
        console.error("Failed to run command:", e);
      }
      removeJob(jobId);
      setRunningCommand(null);
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
  }, [projects, favorites, hidden, sortBy, showWorkspaceMembers, showHidden]);

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
                {job.label}
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
            <div className="header-row">
              <button
                className="icon-btn back-btn"
                onClick={() => setView("projects")}
              >
                <ArrowLeft size={20} />
              </button>
              <h2>{selectedProject.name}</h2>
            </div>
            <p className="detail-path">{selectedProject.path}</p>

            <div className="project-stats">
              <div className="stat-card">
                <span className="stat-value">
                  {formatBytes(selectedProject.target_size)}
                </span>
                <span className="stat-label">Target Size</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{selectedProject.dep_count}</span>
                <span className="stat-label">Dependencies</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">
                  {formatTimeAgo(selectedProject.last_modified)}
                </span>
                <span className="stat-label">Last Modified</span>
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
                className={`detail-tab ${projectDetailTab === "cleanup" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("cleanup")}
              >
                <Broom size={16} />
                Cleanup
              </button>
              <button
                className={`detail-tab ${projectDetailTab === "dependencies" ? "active" : ""}`}
                onClick={() => setProjectDetailTab("dependencies")}
              >
                <Package size={16} />
                Dependencies
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
              <>
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
                    onClick={() => runCargoCommand("build", ["--release", "--quiet"])}
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
                  <button
                    onClick={() => runCargoCommand("test", [])}
                    disabled={runningCommand !== null}
                    className="command-btn"
                  >
                    {runningCommand === "test" ? (
                      <Spinner size={16} className="spinning" />
                    ) : (
                      <Bug size={16} />
                    )}
                    Test
                  </button>
                  <button
                    onClick={() => runCargoCommand("fmt", ["--", "--check"])}
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
                      runCargoCommand("clippy", ["--fix", "--allow-dirty", "--allow-staged", "--quiet"])
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
                  <button
                    onClick={() => runCargoCommand("doc", ["--no-deps", "--quiet"])}
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
                    onClick={() => runCargoCommand("tree", [])}
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
                  <button
                    onClick={() => runCargoCommand("bench", [])}
                    disabled={runningCommand !== null}
                    className="command-btn"
                  >
                    {runningCommand === "bench" ? (
                      <Spinner size={16} className="spinning" />
                    ) : (
                      <Timer size={16} />
                    )}
                    Bench
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
                            .join("\n") || "(waiting for output...)"
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
                                .map((line) => ansiConverter.current.toHtml(line))
                                .join("\n")
                            : ansiConverter.current.toHtml(
                                commandOutput.stdout ||
                                  commandOutput.stderr ||
                                  "(no output)"
                              )
                        ),
                      }}
                    />
                  </div>
                )}
              </>
            )}

            {projectDetailTab === "cleanup" && (
              <div className="detail-tab-content">
                {selectedProject.target_size > 0 ? (
                  <>
                    <p className="tab-description">
                      Clean build artifacts to free up{" "}
                      {formatBytes(selectedProject.target_size)} of disk space.
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
                            <Spinner size={16} className="spinning" /> Cleaning
                            Debug...
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
                  <div className="empty-state">
                    <p>No build artifacts to clean</p>
                  </div>
                )}
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
                                "(no output)"
                            )
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
                        hljs.highlight(cargoTomlContent, { language: "toml" }).value
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

            <div className="settings-section">
              <h3>Required Tools</h3>
              <p className="settings-description">
                These cargo plugins are required for full functionality.
              </p>
              <div className="toolbar" style={{ marginBottom: 16 }}>
                <button onClick={checkRequiredTools} disabled={checkingTools}>
                  {checkingTools ? (
                    <><Spinner size={16} className="spinning" /> Checking...</>
                  ) : (
                    <><ArrowsClockwise size={16} /> Refresh</>
                  )}
                </button>
              </div>
              <div className="tools-list">
                {requiredTools.map((tool) => (
                  <div key={tool.name} className={`tool-item ${tool.installed ? "installed" : "missing"}`}>
                    <div className="tool-info">
                      <span className="tool-name">{tool.name}</span>
                      <span className="tool-description">{tool.description}</span>
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
                          disabled={installingTools.has(tool.name) || installQueue.some((t) => t.name === tool.name)}
                        >
                          {installingTools.has(tool.name) ? (
                            <><Spinner size={14} className="spinning" /> Installing...</>
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
