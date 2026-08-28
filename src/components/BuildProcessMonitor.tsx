import {
  ArrowsClockwise,
  Cpu,
  FolderOpen,
  Hammer,
  Stop,
  TreeStructure,
} from "@phosphor-icons/react";
import type { BuildProcess } from "../types";
import { formatDuration } from "../utils/formatting";

interface BuildProcessMonitorProps {
  processes: BuildProcess[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  actionErrors: Record<number, string>;
  pendingActions: Set<number>;
  lastUpdated: number | null;
  onRefresh: () => void;
  onStop: (process: BuildProcess) => void;
  onRestart: (process: BuildProcess) => void;
}

function formatProcessDuration(seconds: number): string {
  return formatDuration(seconds * 1_000);
}

function BuildProcessSkeleton() {
  return (
    <div className="build-process-card build-process-skeleton" aria-hidden="true">
      <div className="skeleton-line skeleton-heading" />
      <div className="skeleton-line skeleton-command" />
      <div className="skeleton-metrics">
        <div className="skeleton-line" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </div>
    </div>
  );
}

export function BuildProcessMonitor({
  processes,
  loading,
  refreshing,
  error,
  actionErrors,
  pendingActions,
  lastUpdated,
  onRefresh,
  onStop,
  onRestart,
}: BuildProcessMonitorProps) {
  return (
    <section className="build-process-view" aria-labelledby="build-process-title">
      <div className="build-process-heading">
        <div>
          <div className="header-row">
            <h2 id="build-process-title">Build Processes</h2>
            <span className="active-build-count" aria-live="polite">
              {processes.length} active
            </span>
          </div>
          <p className="page-description">
            Watch Cargo jobs started by terminals, editors, agents, or Rust Helper.
            External Cargo jobs do not expose a percentage, so progress is shown as
            the current phase and live resource activity.
          </p>
        </div>
        <button
          className="secondary build-refresh-button"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <ArrowsClockwise size={16} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {lastUpdated !== null ? (
        <p className="build-refresh-status">
          Live monitoring · updated {new Date(lastUpdated).toLocaleTimeString()}
        </p>
      ) : null}

      {error ? (
        <div className="build-monitor-error" role="alert">
          <span>{error}</span>
          <button className="secondary" onClick={onRefresh}>Try again</button>
        </div>
      ) : null}

      {loading ? (
        <div className="build-process-grid" aria-label="Loading build processes">
          <BuildProcessSkeleton />
          <BuildProcessSkeleton />
        </div>
      ) : processes.length === 0 ? (
        <div className="empty-state build-empty-state">
          <Hammer size={36} />
          <h3>No active Rust builds</h3>
          <p>Start a Cargo build anywhere and it will appear here automatically.</p>
          <button onClick={onRefresh}>Refresh now</button>
        </div>
      ) : (
        <div className="build-process-grid">
          {processes.map((process) => {
            const pending = pendingActions.has(process.pid);
            const actionError = actionErrors[process.pid];

            return (
              <article className="build-process-card" key={`${process.pid}-${process.start_time}`}>
                <div className="build-process-card-header">
                  <div className="build-process-title-group">
                    <div className="build-process-icon" aria-hidden="true">
                      <Hammer size={18} />
                    </div>
                    <div>
                      <h3>{process.project_name ?? process.process_name}</h3>
                      <span className="build-process-pid">PID {process.pid}</span>
                    </div>
                  </div>
                  <span className="build-phase">{process.phase}</span>
                </div>

                <code className="build-process-command" title={process.command}>
                  {process.command}
                </code>

                {process.working_directory ? (
                  <div className="build-process-path" title={process.working_directory}>
                    <FolderOpen size={15} />
                    <span>{process.working_directory}</span>
                  </div>
                ) : null}

                <dl className="build-process-metrics">
                  <div>
                    <dt>Elapsed</dt>
                    <dd>{formatProcessDuration(process.elapsed_seconds)}</dd>
                  </div>
                  <div>
                    <dt><Cpu size={13} /> CPU</dt>
                    <dd>{process.cpu_percent.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt>Memory</dt>
                    <dd>{process.memory_percent.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt><TreeStructure size={13} /> Children</dt>
                    <dd>{process.child_count}</dd>
                  </div>
                  <div>
                    <dt>State</dt>
                    <dd>{process.state}</dd>
                  </div>
                </dl>

                <div className="build-process-actions">
                  <button
                    className="secondary"
                    onClick={() => onRestart(process)}
                    disabled={pending || !process.restartable}
                    title={
                      process.restartable
                        ? "Stop this process tree and launch the same Cargo command again"
                        : "Only Cargo processes with a known working directory can be restarted"
                    }
                  >
                    <ArrowsClockwise size={16} />
                    Restart
                  </button>
                  <button
                    className="danger"
                    onClick={() => onStop(process)}
                    disabled={pending}
                  >
                    <Stop size={16} weight="fill" />
                    {pending ? "Applying…" : "Stop"}
                  </button>
                </div>

                {actionError ? (
                  <p className="build-action-error" role="alert">{actionError}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
