import React, { useState, useEffect, useRef } from "react";
import { DataUploadStep } from "./DataUploadStep.jsx";
import { A2ReportView } from "./A2ReportView.jsx";
import { PhotoUploadStep } from "./PhotoUploadStep.jsx";
import { DesignPreviewStep } from "./DesignPreviewStep.jsx";
import { ExportWorkflowStep } from "./ExportWorkflowStep.jsx";

/**
 * Calculates count of valid attendees from an A2 report.
 * Rows with non-fatal warnings (e.g. MISSING_OPTIONAL_FIELD, NO_PHOTO) are valid attendees.
 * Only fatal error rows are excluded.
 *
 * @param {any} report
 * @returns {number}
 */
export function getValidAttendeeCount(report) {
  if (!report?.totals) return 0;
  const rows = report.totals.rows || 0;
  const errors = report.totals.errors || 0;
  return Math.max(0, rows - errors);
}

/**
 * Computes whether the project has a valid participant dataset unlocked for photo upload.
 *
 * @param {any} project
 * @param {any} report
 * @param {any} reportError
 * @returns {boolean}
 */
export function computeHasDataset(project, report, reportError) {
  if (reportError) return false;
  const reportValid = report ? getValidAttendeeCount(report) : 0;
  const effective = (project?.peopleCount && project.peopleCount > 0)
    ? project.peopleCount
    : reportValid;
  return effective > 0;
}

/**
 * Project Data & Photo Upload Workflow (Slice 2).
 *
 * @param {{
 *   project: any;
 *   onBackToDashboard: () => void;
 *   onProjectUpdated: (updatedProject: any) => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function ProjectWorkflow({
  project,
  onBackToDashboard,
  onProjectUpdated,
  onError,
}) {
  const [report, setReport] = useState(project.datasetReport || null);
  const [reportError, setReportError] = useState(null);
  const [showSpecDetails, setShowSpecDetails] = useState(false);

  const reportRef = useRef(null);
  const photoRef = useRef(null);
  const designRef = useRef(null);
  const exportRef = useRef(null);

  // Scroll reset to top upon mounting or project change (React effect, not during render)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [project.id]);

  // Synchronize report state if project prop changes or project.datasetReport is provided
  useEffect(() => {
    setReport(project.datasetReport || null);
    setReportError(null);
  }, [project.id, project.datasetReport]);

  const handleDataUploaded = (newReport, { isError = false, errorMessage = null } = {}) => {
    setReport(newReport);
    setReportError(isError ? errorMessage : null);

    const validCount = getValidAttendeeCount(newReport);

    if (!isError && validCount > 0) {
      const updated = {
        ...project,
        datasetReport: newReport,
        peopleCount: validCount,
      };
      onProjectUpdated(updated);
    }

    // Auto-scroll to A2 report smoothly so user immediately sees results or validation errors
    setTimeout(() => {
      reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  const handlePhotosUploaded = (results) => {
    const updated = {
      ...project,
      photoMatchesCount: results.matches?.length || 0,
    };
    onProjectUpdated(updated);
  };

  const reportValidCount = report && !reportError ? getValidAttendeeCount(report) : 0;
  const effectivePeopleCount = (project.peopleCount && project.peopleCount > 0)
    ? project.peopleCount
    : reportValidCount;

  const hasDataset = computeHasDataset(project, report, reportError);

  return (
    <div className="card-panel project-workflow-panel">
      {/* Top Project Nav & Metadata Bar */}
      <div className="workflow-top-bar">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onBackToDashboard}
        >
          &larr; Back to Dashboard
        </button>

        <div className="workflow-project-meta">
          <span className="badge badge-event-code">
            {project.eventCode || "EVENT"}
          </span>
          <span className="project-id-tag">
            ID: <code>{project.id}</code>
          </span>
          <span className="badge badge-subtle">
            {hasDataset ? `${effectivePeopleCount} Participants` : "0 Participants"}
          </span>
        </div>
      </div>

      <div className="workflow-heading-wrap">
        <div>
          <h2 className="section-title">{project.name}</h2>
          <p className="section-desc">
            Project Upload Workflow &bull; Ingest participant tabular data, review server validation reports, and match attendee photos.
          </p>
        </div>

        <div className="workflow-header-actions">
          {report && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              &darr; View Report
            </button>
          )}
          {hasDataset && (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => photoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                &darr; Jump to Photos
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => designRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                &darr; Jump to Designs
              </button>
              {project.versions?.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => exportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  &darr; Jump to Export
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowSpecDetails(!showSpecDetails)}
          >
            {showSpecDetails ? "Hide EventSpec ▴" : "View EventSpec Details ▾"}
          </button>
        </div>
      </div>

      {/* Workflow Phase Status Stepper */}
      <div className="workflow-phases-bar">
        <div className={`phase-pill ${hasDataset ? "completed" : reportError ? "error" : "active"}`}>
          <span className="phase-num">Step 1</span>
          <span className="phase-label">Participant Data</span>
          <span className="phase-status">
            {hasDataset
              ? `✓ ${effectivePeopleCount} Attendee Records`
              : reportError
              ? "⚠ Validation Errors"
              : "Pending Upload"}
          </span>
        </div>

        <div className="phase-divider" />

        <div className={`phase-pill ${hasDataset ? (project.photoMatchesCount > 0 ? "completed" : "active") : "gated"}`}>
          <span className="phase-num">Step 2</span>
          <span className="phase-label">Attendee Photos</span>
          <span className="phase-status">
            {hasDataset
              ? project.photoMatchesCount > 0
                ? `✓ ${project.photoMatchesCount} Matched`
                : "Ready (Optional)"
              : "🔒 Upload Data First"}
          </span>
        </div>

        <div className="phase-divider" />

        <div
          className={`phase-pill ${
            hasDataset
              ? project.versions?.length > 0
                ? "completed"
                : project.currentDrafts?.length > 0
                ? "active"
                : "active"
              : "gated"
          }`}
        >
          <span className="phase-num">Step 3</span>
          <span className="phase-label">Design &amp; Preview</span>
          <span className="phase-status">
            {hasDataset
              ? project.versions?.length > 0
                ? `✓ Version ${project.versions[project.versions.length - 1].versionNumber} Selected`
                : project.currentDrafts?.length > 0
                ? `${project.currentDrafts.length} Designs Ready`
                : "Ready to Generate"
              : "🔒 Upload Data First"}
          </span>
        </div>

        <div className="phase-divider" />

        <div
          className={`phase-pill ${
            hasDataset && project.versions?.length > 0
              ? "active"
              : "gated"
          }`}
        >
          <span className="phase-num">Step 4</span>
          <span className="phase-label">Review &amp; Export</span>
          <span className="phase-status">
            {hasDataset && project.versions?.length > 0
              ? "Ready to Export"
              : "🔒 Select Design First"}
          </span>
        </div>
      </div>

      {/* Optional EventSpec Summary Drawer */}
      {showSpecDetails && project.eventSpec && (
        <div className="eventspec-summary-drawer">
          <h4 className="drawer-title">Locked Event Specification</h4>
          <div className="spec-summary-grid">
            <div>
              <strong>Event:</strong> {project.eventSpec.event?.name?.value || "—"}
            </div>
            <div>
              <strong>Venue:</strong> {project.eventSpec.event?.venue?.value || "—"}
            </div>
            <div>
              <strong>Dates:</strong>{" "}
              {Array.isArray(project.eventSpec.event?.dates?.value)
                ? project.eventSpec.event.dates.value.join(", ")
                : "—"}
            </div>
            <div>
              <strong>Attendee Roles:</strong>{" "}
              {Array.isArray(project.eventSpec.roles)
                ? project.eventSpec.roles.map((r) => r.label).join(", ")
                : "—"}
            </div>
          </div>
        </div>
      )}

      {/* 1. Data Upload Step */}
      <DataUploadStep
        project={project}
        onDataUploaded={handleDataUploaded}
        onError={onError}
      />

      {/* 2. A2 Data Report Screen (when report available or returned with errors) */}
      {report && (
        <div
          ref={reportRef}
          className={`report-wrapper-card ${reportError ? "report-has-errors" : ""}`}
        >
          <div className="report-header-banner">
            <div>
              <h3 className="upload-step-title">
                {reportError ? "A2 Data Ingestion & Diagnostic Report" : "A2 Data Quality & Ingestion Report"}
              </h3>
              <p className="upload-step-desc">
                {reportError
                  ? "Server validation detected fatal errors with the uploaded data. Inspect the problem rows and issues below."
                  : "Server validation report detailing detected columns, proposed field mappings, row statuses, and safety limits."}
              </p>
            </div>
            <span className={`badge ${reportError ? "badge-danger" : "badge-locked"}`}>
              {reportError ? "⚠ Validation Issues Found" : "✓ Ingestion Report Generated"}
            </span>
          </div>

          {reportError && (
            <div className="report-error-alert" role="alert">
              <span className="error-icon-inline">!</span>
              <div>
                <strong>Upload Failed (HTTP 422):</strong> {reportError}
                <div className="text-sm" style={{ marginTop: "2px" }}>
                  Zero valid participant records were imported. Please check the row diagnostics below to correct and re-upload.
                </div>
              </div>
            </div>
          )}

          <A2ReportView report={report} />

          {/* Action to proceed smoothly to Step 2 if data is valid */}
          {hasDataset && (
            <div className="report-bottom-nav">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => photoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                Continue to Step 2: Photo Upload &darr;
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. Photo Upload Step */}
      <div ref={photoRef} className="photo-step-wrapper">
        <PhotoUploadStep
          project={project}
          hasDataset={hasDataset}
          onPhotosUploaded={handlePhotosUploaded}
          onError={onError}
        />

        {hasDataset && (
          <div className="step-bottom-nav" style={{ marginTop: "1.25rem", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => designRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Continue to Step 3: Card Designs &darr;
            </button>
          </div>
        )}
      </div>

      {/* 4. ID Card Design Generation & Preview Step */}
      <div ref={designRef} className="design-step-wrapper">
        <DesignPreviewStep
          project={project}
          hasDataset={hasDataset}
          onProjectUpdated={onProjectUpdated}
          onError={onError}
        />

        {project.versions?.length > 0 && (
          <div className="step-bottom-nav" style={{ marginTop: "1.25rem", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => exportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Continue to Step 4: Final Review &amp; Export &darr;
            </button>
          </div>
        )}
      </div>

      {/* 5. Final ID Card Review, Preflight Validation & Export Step */}
      <div ref={exportRef} className="export-step-wrapper">
        <ExportWorkflowStep
          project={project}
          hasDataset={hasDataset}
          onGoToDesignStep={() => designRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          onError={onError}
        />
      </div>
    </div>
  );
}
