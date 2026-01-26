import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Folder,
  Broom,
  Package,
  ShieldCheck,
  Heartbeat,
  ChartBar,
  Gear,
} from "@phosphor-icons/react";

type View =
  | "projects"
  | "cleanup"
  | "dependencies"
  | "security"
  | "health"
  | "analysis"
  | "settings";

interface Project {
  name: string;
  path: string;
  target_size: number;
  dep_count: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function App() {
  const [view, setView] = useState<View>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [scanning, setScanning] = useState(false);

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

  useEffect(() => {
    scanProjects();
  }, []);

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
            <h2>Projects ({projects.length})</h2>
            {scanning ? (
              <div className="loading">Scanning for Rust projects...</div>
            ) : projects.length === 0 ? (
              <div className="empty-state">
                <p>No Rust projects found</p>
                <button onClick={scanProjects}>Scan ~/Workspace</button>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <button onClick={scanProjects}>Rescan</button>
                </div>
                <div className="project-grid">
                  {projects.map((project) => (
                    <div key={project.path} className="project-card">
                      <h3>{project.name}</h3>
                      <p className="path">{project.path}</p>
                      <div className="stats">
                        <span className="stat size">
                          {formatBytes(project.target_size)}
                        </span>
                        <span className="stat deps">
                          {project.dep_count} deps
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
