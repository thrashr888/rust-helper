import { Star, Eye, EyeSlash } from "@phosphor-icons/react";
import type { Project } from "../types";
import { formatBytes, formatTimeAgo } from "../utils/formatting";

interface ProjectCardProps {
  project: Project;
  isFavorite: boolean;
  isHidden: boolean;
  onToggleFavorite: (path: string) => void;
  onToggleHidden: (path: string) => void;
  onClick: (project: Project) => void;
}

export function ProjectCard({
  project,
  isFavorite,
  isHidden,
  onToggleFavorite,
  onToggleHidden,
  onClick,
}: ProjectCardProps) {
  return (
    <div
      className={`project-card clickable ${isFavorite ? "favorite" : ""} ${
        isHidden ? "hidden-project" : ""
      } ${project.is_workspace_member ? "workspace-member" : ""}`}
      onClick={() => onClick(project)}
    >
      <div className="card-header">
        <h3>{project.name}</h3>
        <div className="card-actions">
          <button
            className={`icon-btn ${isFavorite ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(project.path);
            }}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Star size={16} weight={isFavorite ? "fill" : "regular"} />
          </button>
          <button
            className={`icon-btn ${isHidden ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleHidden(project.path);
            }}
            title={isHidden ? "Unhide" : "Hide"}
          >
            {isHidden ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <p className="path">{project.path}</p>
      {project.is_workspace_member && (
        <p className="workspace-badge">workspace member</p>
      )}
      <div className="stats">
        <span className="stat size">{formatBytes(project.target_size)}</span>
        <span className="stat deps">{project.dep_count} deps</span>
        <span className="stat time">{formatTimeAgo(project.last_modified)}</span>
      </div>
    </div>
  );
}
