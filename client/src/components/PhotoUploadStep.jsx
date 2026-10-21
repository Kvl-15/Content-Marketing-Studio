import React, { useState, useRef } from "react";
import { uploadProjectPhotos } from "../api.js";

/**
 * Photo ZIP Upload Step (Slice 2).
 * Uploads raw ZIP bytes via POST /projects/:id/photos.
 *
 * @param {{
 *   project: any;
 *   hasDataset: boolean;
 *   onPhotosUploaded: (results: any) => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function PhotoUploadStep({ project, hasDataset, onPhotosUploaded, onError }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [matchingResults, setMatchingResults] = useState(null);
  const fileInputRef = useRef(null);

  const MAX_ZIP_BYTES = 300 * 1024 * 1024;

  const validateFile = (file) => {
    if (file.size > MAX_ZIP_BYTES) {
      const msg = `Photo archive size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the maximum allowed limit of 300 MB.`;
      setUploadError(msg);
      onError?.(new Error(msg));
      setSelectedFile(null);
      return false;
    }
    return true;
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!validateFile(file)) return;
      setSelectedFile(file);
      setUploadError(null);
      onError(null);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!hasDataset) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!hasDataset) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (!validateFile(file)) return;
      setSelectedFile(file);
      setUploadError(null);
      onError(null);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile || !hasDataset) return;
    if (!validateFile(selectedFile)) return;

    setUploading(true);
    setUploadError(null);
    onError(null);

    try {
      const results = await uploadProjectPhotos(project.id, selectedFile);
      setMatchingResults(results);
      onPhotosUploaded(results);
    } catch (err) {
      setUploadError(err.message || "Failed to upload photo archive");
      onError(err);
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="upload-step-box">
      <div className="upload-step-header">
        <div>
          <h3 className="upload-step-title">2. Upload Attendee Photos (Optional)</h3>
          <p className="upload-step-desc">
            Upload a single <strong>ZIP archive</strong> containing JPEG, PNG, or WebP attendee photos.
            Photos will be matched to participants by ID or name, normalized to sRGB, and safely stored
            for badge generation (300 MB max).
          </p>
        </div>
        <span className="badge badge-subtle">ZIP Archive</span>
      </div>

      {!hasDataset ? (
        <div className="upload-disabled-notice" role="status">
          <span className="notice-icon">ℹ</span>
          <span>
            Please upload participant tabular data above first. Photos require an imported participant list
            to perform matching.
          </span>
        </div>
      ) : (
        <form onSubmit={handleUpload}>
          <div
            className={`dropzone ${isDragging ? "dropzone-active" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Upload photo ZIP archive"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip, application/zip, application/x-zip-compressed"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

            <div className="dropzone-content">
              <span className="dropzone-icon">🖼️</span>
              {selectedFile ? (
                <div className="selected-file-info">
                  <span className="selected-file-name">{selectedFile.name}</span>
                  <span className="selected-file-size">
                    {formatFileSize(selectedFile.size)} &bull; Ready to match
                  </span>
                  <span className="dropzone-hint text-muted">Click or drop another ZIP to replace</span>
                </div>
              ) : (
                <div>
                  <p className="dropzone-prompt">
                    <strong>Click to select a ZIP archive</strong> or drag and drop here
                  </p>
                  <p className="dropzone-hint">Contains .jpg, .png, or .webp images up to 300 MB</p>
                </div>
              )}
            </div>
          </div>

          {uploadError && (
            <div className="form-error-inline" role="alert">
              <span className="error-dot">●</span> {uploadError}
            </div>
          )}

          <div className="upload-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selectedFile || uploading}
            >
              {uploading ? (
                <>
                  <span className="spinner-inline" /> Extracting &amp; Matching Photos...
                </>
              ) : (
                "Upload & Match Photo ZIP"
              )}
            </button>
            {selectedFile && !uploading && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSelectedFile(null);
                  setUploadError(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Clear Selection
              </button>
            )}
          </div>
        </form>
      )}

      {/* Photo Matching Results */}
      {matchingResults && (
        <div className="matching-results-section">
          <div className="section-subtitle-bar">
            <h4 className="section-subheading">Photo Matching Results</h4>
            <span className="badge badge-provided">
              {matchingResults.matches?.length || 0} Photos Matched
            </span>
          </div>

          {/* KPI grid for photos */}
          <div className="kpi-grid">
            <div className="kpi-card kpi-success">
              <span className="kpi-label">Matched Photos</span>
              <span className="kpi-value">{matchingResults.matches?.length || 0}</span>
              <span className="kpi-sub">Assigned to participants</span>
            </div>

            <div
              className={`kpi-card ${
                matchingResults.unmatchedFiles?.length > 0 ? "kpi-warning" : ""
              }`}
            >
              <span className="kpi-label">Unmatched Files</span>
              <span className="kpi-value">{matchingResults.unmatchedFiles?.length || 0}</span>
              <span className="kpi-sub">Files in ZIP with no match</span>
            </div>

            <div
              className={`kpi-card ${
                matchingResults.unmatchedRows?.length > 0 ? "kpi-warning" : ""
              }`}
            >
              <span className="kpi-label">Participants without Photos</span>
              <span className="kpi-value">{matchingResults.unmatchedRows?.length || 0}</span>
              <span className="kpi-sub">Will use fallback avatars</span>
            </div>
          </div>

          {/* Matched Photos Table */}
          {matchingResults.matches && matchingResults.matches.length > 0 && (
            <div className="report-section">
              <h5 className="sub-section-title">Matched Photo Assignments</h5>
              <div className="table-responsive">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th style={{ width: "15%" }}>Row #</th>
                      <th style={{ width: "25%" }}>Participant ID</th>
                      <th style={{ width: "35%" }}>Matched File</th>
                      <th style={{ width: "25%" }}>Match Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchingResults.matches.map((m, idx) => (
                      <tr key={idx}>
                        <td>Line {m.rowNumber ?? (m.rowIndex !== undefined ? m.rowIndex + 1 : "—")}</td>
                        <td>
                          <code>{m.row?.id || m.id || "—"}</code>
                        </td>
                        <td>
                          <code>{m.file || "—"}</code>
                        </td>
                        <td>
                          <span className="badge badge-subtle">{m.method}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Unmatched Files List */}
          {matchingResults.unmatchedFiles && matchingResults.unmatchedFiles.length > 0 && (
            <div className="report-section">
              <h5 className="sub-section-title text-warning">
                Unmatched Files in ZIP ({matchingResults.unmatchedFiles.length})
              </h5>
              <p className="text-muted text-sm">
                These image files did not correspond to any known participant ID or name:
              </p>
              <div className="unmatched-chips-wrap">
                {matchingResults.unmatchedFiles.map((file, idx) => (
                  <span key={idx} className="badge badge-unmatched">
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Warnings List */}
          {matchingResults.warnings && matchingResults.warnings.length > 0 && (
            <div className="report-section">
              <h5 className="sub-section-title text-warning">Photo Ingestion Warnings</h5>
              <ul className="row-issues-list">
                {matchingResults.warnings.map((w, idx) => (
                  <li key={idx} className="issue-item">
                    <span className="issue-code-tag warning">
                      {w.code || "PHOTO_WARNING"}
                    </span>
                    <span className="issue-msg">{w.message || JSON.stringify(w)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ignored Non-Image Files Notes */}
          {matchingResults.ignoredFiles && matchingResults.ignoredFiles.length > 0 && (
            <div className="report-section">
              <h5 className="sub-section-title text-muted">
                Ignored Non-Image Files ({matchingResults.ignoredFiles.length})
              </h5>
              <p className="text-muted text-sm">
                Harmless text and documentation files skipped during image processing:
              </p>
              <ul className="row-issues-list">
                {matchingResults.ignoredFiles.map((item, idx) => (
                  <li key={idx} className="issue-item">
                    <span className="badge badge-subtle">{item.file}</span>
                    <span className="text-muted text-sm" style={{ marginLeft: "8px" }}>
                      {item.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
