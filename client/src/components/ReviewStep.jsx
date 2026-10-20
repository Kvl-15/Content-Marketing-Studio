import React, { useState } from "react";
import { lockSpec } from "../api.js";

/**
 * Step 3: EventSpec Review & Immutability Lock (KB 7.6, D-13).
 *
 * @param {{
 *   spec: any;
 *   onSpecLocked: (lockedSpec: any) => void;
 *   onBack: () => void;
 *   onReset: () => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function ReviewStep({ spec, onSpecLocked, onBack, onReset, onError }) {
  const [locking, setLocking] = useState(false);
  const [lockedData, setLockedData] = useState(null);
  const [copied, setCopied] = useState(false);

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
            <span className="locked-success-label">
              &#10003; Specification is permanently locked.
            </span>
            <button
              type="button"
              className="btn btn-primary"
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
