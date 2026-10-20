import React from "react";

/**
 * Clean error banner component displaying error code and message.
 * Strict rule: Never renders stack traces or internal secrets.
 *
 * @param {{
 *   error: { code: string; message: string; issues?: any[] } | null;
 *   onDismiss: () => void;
 * }} props
 */
export function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;

  return (
    <div className="error-banner" role="alert">
      <div className="error-icon">&#9888;</div>
      <div className="error-body">
        <div className="error-title-row">
          <span className="error-title">Error</span>
          <span className="error-code">{error.code || "REQUEST_FAILED"}</span>
        </div>
        <div className="error-message">{error.message || "An unexpected error occurred."}</div>
        {Array.isArray(error.issues) && error.issues.length > 0 && (
          <ul className="error-issues-list">
            {error.issues.map((iss, i) => (
              <li key={i} className="error-issue-item">
                <code className="issue-path">{iss.path?.join(".") || "field"}</code>: {iss.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="error-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss error"
        title="Dismiss error"
      >
        &times;
      </button>
    </div>
  );
}
