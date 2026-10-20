import React, { useState, useEffect } from "react";
import { getQuestions, submitAnswer } from "../api.js";

/**
 * Step 2: Gap Resolution and Question Flow (KB 7.3, D-02).
 *
 * @param {{
 *   spec: any;
 *   onSpecUpdated: (spec: any) => void;
 *   onReadyToLock: () => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function QuestionsStep({ spec, onSpecUpdated, onReadyToLock, onError }) {
  const [questionsData, setQuestionsData] = useState(null);
  const [declinedPaths, setDeclinedPaths] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fieldInputs, setFieldInputs] = useState({});

  // Dynamic role list local editor state
  const [rolesEditor, setRolesEditor] = useState([]);

  const refreshQuestions = async (currentSpec, declined = declinedPaths) => {
    setLoading(true);
    onError(null);
    try {
      const data = await getQuestions(currentSpec, declined);
      setQuestionsData(data);

      // Prepopulate local input values
      const initialInputs = {};
      data.questions.forEach((q) => {
        if (q.prefill !== null && q.prefill !== undefined) {
          if (Array.isArray(q.prefill)) {
            initialInputs[q.path] = q.prefill.join(", ");
          } else {
            initialInputs[q.path] = String(q.prefill);
          }
        } else {
          initialInputs[q.path] = "";
        }
      });
      setFieldInputs(initialInputs);

      // Initialize role editor from current spec
      if (Array.isArray(currentSpec.roles) && currentSpec.roles.length > 0) {
        setRolesEditor(
          currentSpec.roles.map((r) => ({
            label: r.label,
            expectedCount: r.expectedCount || 0,
          }))
        );
      } else {
        setRolesEditor([
          { label: "Participant", expectedCount: 100 },
          { label: "Organizer", expectedCount: 10 },
        ]);
      }
    } catch (err) {
      onError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (spec) {
      refreshQuestions(spec);
    }
  }, [spec]);

  // Confirm a brief-parsed value without retyping
  const handleConfirmBriefValue = async (path) => {
    setLoading(true);
    onError(null);
    try {
      const updatedSpec = await submitAnswer(spec, {
        path,
        action: "confirm",
      });
      onSpecUpdated(updatedSpec);
      await refreshQuestions(updatedSpec);
    } catch (err) {
      onError(err);
      setLoading(false);
    }
  };

  // Decline an optional field
  const handleDeclineField = async (path) => {
    setLoading(true);
    onError(null);
    try {
      const nextDeclined = [...declinedPaths, path];
      setDeclinedPaths(nextDeclined);

      const updatedSpec = await submitAnswer(spec, {
        path,
        action: "decline",
      });
      onSpecUpdated(updatedSpec);
      await refreshQuestions(updatedSpec, nextDeclined);
    } catch (err) {
      onError(err);
      setLoading(false);
    }
  };

  // Submit typed / edited answer
  const handleSubmitValue = async (path, customValue) => {
    setLoading(true);
    onError(null);

    let valToSubmit = customValue !== undefined ? customValue : fieldInputs[path];

    // Format specific widgets
    if (path === "event.dates") {
      valToSubmit = String(valToSubmit)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (path === "event.palette") {
      valToSubmit = String(valToSubmit)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (valToSubmit.length === 0) valToSubmit = null;
    }

    try {
      const updatedSpec = await submitAnswer(spec, {
        path,
        value: valToSubmit,
      });
      onSpecUpdated(updatedSpec);
      await refreshQuestions(updatedSpec);
    } catch (err) {
      onError(err);
      setLoading(false);
    }
  };

  // Submit roles
  const handleSaveRoles = async () => {
    const validRoles = rolesEditor
      .map((r) => ({ label: r.label.trim(), expectedCount: Number(r.expectedCount) || 0 }))
      .filter((r) => r.label.length > 0);

    if (validRoles.length === 0) {
      onError({ code: "EMPTY_ROLES", message: "Please provide at least one attendee role." });
      return;
    }

    await handleSubmitValue("roles", validRoles);
  };

  if (!questionsData) {
    return (
      <div className="card-panel loading-card">
        <div className="spinner" />
        <p className="loading-text">Analyzing spec gaps and fetching next questions...</p>
      </div>
    );
  }

  const { questions, currentStep, totalSteps, hasRequiredGaps, gaps, allDone } = questionsData;

  return (
    <div>
      <div className="card-panel">
        <div className="panel-header">
          <div>
            <h2 className="section-title">Step 2: Questions &amp; Details</h2>
            <p className="section-desc">
              Resolve required gaps and configure event options. Pre-filled values extracted from your
              brief can be confirmed with one click.
            </p>
          </div>
          <span className="step-counter-tag">
            <span className="step-counter-dot" />
            Part {currentStep} of {totalSteps}
          </span>
        </div>

        {allDone || (!hasRequiredGaps && questions.length === 0) ? (
          <div className="resolution-complete-box">
            <div className="complete-icon">&#10003;</div>
            <h3 className="complete-title">All Required Gaps Resolved</h3>
            <p className="complete-desc">
              All essential parameters have been validated. You can proceed to review the complete specification
              and lock it into an immutable version.
            </p>
            <div style={{ marginTop: "1.5rem" }}>
              <button type="button" className="btn btn-primary" onClick={onReadyToLock}>
                Proceed to Review &amp; Lock &rarr;
              </button>
            </div>
          </div>
        ) : (
          <div className="questions-container">
            {questions.map((q) => {
              const hasPrefill = q.prefill !== null && q.prefill !== undefined && q.prefill !== "";

              return (
                <div key={q.id} className="question-card">
                  <div className="question-header">
                    <div className="question-title-wrap">
                      <span className="question-title">{q.question}</span>
                      {q.required ? (
                        <span className="badge badge-required">Required</span>
                      ) : (
                        <span className="badge badge-optional">Optional</span>
                      )}
                    </div>
                    {hasPrefill && (
                      <span className="prefill-tag">
                        Extracted from {q.prefillSource || "brief"}
                      </span>
                    )}
                  </div>

                  {q.help && <p className="form-help">{q.help}</p>}

                  {/* Render Widget */}
                  {q.widget === "text" && (
                    <div className="input-group">
                      <input
                        type="text"
                        className="input-text"
                        placeholder={q.placeholder || "Enter value..."}
                        value={fieldInputs[q.path] ?? ""}
                        onChange={(e) =>
                          setFieldInputs({ ...fieldInputs, [q.path]: e.target.value })
                        }
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSubmitValue(q.path)}
                        disabled={loading}
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {q.widget === "dates" && (
                    <div className="input-group">
                      <input
                        type="text"
                        className="input-text"
                        placeholder="YYYY-MM-DD (e.g. 2026-10-20)"
                        value={fieldInputs[q.path] ?? ""}
                        onChange={(e) =>
                          setFieldInputs({ ...fieldInputs, [q.path]: e.target.value })
                        }
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSubmitValue(q.path)}
                        disabled={loading}
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {q.widget === "checkboxes" && (
                    <div className="checkboxes-wrapper">
                      <div className="checkbox-grid">
                        {["name", "role", "org", "photo"].map((f) => {
                          const currentVals = Array.isArray(spec.fields?.value)
                            ? spec.fields.value
                            : ["name", "role"];
                          const isChecked = currentVals.includes(f);

                          return (
                            <label
                              key={f}
                              className={`checkbox-item ${isChecked ? "checked" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...currentVals, f]
                                    : currentVals.filter((x) => x !== f);
                                  handleSubmitValue(q.path, next);
                                }}
                                disabled={loading}
                              />
                              <span className="checkbox-label">{f}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {q.widget === "role-list" && (
                    <div className="roles-editor-container">
                      <div className="roles-list">
                        {rolesEditor.map((role, idx) => (
                          <div key={idx} className="role-item">
                            <input
                              type="text"
                              className="input-text role-name-input"
                              placeholder="Role name (e.g. Mentor)"
                              value={role.label}
                              onChange={(e) => {
                                const copy = [...rolesEditor];
                                copy[idx].label = e.target.value;
                                setRolesEditor(copy);
                              }}
                              disabled={loading}
                            />
                            <div className="role-count-wrapper">
                              <span className="role-count-label">Count:</span>
                              <input
                                type="number"
                                className="input-text role-count-input"
                                placeholder="100"
                                value={role.expectedCount}
                                onChange={(e) => {
                                  const copy = [...rolesEditor];
                                  copy[idx].expectedCount = parseInt(e.target.value, 10) || 0;
                                  setRolesEditor(copy);
                                }}
                                disabled={loading}
                              />
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setRolesEditor(rolesEditor.filter((_, i) => i !== idx));
                              }}
                              disabled={rolesEditor.length <= 1 || loading}
                              title="Remove role"
                            >
                              &times; Remove
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="role-actions-row">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            setRolesEditor([...rolesEditor, { label: "", expectedCount: 0 }])
                          }
                          disabled={loading}
                        >
                          + Add Role
                        </button>

                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={handleSaveRoles}
                          disabled={loading}
                        >
                          Save Roles
                        </button>
                      </div>
                    </div>
                  )}

                  {q.widget === "palette" && (
                    <div className="input-group">
                      <input
                        type="text"
                        className="input-text"
                        placeholder="#2563EB, #16A34A"
                        value={fieldInputs[q.path] ?? ""}
                        onChange={(e) =>
                          setFieldInputs({ ...fieldInputs, [q.path]: e.target.value })
                        }
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSubmitValue(q.path)}
                        disabled={loading}
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {/* Actions for Pre-fill Confirmation & Declining */}
                  <div className="question-actions">
                    {hasPrefill && (
                      <button
                        type="button"
                        className="btn btn-confirm btn-sm"
                        onClick={() => handleConfirmBriefValue(q.path)}
                        disabled={loading}
                      >
                        &#10003; Accept &amp; Confirm Pre-filled Value
                      </button>
                    )}

                    {!q.required && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDeclineField(q.path)}
                        disabled={loading}
                      >
                        Skip / Decline Optional Field
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {!hasRequiredGaps && (
              <div className="advance-actions-bar">
                <button type="button" className="btn btn-primary" onClick={onReadyToLock}>
                  Proceed to Review &amp; Lock &rarr;
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Gap Status Panel */}
      <div className="gaps-panel">
        <div className="gaps-header">
          <div className="gaps-title-wrap">
            <span className="gaps-title">Gap Checklist (KB 7.3)</span>
            <span className="gaps-subtitle">Live specification status &amp; layout defaults</span>
          </div>
          <span className={hasRequiredGaps ? "badge badge-unknown" : "badge badge-provided"}>
            {hasRequiredGaps
              ? `${gaps.required.length} Required Gaps Remaining`
              : "All Required Satisfied"}
          </span>
        </div>

        <div className="gaps-grid">
          <div className="gaps-col">
            <h4 className="gaps-col-title">Required Fields (Must Provide):</h4>
            <ul className="gaps-list">
              {gaps.required.length === 0 ? (
                <li className="gaps-item empty-state">
                  <span className="check-mark">&#10003;</span> All required fields provided
                </li>
              ) : (
                gaps.required.map((r, i) => (
                  <li key={i} className="gaps-item">
                    <span className="gaps-item-label">{r.label}</span>
                    <span className="badge badge-unknown">{r.reason}</span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="gaps-col">
            <h4 className="gaps-col-title">Print &amp; Layout Defaults (CR80):</h4>
            <ul className="gaps-list">
              {gaps.defaulted.map((d, i) => (
                <li key={i} className="gaps-item">
                  <span className="gaps-item-label">{d.label}</span>
                  <span className="gaps-item-default">{String(d.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
