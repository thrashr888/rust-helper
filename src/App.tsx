import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
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
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";

type View =
  | "projects"
  | "cleanup"
  | "dependencies"
  | "security"
  | "health"
  | "analysis"
  | "settings";

type SortBy = "name" | "lastModified" | "size" | "deps";

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
  const [cleanResults, setCleanResults] = useState<CleanResult[]>([]);
  const [cleaningAll, setCleaningAll] = useState(false);
  const [outdatedResults, setOutdatedResults] = useState<OutdatedResult[]>([]);
  const [checkingOutdated, setCheckingOutdated] = useState(false);
  const [scanRoot, setScanRoot] = useState<string>("");
  const [scanRootInput, setScanRootInput] = useState<string>("");
  const [configLoaded, setConfigLoaded] = useState(false);

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
      setConfigLoaded(true);
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  };

  const scanProjects = async (rootPath?: string) => {
    const pathToScan = rootPath || scanRoot;
    if (!pathToScan) return;

    setScanning(true);
    try {
      const found = await invoke<Project[]>("scan_projects", {
        rootPath: pathToScan,
      });
      setProjects(found);
    } catch (e) {
      console.error("Failed to scan projects:", e);
    }
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

  const cleanProject = async (projectPath: string, debugOnly: boolean = false) => {
    setCleaning((prev) => new Set(prev).add(projectPath));
    try {
      const result = await invoke<CleanResult>("clean_project", {
        projectPath,
        debugOnly,
      });
      setCleanResults((prev) => [...prev.filter((r) => r.path !== projectPath), result]);
      // Refresh project list to update sizes
      await scanProjects();
    } catch (e) {
      console.error("Failed to clean project:", e);
    }
    setCleaning((prev) => {
      const next = new Set(prev);
      next.delete(projectPath);
      return next;
    });
  };

  const cleanAllProjects = async (debugOnly: boolean = false) => {
    setCleaningAll(true);
    setCleanResults([]);
    const projectsToClean = projectsWithTargets.map((p) => p.path);
    try {
      const results = await invoke<CleanResult[]>("clean_projects", {
        projectPaths: projectsToClean,
        debugOnly,
      });
      setCleanResults(results);
      await scanProjects();
    } catch (e) {
      console.error("Failed to clean projects:", e);
    }
    setCleaningAll(false);
  };

  const checkAllOutdated = async () => {
    setCheckingOutdated(true);
    setOutdatedResults([]);
    // Only check non-workspace-member projects
    const projectsToCheck = projects
      .filter((p) => !p.is_workspace_member)
      .map((p) => p.path);
    try {
      const results = await invoke<OutdatedResult[]>("check_all_outdated", {
        projectPaths: projectsToCheck,
      });
      setOutdatedResults(results);
    } catch (e) {
      console.error("Failed to check outdated:", e);
    }
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

  const navItems = [
    { id: "projects" as View, label: "Projects", icon: Folder },
    { id: "cleanup" as View, label: "Cleanup", icon: Broom },
    { id: "dependencies" as View, label: "Dependencies", icon: Package },
    { id: "security" as View, label: "Security", icon: ShieldCheck },
    { id: "health" as View, label: "Health", icon: Heartbeat },
    { id: "analysis" as View, label: "Analysis", icon: ChartBar },
    { id: "settings" as View, label: "Settings", icon: Gear },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Rust Helper</h1>
        <nav>
          {navItems.map(({ id, label, icon: Icon }) => (
            <div
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => setView(id)}
            >
              <Icon size={20} />
              {label}
            </div>
          ))}
        </nav>
      </aside>

      <main className="main">
        {view === "projects" && (
          <>
            <div className="header-row">
              <h2>
                Projects ({stats.displayed}
                {stats.displayed !== stats.total && ` of ${stats.total}`})
              </h2>
              <span className="total-size">{formatBytes(stats.totalSize)} total</span>
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
                      onChange={(e) => setShowWorkspaceMembers(e.target.checked)}
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
                      className={`project-card ${
                        favorites.has(project.path) ? "favorite" : ""
                      } ${hidden.has(project.path) ? "hidden-project" : ""} ${
                        project.is_workspace_member ? "workspace-member" : ""
                      }`}
                    >
                      <div className="card-header">
                        <h3>{project.name}</h3>
                        <div className="card-actions">
                          <button
                            className={`icon-btn ${
                              favorites.has(project.path) ? "active" : ""
                            }`}
                            onClick={() => toggleFavorite(project.path)}
                            title={
                              favorites.has(project.path)
                                ? "Remove from favorites"
                                : "Add to favorites"
                            }
                          >
                            <Star
                              size={16}
                              weight={favorites.has(project.path) ? "fill" : "regular"}
                            />
                          </button>
                          <button
                            className={`icon-btn ${
                              hidden.has(project.path) ? "active" : ""
                            }`}
                            onClick={() => toggleHidden(project.path)}
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
                        <span className="stat deps">{project.dep_count} deps</span>
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
                    disabled={cleaningAll}
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
                    disabled={cleaningAll}
                  >
                    Clean Debug Only
                  </button>
                  <button className="secondary" onClick={() => scanProjects()}>
                    Refresh
                  </button>
                </div>

                <div className="cleanup-list">
                  {projectsWithTargets.map((project) => {
                    const result = cleanResults.find((r) => r.path === project.path);
                    const isCurrentlyCleaning = cleaning.has(project.path);

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
                              <span className="cleanup-error" title={result.error || ""}>
                                <XCircle size={16} weight="fill" />
                                Failed
                              </span>
                            )
                          ) : isCurrentlyCleaning ? (
                            <span className="cleanup-progress">
                              <Spinner size={16} className="spinning" />
                              Cleaning...
                            </span>
                          ) : (
                            <>
                              <button
                                className="small"
                                onClick={() => cleanProject(project.path, false)}
                              >
                                Clean
                              </button>
                              <button
                                className="small secondary"
                                onClick={() => cleanProject(project.path, true)}
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
              <span className="toolbar-note">
                Requires: cargo install cargo-outdated
              </span>
            </div>

            {outdatedResults.length === 0 && !checkingOutdated ? (
              <div className="empty-state">
                <p>Click "Check All Projects" to scan for outdated dependencies</p>
              </div>
            ) : (
              <div className="deps-list">
                {outdatedResults
                  .filter((r) => r.success)
                  .sort((a, b) => b.dependencies.length - a.dependencies.length)
                  .map((result) => (
                    <div key={result.project_path} className="deps-project">
                      <div className="deps-project-header">
                        <div className="deps-project-info">
                          <span className="deps-project-name">
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
                  ))}
                {outdatedResults.filter((r) => !r.success).length > 0 && (
                  <div className="deps-errors">
                    <h4>Errors</h4>
                    {outdatedResults
                      .filter((r) => !r.success)
                      .map((result) => (
                        <div key={result.project_path} className="deps-error-row">
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
            <h2>Security Audit</h2>
            <p style={{ color: "var(--text-secondary)" }}>
              Run cargo audit across all projects.
            </p>
          </>
        )}

        {view === "health" && (
          <>
            <h2>Health Checks</h2>
            <p style={{ color: "var(--text-secondary)" }}>
              Run fmt, clippy, and tests across projects.
            </p>
          </>
        )}

        {view === "analysis" && (
          <>
            <h2>Dependency Analysis</h2>
            <p style={{ color: "var(--text-secondary)" }}>
              Analyze dependency usage across projects.
            </p>
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
                <p className="settings-current">
                  Current: {scanRoot}
                </p>
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
                  <span className="stat-value">{formatBytes(stats.totalSize)}</span>
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
          </>
        )}
      </main>
    </div>
  );
}

export default App;
