import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Folder,
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
} from "@phosphor-icons/react";

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

  const loadConfig = async () => {
    try {
      const favs = await invoke<string[]>("get_favorites");
      setFavorites(new Set(favs));
      const hid = await invoke<string[]>("get_hidden");
      setHidden(new Set(hid));
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  };

  const scanProjects = async () => {
    setScanning(true);
    try {
      const found = await invoke<Project[]>("scan_projects", {
        rootPath: "/Users/thrashr888/Workspace",
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

  useEffect(() => {
    loadConfig();
    scanProjects();
  }, []);

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
                <button onClick={scanProjects}>Scan ~/Workspace</button>
              </div>
            ) : (
              <>
                <div className="toolbar">
                  <button onClick={scanProjects}>Rescan</button>

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
            <h2>Cleanup</h2>
            <p style={{ color: "var(--text-secondary)" }}>
              Clean build artifacts from your Rust projects.
            </p>
          </>
        )}

        {view === "dependencies" && (
          <>
            <h2>Dependencies</h2>
            <p style={{ color: "var(--text-secondary)" }}>
              Check for outdated dependencies across projects.
            </p>
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
            <p style={{ color: "var(--text-secondary)" }}>
              Configure scan directories and preferences.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
