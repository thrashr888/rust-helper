import {
  Folder,
  Broom,
  Package,
  ShieldCheck,
  Heartbeat,
  ChartBar,
  Gear,
  Star,
  Scroll,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import type { View, Project, BackgroundJob } from "../types";
import { GearSpinner } from "./GearSpinner";

interface SidebarProps {
  view: View;
  setView: (view: View) => void;
  projects: Project[];
  favorites: Set<string>;
  jobs: BackgroundJob[];
  removeJob: (id: string) => void;
  openProjectDetail: (project: Project) => void;
  onCancelCargoCommand: () => void;
}

const navItems: { id: View; label: string; icon: React.ComponentType<{ size: number }> }[] = [
  { id: "projects", label: "Projects", icon: Folder },
  { id: "search", label: "Search", icon: MagnifyingGlass },
  { id: "cleanup", label: "Cleanup", icon: Broom },
  { id: "dependencies", label: "Dependencies", icon: Package },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "health", label: "Health", icon: Heartbeat },
  { id: "analysis", label: "Analysis", icon: ChartBar },
  { id: "licenses", label: "Licenses", icon: Scroll },
  { id: "settings", label: "Settings", icon: Gear },
];

export function Sidebar({
  view,
  setView,
  projects,
  favorites,
  jobs,
  removeJob,
  openProjectDetail,
  onCancelCargoCommand,
}: SidebarProps) {
  return (
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
            <GearSpinner size={14} />
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
                    onCancelCargoCommand();
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
  );
}
