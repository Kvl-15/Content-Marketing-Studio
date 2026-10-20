import React, { useState, useRef } from "react";
import { uploadProjectData } from "../api.js";

/**
 * Tabular Data Upload Step (Slice 2).
 * Uploads raw CSV, XLSX, or JSON bytes via POST /projects/:id/data.
 *
 * @param {{
 *   project: any;
 *   onDataUploaded: (report: any) => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function DataUploadStep({ project, onDataUploaded, onError }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [successNotice, setSuccessNotice] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadError(null);
      setSuccessNotice(null);
      onError(null);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadError(null);
      onError(null);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setUploadError(null);
    onError(null);

    // Detect format from file extension
    let kind = "csv";
    const nameLower = selectedFile.name.toLowerCase();
    if (nameLower.endsWith(".xlsx")) kind = "xlsx";
    else if (nameLower.endsWith(".json")) kind = "json";

    try {
      const result = await uploadProjectData(project.id, selectedFile, {
        kind,
        contentType: selectedFile.type || "application/octet-stream",
      });

      const rows = result.report?.totals?.rows ?? 0;
      const errors = result.report?.totals?.errors ?? 0;
      const validCount = Math.max(0, rows - errors);
      setSuccessNotice(`Participant data successfully ingested! ${validCount} valid attendee records ready for badges.`);
      onDataUploaded(result.report, { isError: false });
    } catch (err) {
      setUploadError(err.message || "Failed to upload data");
      setSuccessNotice(null);
      onError(err);
      // If error has a diagnostic report (e.g. 422 with zero valid participants), surface it
      if (err.report) {
        onDataUploaded(err.report, { isError: true, errorMessage: err.message });
      }
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
          <h3 className="upload-step-title">1. Upload Participant Tabular Data</h3>
          <p className="upload-step-desc">
            Upload your attendee list in <strong>CSV</strong>, <strong>Excel (.xlsx)</strong>, or{" "}
            <strong>JSON</strong> format. The server will auto-detect columns, validate attendee roles
            against the locked EventSpec, and enforce security checks (25 MB max).
          </p>
        </div>
        <div className="upload-badges">
          <span className="badge badge-subtle">CSV</span>
          <span className="badge badge-subtle">XLSX</span>
          <span className="badge badge-subtle">JSON</span>
        </div>
      </div>

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
          aria-label="Upload tabular data file"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv, .xlsx, .json, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          <div className="dropzone-content">
            <span className="dropzone-icon">📄</span>
            {selectedFile ? (
              <div className="selected-file-info">
                <span className="selected-file-name">{selectedFile.name}</span>
                <span className="selected-file-size">
                  {formatFileSize(selectedFile.size)} &bull; Ready to upload
                </span>
                <span className="dropzone-hint text-muted">Click or drop another file to replace</span>
              </div>
            ) : (
              <div>
                <p className="dropzone-prompt">
                  <strong>Click to select a file</strong> or drag and drop here
                </p>
                <p className="dropzone-hint">Supported: .csv, .xlsx, or .json up to 25 MB</p>
              </div>
            )}
          </div>
        </div>

        {uploadError && (
          <div className="form-error-inline" role="alert">
            <span className="error-dot">●</span> {uploadError}
          </div>
        )}

        {successNotice && (
          <div className="form-success-inline" role="status">
            <span className="success-icon">&#10003;</span> {successNotice}
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
                <span className="spinner-inline" /> Ingesting &amp; Validating Data...
              </>
            ) : (
              "Upload & Ingest Participant Data"
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
    </div>
  );
}
