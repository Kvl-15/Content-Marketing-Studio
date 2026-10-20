import React, { useState } from "react";

function formatIssueMessage(iss) {
  if (iss.message) return iss.message;
  if (iss.code === "MISSING_OPTIONAL_FIELD") {
    return `Missing optional field: ${iss.field}`;
  }
  if (iss.code === "MISSING_NAME") {
    return "Attendee name is missing";
  }
  return "";
}

/**
 * A2 Data Report Screen (Slice 2).
 * Renders the real server report from the A2 data pipeline.
 *
 * @param {{
 *   report: any;
 * }} props
 */
export function A2ReportView({ report }) {
  const [rowFilter, setRowFilter] = useState("all"); // "all" | "errors" | "warnings"

  if (!report) {
    return null;
  }

  const totals = report.totals || { rows: 0, ok: 0, warnings: 0, errors: 0 };
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const mapping = report.mapping || {};
  const columns = Array.isArray(mapping.columns) ? mapping.columns : [];

  // Filter problematic rows (those with issues or non-OK status)
  const problemRows = rows.filter(
    (r) => r.status === "ERROR" || r.status === "WARNING" || (r.issues && r.issues.length > 0)
  );

  const filteredProblemRows = problemRows.filter((r) => {
    if (rowFilter === "errors") return r.status === "ERROR";
    if (rowFilter === "warnings") return r.status === "WARNING";
    return true;
  });

  return (
    <div className="report-container">
      {/* KPI Tiles */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Total Rows</span>
          <span className="kpi-value">{totals.rows}</span>
          <span className="kpi-sub">Uploaded records</span>
        </div>

        <div className="kpi-card kpi-success">
          <span className="kpi-label">Valid Attendees</span>
          <span className="kpi-value">{Math.max(0, (totals.rows || 0) - (totals.errors || 0))}</span>
          <span className="kpi-sub">Ready for badges</span>
        </div>

        <div className={`kpi-card ${totals.warnings > 0 ? "kpi-warning" : ""}`}>
          <span className="kpi-label">Warnings</span>
          <span className="kpi-value">{totals.warnings}</span>
          <span className="kpi-sub">Non-fatal notices</span>
        </div>

        <div className={`kpi-card ${totals.errors > 0 ? "kpi-danger" : ""}`}>
          <span className="kpi-label">Error Rows</span>
          <span className="kpi-value">{totals.errors}</span>
          <span className="kpi-sub">{totals.errors > 0 ? "Excluded from import" : "0 fatal errors"}</span>
        </div>
      </div>

      {report.formulaLikeCells > 0 && (
        <div className="report-notice-banner warning">
          <span className="notice-icon">⚠</span>
          <div>
            <strong>Formula-like Cells Detected ({report.formulaLikeCells})</strong>:
            Leading <code>=</code>, <code>+</code>, or <code>-</code> signs were safely neutralized to protect
            against spreadsheet injection.
          </div>
        </div>
      )}

      {/* Dataset Metadata */}
      <div className="report-section">
        <div className="section-subtitle-bar">
          <h3 className="section-subheading">File &amp; Ingestion Metadata</h3>
          <span className="badge badge-subtle">
            Format: {report.format?.toUpperCase() || "CSV"}
            {report.delimiter ? ` (delimiter: "${report.delimiter}")` : ""}
          </span>
        </div>

        <div className="metadata-pills">
          <div className="meta-pill">
            <span className="meta-pill-label">Header Row:</span>
            <span className="meta-pill-val">Line {report.headerRow || 1}</span>
          </div>
          <div className="meta-pill">
            <span className="meta-pill-label">Detected Headers:</span>
            <span className="meta-pill-val">
              {report.headers ? report.headers.length : 0} columns
            </span>
          </div>
          {report.firstSheet && (
            <div className="meta-pill">
              <span className="meta-pill-label">Sheet Name:</span>
              <span className="meta-pill-val">{report.firstSheet}</span>
            </div>
          )}
        </div>
      </div>

      {/* Column Mapping Table */}
      <div className="report-section">
        <div className="section-subtitle-bar">
          <h3 className="section-subheading">Proposed Field Mapping</h3>
          {mapping.missingRequiredFields && mapping.missingRequiredFields.length > 0 ? (
            <span className="badge badge-danger">
              Missing Required: {mapping.missingRequiredFields.join(", ")}
            </span>
          ) : (
            <span className="badge badge-provided">All Required Fields Mapped</span>
          )}
        </div>

        <div className="table-responsive">
          <table className="report-table">
            <thead>
              <tr>
                <th style={{ width: "35%" }}>Uploaded Header</th>
                <th style={{ width: "35%" }}>Mapped Target Field</th>
                <th style={{ width: "30%" }}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, idx) => (
                <tr key={idx}>
                  <td>
                    <code>{col.source}</code>
                  </td>
                  <td>
                    {col.target ? (
                      <span className="badge badge-target-field">
                        {col.target}
                      </span>
                    ) : (
                      <span className="badge badge-unmapped">
                        (Unmapped header)
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="confidence-meter">
                      <div
                        className="confidence-bar"
                        style={{ width: `${Math.round((col.confidence || 0) * 100)}%` }}
                      />
                      <span className="confidence-text">
                        {Math.round((col.confidence || 0) * 100)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {mapping.unmappedHeaders && mapping.unmappedHeaders.length > 0 && (
          <p className="field-note text-muted" style={{ marginTop: "0.5rem" }}>
            Unmapped headers ignored during ingestion:{" "}
            {mapping.unmappedHeaders.map((h) => `"${h}"`).join(", ")}
          </p>
        )}
      </div>

      {/* Row Diagnostics / Problem Rows */}
      <div className="report-section">
        <div className="section-subtitle-bar">
          <div>
            <h3 className="section-subheading">Row Diagnostics &amp; Issues</h3>
            <p className="text-muted text-sm">
              {problemRows.length === 0
                ? "All uploaded rows passed validation checks without any warnings or errors."
                : `${problemRows.length} rows have warnings or validation notices.`}
            </p>
          </div>

          {problemRows.length > 0 && (
            <div className="filter-pill-group">
              <button
                type="button"
                className={`filter-pill ${rowFilter === "all" ? "active" : ""}`}
                onClick={() => setRowFilter("all")}
              >
                All Notices ({problemRows.length})
              </button>
              <button
                type="button"
                className={`filter-pill ${rowFilter === "errors" ? "active" : ""}`}
                onClick={() => setRowFilter("errors")}
              >
                Errors ({totals.errors})
              </button>
              <button
                type="button"
                className={`filter-pill ${rowFilter === "warnings" ? "active" : ""}`}
                onClick={() => setRowFilter("warnings")}
              >
                Warnings ({totals.warnings})
              </button>
            </div>
          )}
        </div>

        {problemRows.length === 0 ? (
          <div className="all-clean-box">
            <span className="clean-icon">✓</span>
            <span>All attendee records passed schema validation cleanly!</span>
          </div>
        ) : filteredProblemRows.length === 0 ? (
          <div className="empty-filter-state">
            No rows match the selected filter ({rowFilter}).
          </div>
        ) : (
          <div className="table-responsive">
            <table className="report-table">
              <thead>
                <tr>
                  <th style={{ width: "12%" }}>Row #</th>
                  <th style={{ width: "20%" }}>Participant ID</th>
                  <th style={{ width: "15%" }}>Status</th>
                  <th style={{ width: "53%" }}>Issues &amp; Diagnostics</th>
                </tr>
              </thead>
              <tbody>
                {filteredProblemRows.map((r, idx) => (
                  <tr key={idx} className={`row-status-${r.status?.toLowerCase()}`}>
                    <td>
                      <strong>Line {r.rowNumber ?? "—"}</strong>
                    </td>
                    <td>
                      {r.id ? <code>{r.id}</code> : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      <span className={`badge badge-row-${r.status?.toLowerCase()}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <ul className="row-issues-list">
                        {r.issues && r.issues.length > 0 ? (
                          r.issues.map((iss, iIdx) => (
                            <li key={iIdx} className="issue-item">
                              <span className={`issue-code-tag ${iss.severity || "warning"}`}>
                                {iss.code}
                              </span>
                              {formatIssueMessage(iss) && (
                                <span className="issue-msg">{formatIssueMessage(iss)}</span>
                              )}
                              {iss.value !== undefined && iss.value !== null && String(iss.value).trim() !== "" && (
                                <span className="issue-field-note">
                                  ({iss.field ? `${iss.field}: ` : ""}{String(iss.value)})
                                </span>
                              )}
                            </li>
                          ))
                        ) : (
                          <li className="text-muted">No specific diagnostic logged</li>
                        )}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Thresholds and Limits note */}
      {report.longNameMeasurement && (
        <div className="report-footer-note">
          <span className="note-label">Character Measurement Note:</span>{" "}
          {report.longNameMeasurement.note} (Threshold: {report.longNameMeasurement.appliedCharacterThreshold} chars).
        </div>
      )}
    </div>
  );
}
