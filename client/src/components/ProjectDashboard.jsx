import React, { useState, useEffect } from "react";
import { listProjects } from "../api.js";

/**
 * Project Dashboard listing saved projects (Slice 2).
 *
 * @param {{
 *   onOpenProject: (projectId: string) => void;
 *   onStartIntake: () => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function ProjectDashboard({ onOpenProject, onStartIntake, onError }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchList = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFetchError(null);

    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      setFetchError(err.message || "Failed to load projects");
      onError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  const formatDate = (isoString) => {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return `${d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })} at ${d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    } catch {
      return isoString;
    }
  };

  return (
    <div className="card-panel dashboard-panel">
      {/* Header bar */}
      <div className="panel-header dashboard-header">
        <div>
          <h2 className="section-title">Projects Dashboard</h2>
          <p className="section-desc">
            Manage your ID card design studio projects, participant data, and attendee photo matching.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fetchList(true)}
            disabled={loading || refreshing}
            aria-label="Refresh project list"
          >
            {refreshing ? (
              <>
                <span className="spinner-inline" /> Refreshing...
              </>
            ) : (
              "↻ Refresh"
            )}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStartIntake}
          >
            + New Event Specification
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="dashboard-loading-state" role="status" aria-live="polite">
          <span className="spinner-inline large" />
          <p className="loading-text">Loading saved projects...</p>
        </div>
      )}

      {/* Error state */}
      {!loading && fetchError && (
        <div className="dashboard-error-box" role="alert">
          <div className="error-icon">!</div>
          <div className="error-details">
            <h3 className="error-title">Unable to Load Projects</h3>
            <p className="error-desc">{fetchError}</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => fetchList()}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !fetchError && projects.length === 0 && (
        <div className="dashboard-empty-state">
          <div className="empty-icon-circle">🗂️</div>
          <h3 className="empty-title">No Projects Found</h3>
          <p className="empty-desc">
            You don't have any saved projects yet. Start by defining an event specification using the
            AI Intake extractor or manual form, then lock the specification to create your first project.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStartIntake}
          >
            Create Your First Event Spec
          </button>
        </div>
      )}

      {/* Projects Grid */}
      {!loading && !fetchError && projects.length > 0 && (
        <div className="projects-grid">
          {projects.map((proj) => (
            <div key={proj.id} className="project-card">
              <div className="project-card-header">
                <span className="badge badge-event-code" title="Event Code">
                  {proj.eventCode || "EVENT"}
                </span>
                <span className="project-id-tag" title="Project ID">
                  <code>{proj.id}</code>
                </span>
              </div>

              <h3 className="project-name" title={proj.name}>
                {proj.name}
              </h3>

              <div className="project-card-meta">
                <div className="meta-row">
                  <span className="meta-label">Created:</span>
                  <span className="meta-value">{formatDate(proj.createdAt)}</span>
                </div>
                {proj.updatedAt && proj.updatedAt !== proj.createdAt && (
                  <div className="meta-row">
                    <span className="meta-label">Updated:</span>
                    <span className="meta-value">{formatDate(proj.updatedAt)}</span>
                  </div>
                )}
              </div>

              <div className="project-card-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={() => onOpenProject(proj.id)}
                >
                  Open Upload Workflow &rarr;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
