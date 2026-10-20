import React, { useState, useEffect } from "react";
import { lockSpec, createProject } from "../api.js";

/**
 * Step 3: EventSpec Review & Immutability Lock (KB 7.6, D-13),
 * with dedicated button-driven transition to Project Creation.
 *
 * @param {{
 *   spec: any;
 *   onSpecLocked: (lockedSpec: any) => void;
 *   onProjectCreated?: (project: any) => void;
 *   onBack: () => void;
 *   onReset: () => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function ReviewStep({ spec, onSpecLocked, onProjectCreated, onBack, onReset, onError }) {
  const [locking, setLocking] = useState(false);
  const [lockedData, setLockedData] = useState(null);
  const [copied, setCopied] = useState(false);

  // Dedicated project creation view mode
  const [showCreationView, setShowCreationView] = useState(false);

  // Project creation form state
  const [projectName, setProjectName] = useState(spec.event?.name?.value || "");
  const [eventCode, setEventCode] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [creationError, setCreationError] = useState(null);

  // Scroll to top when switching between review and dedicated project creation view
  useEffect(() => {
    if (showCreationView) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [showCreationView]);

  const handleLock = async () => {
    setLocking(true);
    onError(null);
    try {
      const result = await lockSpec(spec);
      setLockedData(result.spec);
      onSpecLocked(result.spec);
    } catch (err) {
      onError(err);
    } finally {
      setLocking(false);
    }
  };

  const handleCreateProject = async (e) => {
    if (e) e.preventDefault();
    const trimmedName = (projectName || "").trim();
    if (!trimmedName) {
      setCreationError("Project name is required.");
      return;
    }

    const trimmedCode = (eventCode || "").trim().toUpperCase();
    if (trimmedCode && !/^[A-Z0-9]{2,8}$/.test(trimmedCode)) {
      setCreationError(
        "Event code must be 2 to 8 uppercase alphanumeric characters (e.g. NSH26), or left empty to auto-derive."
      );
      return;
    }

    setCreatingProject(true);
    setCreationError(null);
    onError(null);

    try {
      const created = await createProject({
        name: trimmedName,
        eventSpec: lockedData || spec,
        eventCode: trimmedCode || undefined,
      });

      if (onProjectCreated) {
        onProjectCreated(created);
      }
    } catch (err) {
      setCreationError(err.message || "Failed to create project");
      onError(err);
    } finally {
      setCreatingProject(false);
    }
  };

  const handleCopyJson = () => {
    const jsonStr = JSON.stringify(lockedData || spec, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isLocked = Boolean(lockedData);

  // Extract display values
  const eventName = spec.event?.name?.value || "—";
  const venue = spec.event?.venue?.value || "—";
  const tagline = spec.event?.tagline?.value || "—";
  let datesDisplay = "—";
  if (spec.event?.dates?.value) {
    const d = spec.event.dates.value;
    if (typeof d === "string") datesDisplay = d;
    else if (d.start && d.end) datesDisplay = `${d.start} to ${d.end}`;
    else if (d.start) datesDisplay = d.start;
  }

  const palette = spec.event?.palette || {
    primary: "#0052cc",
    secondary: "#172b4d",
    accent: "#ffab00",
  };

  const fieldsList = Array.isArray(spec.fields?.value)
    ? spec.fields.value.join(", ")
    : "—";

  const roles = Array.isArray(spec.roles) ? spec.roles : [];

  // =========================================================================
  // View A: Dedicated Project Creation Screen (after clicking Continue)
  // =========================================================================
  if (showCreationView && isLocked) {
    return (
      <div className="card-panel project-create-dedicated-panel">
        <div className="panel-header">
          <div>
            <h2 className="section-title">Create Studio Project</h2>
            <p className="section-desc">
              Your EventSpec is validated and permanently locked. Assign a project name and optional
              event code to proceed to participant data upload and photo matching.
            </p>
          </div>
          <span className="badge badge-locked">&#128274; Specification Locked</span>
        </div>

        {/* Locked Context Summary Card */}
        <div className="locked-summary-banner">
          <div className="locked-summary-left">
            <span className="locked-summary-icon">&#10003;</span>
            <div>
              <div className="locked-summary-title">
                <strong>Locked Specification:</strong> {eventName}
              </div>
              <div className="locked-summary-meta">
                {datesDisplay !== "—" ? `${datesDisplay} • ` : ""}
                {roles.length} Attendee Roles &bull; CR80 Portrait (54 &times; 85.6 mm)
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowCreationView(false);
              window.scrollTo({ top: 0, behavior: "instant" });
            }}
          >
            &larr; View Locked Specification
          </button>
        </div>

        {/* Project Creation Form */}
        <form onSubmit={handleCreateProject} className="project-creation-form dedicated">
          <div className="form-group">
            <label htmlFor="create-project-name" className="form-label">
              Project Name <span className="text-danger">*</span>
            </label>
            <input
              id="create-project-name"
              type="text"
              className="input-field"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. NIT Surat Hackathon 2026"
              required
              maxLength={100}
              disabled={creatingProject}
            />
          </div>

          <div className="form-group">
            <label htmlFor="create-event-code" className="form-label">
              Event Code <span className="text-muted text-sm">(Optional)</span>
            </label>
            <input
              id="create-event-code"
              type="text"
              className="input-field"
              value={eventCode}
              onChange={(e) =>
                setEventCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))
              }
              placeholder="e.g. NSH26 (leave blank to auto-derive)"
              maxLength={8}
              disabled={creatingProject}
            />
            <span className="field-hint">
              Short 2 to 8 uppercase alphanumeric characters. If omitted, the server derives one
              automatically from the event name.
            </span>
          </div>

          {creationError && (
            <div className="form-error-inline" role="alert">
              <span className="error-dot">●</span> {creationError}
            </div>
          )}

          <div className="creation-actions dedicated-actions">
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={creatingProject}
            >
              {creatingProject ? (
                <>
                  <span className="spinner-inline" /> Creating Project...
                </>
              ) : (
                "Create Project & Proceed to Uploads →"
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowCreationView(false);
                window.scrollTo({ top: 0, behavior: "instant" });
              }}
              disabled={creatingProject}
            >
              &larr; Return to Locked Specification
            </button>
          </div>
        </form>
      </div>
    );
  }

  // =========================================================================
  // View B: Specification Review & Immutability Lock Screen
  // =========================================================================
  return (
    <div className="card-panel">
      <div className="panel-header">
        <div>
          <h2 className="section-title">Step 3: Review &amp; Lock Event Specification</h2>
          <p className="section-desc">
            Verify all parameters, attendee roles, and badge layout dimensions before locking.
            Once locked, the spec becomes immutable for downstream badge generation (D-13).
          </p>
        </div>
        {isLocked && (
          <span className="badge badge-locked">
            &#128274; Specification Locked
          </span>
        )}
      </div>

      {isLocked && (
        <div className="locked-box">
          <div className="locked-icon">&#10003;</div>
          <div>
            <h3 className="locked-title">Specification Successfully Locked &amp; Frozen</h3>
            <p className="locked-desc">
              This EventSpec is strictly validated against the core Zod schema. It is now immutable and ready
              for dataset import, attendee badge generation, and print sheet rendering.
            </p>
          </div>
        </div>
      )}

      {/* Summary Table */}
      <table className="review-table">
        <tbody>
          <tr>
            <th className="review-th">Event Name</th>
            <td className="review-td">
              <strong>{eventName}</strong>
            </td>
          </tr>
          <tr>
            <th className="review-th">Venue</th>
            <td className="review-td">{venue}</td>
          </tr>
          <tr>
            <th className="review-th">Dates</th>
            <td className="review-td">{datesDisplay}</td>
          </tr>
          <tr>
            <th className="review-th">Tagline</th>
            <td className="review-td">{tagline}</td>
          </tr>
          <tr>
            <th className="review-th">Color Palette</th>
            <td className="review-td">
              <div className="palette-preview-row">
                {palette.primary && (
                  <div className="palette-chip">
                    <span
                      className="swatch-circle"
                      style={{ backgroundColor: palette.primary }}
                    />
                    <span className="palette-code">Primary: {palette.primary}</span>
                  </div>
                )}
                {palette.secondary && (
                  <div className="palette-chip">
                    <span
                      className="swatch-circle"
                      style={{ backgroundColor: palette.secondary }}
                    />
                    <span className="palette-code">Secondary: {palette.secondary}</span>
                  </div>
                )}
                {palette.accent && (
                  <div className="palette-chip">
                    <span
                      className="swatch-circle"
                      style={{ backgroundColor: palette.accent }}
                    />
                    <span className="palette-code">Accent: {palette.accent}</span>
                  </div>
                )}
              </div>
            </td>
          </tr>
          <tr>
            <th className="review-th">Attendee Roles ({roles.length})</th>
            <td className="review-td">
              {roles.length === 0 ? (
                <span className="text-muted">None specified</span>
              ) : (
                <div className="role-tags-wrap">
                  {roles.map((r) => (
                    <div key={r.id} className="role-summary-tag">
                      <span
                        className="swatch-circle"
                        style={{
                          backgroundColor:
                            typeof r.color === "object" ? r.color?.value : r.color,
                        }}
                      />
                      <span className="role-tag-label">{r.label}</span>
                      <span className="role-tag-count">
                        {r.expectedCount || 0} pax
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </td>
          </tr>
          <tr>
            <th className="review-th">Badge Fields</th>
            <td className="review-td">
              <code className="code-pill">{fieldsList}</code>
            </td>
          </tr>
          <tr>
            <th className="review-th">Physical Dimensions</th>
            <td className="review-td">
              CR80 Standard (54 mm &times; 85.6 mm) &bull; Portrait &bull; Front side only &bull;
              3 mm Bleed / Safe Margin (D-39)
            </td>
          </tr>
          <tr>
            <th className="review-th">QR Code</th>
            <td className="review-td">
              <span className="badge badge-defaulted">
                {spec.qr?.enabled ? "Enabled" : "Disabled (D-39 default)"}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      {/* JSON Viewer */}
      <div className="json-viewer-container">
        <div className="json-viewer-header">
          <span className="json-viewer-title">EventSpec JSON Representation</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleCopyJson}
          >
            {copied ? "\u2713 Copied!" : "Copy JSON"}
          </button>
        </div>
        <pre className="json-code-block">
          {JSON.stringify(lockedData || spec, null, 2)}
        </pre>
      </div>

      {/* Action Buttons */}
      <div className="review-actions-bar">
        {!isLocked ? (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onBack}
              disabled={locking}
            >
              &larr; Back to Questions
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleLock}
              disabled={locking}
            >
              {locking ? (
                <>
                  <span className="spinner-inline" /> Validating &amp; Freezing...
                </>
              ) : (
                "Lock Event Specification (D-13)"
              )}
            </button>
          </>
        ) : (
          <>
            <div className="locked-action-group">
              <span className="locked-success-label">
                &#10003; Specification is permanently locked.
              </span>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => setShowCreationView(true)}
              >
                Continue to Create Project &rarr;
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onReset}
            >
              Create Another Event
            </button>
          </>
        )}
      </div>
    </div>
  );
}
