import React, { useState, useEffect } from "react";
import { exportProject } from "../api.js";
import {
  partitionPreflightIssues,
  evaluateExportGate,
} from "../preflightClassification.js";

/**
 * Formats raw byte count into human-readable string (KB, MB).
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Final ID Card Review, Preflight Validation & Print-Ready Export Step (Slice 4).
 *
 * @param {{
 *   project: any;
 *   hasDataset: boolean;
 *   onGoToDesignStep?: () => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function ExportWorkflowStep({
  project,
  hasDataset,
  onGoToDesignStep,
  onError,
}) {
  const versions = Array.isArray(project.versions) ? project.versions : [];
  const [selectedVersionNumber, setSelectedVersionNumber] = useState(
    versions.length > 0 ? versions[versions.length - 1].versionNumber : null
  );

  useEffect(() => {
    if (versions.length > 0) {
      if (!versions.some((v) => v.versionNumber === selectedVersionNumber)) {
        setSelectedVersionNumber(versions[versions.length - 1].versionNumber);
      }
    } else {
      setSelectedVersionNumber(null);
    }
  }, [versions, selectedVersionNumber]);

  const selectedVersion =
    versions.find((v) => v.versionNumber === selectedVersionNumber) ||
    (versions.length > 0 ? versions[versions.length - 1] : null);

  // Dynamic roles from EventSpec
  const roles = Array.isArray(project.eventSpec?.roles) && project.eventSpec.roles.length > 0
    ? project.eventSpec.roles
    : [{ id: "participant", label: "PARTICIPANT" }];

  const [activePreviewRoleId, setActivePreviewRoleId] = useState(roles[0]?.id || "participant");

  // Keep preview role valid
  useEffect(() => {
    if (!roles.some((r) => r.id === activePreviewRoleId)) {
      setActivePreviewRoleId(roles[0]?.id || "participant");
    }
  }, [roles, activePreviewRoleId]);

  // Export configuration state
  const [kind, setKind] = useState("sheet"); // "sheet" | "zip" | "card"
  const [format, setFormat] = useState("pdf"); // "pdf" | "svg" | "png"
  const [paper, setPaper] = useState("A4"); // "A4" | "A3"
  const [printerSafeMm, setPrinterSafeMm] = useState(5);
  const [personId, setPersonId] = useState("");
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState(false);

  // Execution state
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [lastExport, setLastExport] = useState(null); // { blob, url, filename, size, timestamp }

  // Participant IDs from dataset report (privacy safe)
  const availablePersonIds = Array.isArray(project.datasetReport?.rows)
    ? project.datasetReport.rows.map((r) => r.id).filter(Boolean)
    : [];

  // Default personId when switching to single card
  useEffect(() => {
    if (kind === "card" && !personId && availablePersonIds.length > 0) {
      setPersonId(availablePersonIds[0]);
    }
  }, [kind, personId, availablePersonIds]);

  // Reset format to supported options when scope changes
  const handleKindChange = (newKind) => {
    setKind(newKind);
    if (newKind === "sheet" || newKind === "zip") {
      if (format === "png") setFormat("pdf");
    }
  };

  // Participant IDs from dataset report (privacy safe)
  const currentPeople = Array.isArray(project.people) ? project.people : (project.datasetReport?.rows || []);
  const currentPersonIds = new Set(
    currentPeople.length > 0
      ? currentPeople.map((p) => (typeof p === "string" ? p : p?.id)).filter(Boolean)
      : availablePersonIds
  );

  // Partition stored draft issues into real attendee issues and sample stress-test issues
  const rawDraftIssues = Array.isArray(selectedVersion?.draft?.issues)
    ? selectedVersion.draft.issues
    : [];
  const { attendeeIssues, stressTestIssues } = partitionPreflightIssues(
    rawDraftIssues,
    currentPersonIds
  );

  const gate = evaluateExportGate({
    attendeeIssues,
    acknowledgedWarnings,
  });

  const preflightErrors = attendeeIssues.filter((i) => i && i.severity === "error");
  const preflightWarnings = attendeeIssues.filter((i) => i && i.severity === "warning");
  const hasErrors = gate.hasErrors;
  const hasWarnings = gate.hasWarnings;

  // Photo count comparison for non-blocking notice (Condition 2 & 6)
  const currentPhotoCount = project?.photoCount;
  const savedPhotoCount = selectedVersion?.photoCount;
  const hasPhotoUpdateNotice =
    typeof currentPhotoCount === "number" &&
    typeof savedPhotoCount === "number" &&
    !isNaN(currentPhotoCount) &&
    !isNaN(savedPhotoCount) &&
    currentPhotoCount > savedPhotoCount;

  // Trigger file download using a Blob
  const triggerDownload = (blobUrl, filename) => {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Handle Export initiation
  const handleExecuteExport = async () => {
    if (!selectedVersion) return;
    if (hasErrors) return;

    setIsExporting(true);
    setExportError(null);

    const payload = {
      version: selectedVersion.versionNumber,
      kind,
      format,
      ...(kind === "card" ? { personId } : {}),
      ...(kind === "sheet"
        ? {
            paper,
            printerSafeMm: Number(printerSafeMm) || 5,
          }
        : {}),
      orientation: "portrait", // Portrait only
      sides: "front", // Front only
      acknowledgedWarnings: Boolean(acknowledgedWarnings || !hasWarnings),
    };

    try {
      const result = await exportProject(project.id, payload);

      // Create browser blob URL for immediate download and re-download
      const blobUrl = URL.createObjectURL(result.blob);
      triggerDownload(blobUrl, result.filename);

      setLastExport({
        blob: result.blob,
        url: blobUrl,
        filename: result.filename,
        size: result.size,
        mimeType: result.mimeType,
        timestamp: new Date().toLocaleTimeString(),
        kind,
        format,
      });
    } catch (err) {
      setExportError(err);
      onError(err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="card-panel export-workflow-panel">
      {/* Step Header */}
      <div className="upload-step-header">
        <div>
          <h3 className="upload-step-title">
            Step 4: Final ID Card Review &amp; Print-Ready Export
          </h3>
          <p className="upload-step-desc">
            Review your selected design version, inspect automated D-09 preflight checks, configure print sheet options, and generate print-ready PDF, SVG, or ZIP deliverables.
          </p>
        </div>
        <span
          className={`badge ${
            !hasDataset || !selectedVersion
              ? "badge-subtle"
              : hasErrors
              ? "badge-danger"
              : hasWarnings && !acknowledgedWarnings
              ? "badge-warning"
              : "badge-locked"
          }`}
        >
          {!hasDataset
            ? "🔒 Upload Data First"
            : !selectedVersion
            ? "🔒 Select Design First"
            : hasErrors
            ? `⚠ ${preflightErrors.length} Errors`
            : hasWarnings && !acknowledgedWarnings
            ? `⚠ ${preflightWarnings.length} Warnings`
            : `✓ Ready to Export (v${selectedVersion.versionNumber})`}
        </span>
      </div>

      {/* Gated: Missing Dataset */}
      {!hasDataset && (
        <div className="step-gated-box" style={{ marginTop: "1.25rem" }}>
          <div className="gated-lock-icon">🔒</div>
          <div>
            <h4 className="gated-title">Export Workflow Gated</h4>
            <p className="gated-desc">
              Please complete Step 1 (Participant Data) and Step 3 (Design Selection) before accessing print export.
            </p>
          </div>
        </div>
      )}

      {/* Gated: Missing Version Selection */}
      {hasDataset && !selectedVersion && (
        <div className="empty-version-box" style={{ marginTop: "1.25rem" }}>
          <div className="empty-version-icon">✦</div>
          <h4 className="empty-version-title">No Card Design Selected Yet</h4>
          <p className="empty-version-desc">
            To generate print-ready exports, you must select one of the composed ID card designs in Step 3. Selecting a design creates an immutable snapshot version that guarantees your layout and data remain consistent throughout printing.
          </p>
          {onGoToDesignStep && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onGoToDesignStep}
            >
              &uarr; Go to Step 3: Select a Design
            </button>
          )}
        </div>
      )}

      {/* Active Export Workspace (When version is selected) */}
      {hasDataset && selectedVersion && (
        <div className="export-active-workspace">
          {/* Section A: Selected Version Review Card */}
          <div className="export-review-summary-card">
            <div className="review-card-top-row">
              <div className="review-card-title-group">
                <span className="badge badge-locked">
                  Version {selectedVersion.versionNumber} Selected
                </span>
                <h4 className="review-version-heading">
                  {project.eventSpec?.event?.name?.value || project.name}
                </h4>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {versions.length > 1 && (
                  <select
                    id="version-selector"
                    className="form-control"
                    style={{ width: "auto", padding: "0.25rem 0.5rem", fontSize: "0.85rem", height: "auto" }}
                    value={selectedVersion?.versionNumber || ""}
                    onChange={(e) => setSelectedVersionNumber(Number(e.target.value))}
                    aria-label="Select Version"
                  >
                    {versions.map((v) => (
                      <option key={v.versionNumber} value={v.versionNumber}>
                        Version {v.versionNumber}
                      </option>
                    ))}
                  </select>
                )}
                {onGoToDesignStep && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onGoToDesignStep}
                  >
                    &larr; Change Selected Design
                  </button>
                )}
              </div>
            </div>

            <div className="review-meta-grid">
              <div className="review-meta-item">
                <span className="review-meta-label">Card Size:</span>
                <span className="review-meta-val">
                  {project.eventSpec?.card?.widthMm || 54} &times; {project.eventSpec?.card?.heightMm || 85.6} mm (CR80)
                </span>
              </div>
              <div className="review-meta-item">
                <span className="review-meta-label">Print Bleed:</span>
                <span className="review-meta-val">
                  {project.eventSpec?.card?.bleedMm || 3} mm bleed &bull; {project.eventSpec?.card?.safeMarginMm || 3} mm safe margin
                </span>
              </div>
              <div className="review-meta-item">
                <span className="review-meta-label">Orientation &amp; Sides:</span>
                <span className="review-meta-val">
                  Portrait &bull; Front only
                </span>
              </div>
              <div className="review-meta-item">
                <span className="review-meta-label">Attendees in Snapshot:</span>
                <span className="review-meta-val">
                  <strong>{selectedVersion.peopleCount || project.peopleCount || 0}</strong> attendee badges
                </span>
              </div>
              <div className="review-meta-item">
                <span className="review-meta-label">Design Archetype:</span>
                <span className="review-meta-val">
                  <code>{selectedVersion.draft?.look?.attributes?.archetype || "classic"}</code> &bull; <code>{selectedVersion.draft?.look?.attributes?.mode || "standard"}</code>
                </span>
              </div>
              <div className="review-meta-item">
                <span className="review-meta-label">Configured Roles:</span>
                <span className="review-meta-val">
                  {roles.map((r) => r.label).join(", ")}
                </span>
              </div>
            </div>

            {/* Live Role Preview of Selected Version */}
            <div className="review-preview-row">
              <div className="review-preview-info">
                <span className="control-label">Verify Role Appearance:</span>
                <div className="role-tabs-wrap" style={{ marginTop: "6px" }}>
                  {roles.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`role-tab ${activePreviewRoleId === r.id ? "active" : ""}`}
                      onClick={() => setActivePreviewRoleId(r.id)}
                    >
                      <span
                        className="role-color-dot"
                        style={{ backgroundColor: r.color?.value || "#2563EB" }}
                      />
                      <span className="role-tab-name">{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="review-mini-card-viewport">
                <div
                  className="card-svg-container mini"
                  dangerouslySetInnerHTML={{
                    __html:
                      selectedVersion.draft?.roleSvgs?.[activePreviewRoleId] ||
                      selectedVersion.draft?.svg ||
                      "",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Section B: Preflight Validation Dashboard (Rule D-09) */}
          <div className="preflight-dashboard-card">
            <div className="preflight-header">
              <div>
                <h4 className="preflight-title">Preflight Validation Dashboard (Rule D-09)</h4>
                <p className="preflight-subtitle">
                  Automated checks verify geometry bounds, text fitting, safe margins, and role contracts before print rendering.
                </p>
              </div>
              <span
                className={`badge ${
                  hasErrors
                    ? "badge-danger"
                    : hasWarnings
                    ? "badge-warning"
                    : "badge-locked"
                }`}
              >
                {hasErrors
                  ? "⚠ Errors Found"
                  : hasWarnings
                  ? "⚠ Warnings Found"
                  : "✓ Ready for Export"}
              </span>
            </div>

            {/* Non-blocking Notice: Photos uploaded after version saved (Condition 6) */}
            {hasPhotoUpdateNotice && (
              <div className="photo-version-notice-alert" role="status" style={{ marginTop: "1rem" }}>
                <span className="notice-icon">ℹ</span>
                <div style={{ flex: 1 }}>
                  <strong>Newer Photos Available:</strong> Photos were uploaded after Version {selectedVersion.versionNumber} was saved. Save a new version to include them.
                </div>
                {onGoToDesignStep && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onGoToDesignStep}
                  >
                    Go to Design &amp; Preview
                  </button>
                )}
              </div>
            )}

            {/* Part (a): Checks on your attendees */}
            <div className="preflight-subpanel attendee-checks-subpanel" style={{ marginTop: "1rem" }}>
              <h5 className="preflight-subpanel-title" style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                Checks on your attendees
              </h5>
              {hasErrors ? (
                <div className="report-error-alert" role="alert" style={{ marginTop: "0.5rem" }}>
                  <span className="error-icon-inline">!</span>
                  <div>
                    <strong>Export Blocked (Rule D-09):</strong> {preflightErrors.length} validation error(s) must be resolved before print-ready export can proceed.
                    <ul className="preflight-issues-list">
                      {preflightErrors.map((err, idx) => (
                        <li key={idx}>
                          <code>{err.code}</code>: {err.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : hasWarnings ? (
                <div className="preflight-warning-alert" style={{ marginTop: "0.5rem" }}>
                  <span className="warning-icon-inline">⚠</span>
                  <div style={{ flex: 1 }}>
                    <strong>Attendee Warnings ({preflightWarnings.length}):</strong>
                    <ul className="preflight-issues-list">
                      {preflightWarnings.map((w, idx) => (
                        <li key={idx}>
                          <code>{w.code}</code>: {w.message}
                        </li>
                      ))}
                    </ul>
                    <label className="warning-ack-label">
                      <input
                        type="checkbox"
                        checked={acknowledgedWarnings}
                        onChange={(e) => setAcknowledgedWarnings(e.target.checked)}
                      />
                      <span>
                        I acknowledge the {preflightWarnings.length} warning(s) above and approve generating the print export.
                      </span>
                    </label>
                  </div>
                </div>
              ) : (
                <div className="attendee-checks-live-note" style={{ marginTop: "0.5rem", color: "var(--text-muted, #64748B)", fontSize: "0.9rem" }}>
                  <span className="info-icon-inline" style={{ marginRight: "6px" }}>ℹ</span>
                  <span>Attendee checks run on the server when you export.</span>
                </div>
              )}
            </div>

            {/* Part (b): Design stress test (sample people, not your attendees) */}
            {stressTestIssues.length > 0 && (
              <details className="stress-test-details" style={{ marginTop: "1.25rem" }}>
                <summary className="stress-test-summary" style={{ cursor: "pointer", fontWeight: 500, color: "var(--text-secondary, #475569)" }}>
                  Design stress test (sample people, not your attendees) &mdash; {stressTestIssues.length} sample {stressTestIssues.length === 1 ? "notice" : "notices"}
                </summary>
                <div className="stress-test-content" style={{ marginTop: "0.5rem", padding: "0.75rem", background: "var(--bg-subtle, #F8FAFC)", borderRadius: "6px", border: "1px solid var(--border-color, #E2E8F0)" }}>
                  <p className="text-sm text-muted" style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem" }}>
                    These automated notices were produced during layout synthesis using synthetic personas (e.g. edge-case name lengths or missing photos). They do not affect your attendees and do not block export.
                  </p>
                  <ul className="preflight-issues-list">
                    {stressTestIssues.map((iss, idx) => (
                      <li key={idx}>
                        <span className="badge badge-subtle">{iss.severity || "warning"}</span>{" "}
                        <code>{iss.code}</code>{iss.nodeId ? ` (${iss.nodeId})` : ""}: {iss.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </div>

          {/* Section C: Export Configuration Form */}
          <div className="export-config-card">
            <h4 className="config-card-title">Export Configuration</h4>

            <div className="config-grid">
              {/* Scope Selector */}
              <div className="config-field-group">
                <label className="config-label">Export Scope:</label>
                <div className="radio-pill-group">
                  <label className={`radio-pill ${kind === "sheet" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="exportKind"
                      value="sheet"
                      checked={kind === "sheet"}
                      onChange={() => handleKindChange("sheet")}
                    />
                    <span>Print Sheets (All Cards)</span>
                  </label>

                  <label className={`radio-pill ${kind === "zip" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="exportKind"
                      value="zip"
                      checked={kind === "zip"}
                      onChange={() => handleKindChange("zip")}
                    />
                    <span>Batch ZIP (Individual Cards)</span>
                  </label>

                  <label className={`radio-pill ${kind === "card" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="exportKind"
                      value="card"
                      checked={kind === "card"}
                      onChange={() => handleKindChange("card")}
                    />
                    <span>Single Attendee Card</span>
                  </label>
                </div>
              </div>

              {/* Format Selector */}
              <div className="config-field-group">
                <label className="config-label">Output File Format:</label>
                <div className="radio-pill-group">
                  <label className={`radio-pill ${format === "pdf" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="exportFormat"
                      value="pdf"
                      checked={format === "pdf"}
                      onChange={() => setFormat("pdf")}
                    />
                    <span>PDF (Print-Ready Vector)</span>
                  </label>

                  <label className={`radio-pill ${format === "svg" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="exportFormat"
                      value="svg"
                      checked={format === "svg"}
                      onChange={() => setFormat("svg")}
                    />
                    <span>SVG (Scalable Vector)</span>
                  </label>

                  {kind === "card" && (
                    <label className={`radio-pill ${format === "png" ? "active" : ""}`}>
                      <input
                        type="radio"
                        name="exportFormat"
                        value="png"
                        checked={format === "png"}
                        onChange={() => setFormat("png")}
                      />
                      <span>PNG (Raster Image)</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Sheet Specific Options */}
              {kind === "sheet" && (
                <>
                  <div className="config-field-group">
                    <label className="config-label" htmlFor="sheet-paper">
                      Paper Size:
                    </label>
                    <select
                      id="sheet-paper"
                      className="form-input"
                      value={paper}
                      onChange={(e) => setPaper(/** @type {"A4" | "A3"} */ (e.target.value))}
                    >
                      <option value="A4">A4 (9 Cards Per Page, 3 &times; 3)</option>
                      <option value="A3">A3 (Full Format Sheet)</option>
                    </select>
                  </div>

                  <div className="config-field-group">
                    <label className="config-label" htmlFor="sheet-margin">
                      Printer Safe Edge Margin (mm):
                    </label>
                    <input
                      id="sheet-margin"
                      type="number"
                      className="form-input"
                      min="0"
                      max="20"
                      value={printerSafeMm}
                      onChange={(e) => setPrinterSafeMm(Number(e.target.value))}
                    />
                  </div>
                </>
              )}

              {/* Single Card Specific: Participant ID Dropdown */}
              {kind === "card" && (
                <div className="config-field-group">
                  <label className="config-label" htmlFor="card-person-id">
                    Select Attendee ID:
                  </label>
                  <select
                    id="card-person-id"
                    className="form-input"
                    value={personId}
                    onChange={(e) => setPersonId(e.target.value)}
                  >
                    {availablePersonIds.length > 0 ? (
                      availablePersonIds.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))
                    ) : (
                      <option value="">No attendee IDs available</option>
                    )}
                  </select>
                </div>
              )}
            </div>

            {/* Error Alert from Server */}
            {exportError && (
              <div className="report-error-alert" role="alert" style={{ marginTop: "1.25rem" }}>
                <span className="error-icon-inline">!</span>
                <div style={{ flex: 1 }}>
                  <strong>Export Failed ({exportError.code || "PREFLIGHT_FAILED"}):</strong> {exportError.message}
                  {Array.isArray(exportError.issues) && exportError.issues.length > 0 && (
                    <ul className="preflight-issues-list" style={{ marginTop: "0.5rem" }}>
                      {exportError.issues.map((i, idx) => (
                        <li key={idx}>
                          <span className={`badge ${i.severity === "error" ? "badge-danger" : "badge-warning"}`}>
                            {i.severity || "error"}
                          </span>{" "}
                          <code>{i.code}</code>{i.nodeId ? ` (${i.nodeId})` : ""}: {i.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Condition 2: If EVERY server issue is a warning (0 errors), allow acknowledging and resending */}
                  {Array.isArray(exportError.issues) &&
                    exportError.issues.length > 0 &&
                    exportError.issues.every((i) => i.severity === "warning") && (
                      <label className="warning-ack-label" style={{ marginTop: "0.75rem", display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={acknowledgedWarnings}
                          onChange={(e) => setAcknowledgedWarnings(e.target.checked)}
                        />
                        <span>
                          I acknowledge these server warnings and approve generating the print export.
                        </span>
                      </label>
                    )}
                </div>
              </div>
            )}

            {/* Action Trigger Row */}
            <div className="export-action-row">
              <div className="export-hint-text">
                {hasErrors ? (
                  <span className="text-danger">Resolve preflight errors to unlock export.</span>
                ) : hasWarnings && !acknowledgedWarnings ? (
                  <span className="text-warning">Please check the warning acknowledgement box above to proceed.</span>
                ) : (
                  <span>Ready to generate {format.toUpperCase()} {kind} export.</span>
                )}
              </div>

              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={handleExecuteExport}
                disabled={
                  isExporting ||
                  !gate.canExport ||
                  (Boolean(exportError) &&
                    Array.isArray(exportError.issues) &&
                    exportError.issues.length > 0 &&
                    (exportError.issues.some((i) => i.severity === "error") ||
                      (exportError.issues.some((i) => i.severity === "warning") && !acknowledgedWarnings)))
                }
              >
                {isExporting ? (
                  <>
                    <span className="spinner-inline" /> Rendering &amp; Generating Export...
                  </>
                ) : (
                  `✦ Export Print-Ready ${format.toUpperCase()}`
                )}
              </button>
            </div>
          </div>

          {/* Section D: Export Results & Working Download */}
          {lastExport && (
            <div className="export-result-card" role="region" aria-label="Export Results">
              <div className="result-card-left">
                <span className="result-success-icon">✓</span>
                <div>
                  <h4 className="result-card-heading">Export Delivered Successfully</h4>
                  <p className="result-card-meta">
                    File: <strong><code>{lastExport.filename}</code></strong> &bull; Size: <strong>{formatBytes(lastExport.size)}</strong> &bull; Generated at {lastExport.timestamp}
                  </p>
                  <p className="result-card-sub">
                    Output contains <strong>{selectedVersion.peopleCount || project.peopleCount || 0}</strong> attendee badges exported from immutable <strong>Version {selectedVersion.versionNumber}</strong>.
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-download-again"
                onClick={() => triggerDownload(lastExport.url, lastExport.filename)}
                title="Download this generated file again without requesting a new server export"
              >
                📥 Download File Again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
