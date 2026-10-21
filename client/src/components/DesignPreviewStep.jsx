import React, { useState, useEffect } from "react";
import { composeProjectDrafts, saveProjectVersion } from "../api.js";
import { getDesignSelectionState } from "../preflightClassification.js";

/**
 * ID Card Design Generation, Role Preview & Selection Step (Slice 3).
 *
 * @param {{
 *   project: any;
 *   hasDataset: boolean;
 *   onProjectUpdated: (updatedProject: any) => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function DesignPreviewStep({
  project,
  hasDataset,
  onProjectUpdated,
  onError,
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [savingIndex, setSavingIndex] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [localError, setLocalError] = useState(null);

  // Dynamic roles from locked EventSpec (never hardcoded)
  const roles = Array.isArray(project.eventSpec?.roles) && project.eventSpec.roles.length > 0
    ? project.eventSpec.roles
    : [{ id: "participant", label: "PARTICIPANT" }];

  const [activeRoleId, setActiveRoleId] = useState(roles[0]?.id || "participant");

  // Keep activeRoleId valid if project roles change
  useEffect(() => {
    if (!roles.some((r) => r.id === activeRoleId)) {
      setActiveRoleId(roles[0]?.id || "participant");
    }
  }, [roles, activeRoleId]);

  const drafts = Array.isArray(project.currentDrafts) ? project.currentDrafts : [];
  const versions = Array.isArray(project.versions) ? project.versions : [];
  const latestVersion = versions.length > 0 ? versions[versions.length - 1] : null;

  // Generate / Re-generate drafts
  const handleGenerateDrafts = async (isReroll = false) => {
    if (!hasDataset) return;
    setIsGenerating(true);
    setLocalError(null);
    setActionSuccess(null);

    try {
      const options = {
        count: 3,
        ...(isReroll ? { seed: String(Date.now()) } : {}),
      };

      const result = await composeProjectDrafts(project.id, options);

      onProjectUpdated({
        ...project,
        currentDrafts: result.drafts,
        draftSeed: result.seed,
        draftIssues: result.issues || [],
      });

      setActionSuccess(
        isReroll
          ? "✦ New design variations are previews only. Choose one below and click 'Select Design Option' to save it as the next version."
          : "Composed 3 print-ready ID card designs."
      );
    } catch (err) {
      setLocalError(err.message || "Failed to generate card designs.");
      onError(err);
    } finally {
      setIsGenerating(false);
    }
  };

  // Select design and snapshot into immutable version
  const handleSelectDraft = async (draftIndex) => {
    setIsSavingVersion(true);
    setSavingIndex(draftIndex);
    setLocalError(null);
    setActionSuccess(null);

    try {
      const newVersion = await saveProjectVersion(project.id, {
        draftIndex,
        note: `Selected Option ${draftIndex + 1}`,
      });

      const updatedVersions = [...versions, newVersion];

      onProjectUpdated({
        ...project,
        versions: updatedVersions,
      });

      setActionSuccess(
        `Design Option ${draftIndex + 1} locked as Version ${newVersion.versionNumber}.`
      );
    } catch (err) {
      setLocalError(err.message || "Failed to save design version.");
      onError(err);
    } finally {
      setIsSavingVersion(false);
      setSavingIndex(null);
    }
  };

  return (
    <div className="card-panel design-preview-panel">
      {/* Step Header */}
      <div className="upload-step-header">
        <div>
          <h3 className="upload-step-title">
            Step 3: ID Card Design Generation &amp; Preview
          </h3>
          <p className="upload-step-desc">
            Generate visually distinct card layouts, preview each attendee role variant with real photos or fallback initials, and select a preferred design to snapshot for export.
          </p>
        </div>
        <span
          className={`badge ${
            latestVersion
              ? "badge-locked"
              : drafts.length > 0
              ? "badge-primary"
              : hasDataset
              ? "badge-subtle"
              : "badge-subtle"
          }`}
        >
          {latestVersion
            ? `✓ Version ${latestVersion.versionNumber} Selected`
            : drafts.length > 0
            ? `${drafts.length} Designs Ready`
            : hasDataset
            ? "Ready to Generate"
            : "🔒 Upload Data First"}
        </span>
      </div>

      {/* Local Feedback Alerts */}
      {localError && (
        <div className="report-error-alert" role="alert" style={{ marginTop: "1rem" }}>
          <span className="error-icon-inline">!</span>
          <div>
            <strong>Design Error:</strong> {localError}
          </div>
        </div>
      )}

      {actionSuccess && (
        <div className="form-success-inline" role="status" style={{ marginTop: "1rem" }}>
          <span className="success-icon">✓</span>
          <div>{actionSuccess}</div>
        </div>
      )}

      {/* Gated Notice when Dataset not ready */}
      {!hasDataset && (
        <div className="step-gated-box" style={{ marginTop: "1.25rem" }}>
          <div className="gated-lock-icon">🔒</div>
          <div>
            <h4 className="gated-title">Design Generation Gated</h4>
            <p className="gated-desc">
              Please complete Step 1 by importing attendee tabular data. Design generation requires valid participant counts and roles from your event dataset.
            </p>
          </div>
        </div>
      )}

      {/* Empty State: Unlocked but No Drafts Generated Yet */}
      {hasDataset && drafts.length === 0 && (
        <div className="empty-drafts-card">
          <div className="empty-drafts-icon">✦</div>
          <h4 className="empty-drafts-title">Generate Card Layout Options</h4>
          <p className="empty-drafts-desc">
            Our multi-look composer will generate 3 visually distinct ID card options based on your locked event branding, palette, and typography rules.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => handleGenerateDrafts(false)}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className="spinner-inline" /> Composing Layouts &amp; Rendering Previews...
              </>
            ) : (
              "✦ Generate ID Card Designs"
            )}
          </button>
        </div>
      )}

      {/* Active State: Drafts Generated */}
      {hasDataset && drafts.length > 0 && (
        <div className="drafts-active-workspace">
          {/* Controls Bar: Role Switcher & Re-roll */}
          <div className="drafts-control-bar">
            <div className="role-switcher-group">
              <span className="control-label">Preview Role Variant:</span>
              <div className="role-tabs-wrap" role="tablist" aria-label="Attendee Roles">
                {roles.map((role) => {
                  const isActive = activeRoleId === role.id;
                  const roleColor = role.color?.value || "#2563EB";
                  return (
                    <button
                      key={role.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`role-tab ${isActive ? "active" : ""}`}
                      onClick={() => setActiveRoleId(role.id)}
                    >
                      <span
                        className="role-color-dot"
                        style={{ backgroundColor: roleColor }}
                      />
                      <span className="role-tab-name">{role.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="drafts-actions-right">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleGenerateDrafts(true)}
                disabled={isGenerating || isSavingVersion}
                title="Compose 3 new design variations with a different random seed"
              >
                {isGenerating ? (
                  <>
                    <span className="spinner-inline" /> Re-generating...
                  </>
                ) : (
                  "↻ Generate Different Variations"
                )}
              </button>
            </div>
          </div>

          {/* Active Version Confirmation Banner */}
          {latestVersion && (
            <div className="version-status-banner">
              <div className="version-status-left">
                <span className="version-status-icon">✓</span>
                <div>
                  <div className="version-status-heading">
                    Design Option {latestVersion.draftIndex + 1} is locked as Version {latestVersion.versionNumber}
                  </div>
                  <div className="version-status-sub">
                    Archetype: <code>{latestVersion.draft?.look?.attributes?.archetype || "custom"}</code> &bull; Mode: <code>{latestVersion.draft?.look?.attributes?.mode || "standard"}</code> &bull; Snapshot contains {latestVersion.peopleCount || project.peopleCount} attendees
                  </div>
                </div>
              </div>
              <span className="badge badge-locked">
                Version {latestVersion.versionNumber} Active
              </span>
            </div>
          )}

          {/* 3-Column Comparison Grid */}
          <div className="drafts-comparison-grid">
            {drafts.map((draft, index) => {
              const buttonState = getDesignSelectionState({
                draft,
                latestVersion,
                currentPhotoCount: project?.photoCount,
                savedPhotoCount: latestVersion?.photoCount,
                optionIndex: index,
              });
              const isSelected = buttonState.isLocked;
              const isSavingThis = isSavingVersion && savingIndex === index;
              const previewSvg = draft.roleSvgs?.[activeRoleId] || draft.svg;
              const archetype = draft.look?.attributes?.archetype || "classic";
              const mode = draft.look?.attributes?.mode || "colour-field";
              const typography = draft.look?.attributes?.typography || "roboto";
              const score = typeof draft.score === "number" ? Math.round(draft.score) : null;

              return (
                <div
                  key={index}
                  className={`draft-card ${isSelected ? "is-selected" : ""}`}
                >
                  {/* Draft Card Header */}
                  <div className="draft-card-header">
                    <div className="draft-card-title-row">
                      <h4 className="draft-option-title">Design Option {index + 1}</h4>
                      {buttonState.isLocked && (
                        <span className="badge badge-locked">
                          ✓ Selected (v{latestVersion.versionNumber})
                        </span>
                      )}
                      {buttonState.state === "UPDATE_AVAILABLE" && (
                        <span className="badge badge-row-warning">
                          New photos pending (v{latestVersion.versionNumber})
                        </span>
                      )}
                    </div>

                    {/* Metadata Chips */}
                    <div className="draft-meta-chips">
                      <span className="meta-chip chip-archetype" title="Design Archetype">
                        {archetype}
                      </span>
                      <span className="meta-chip chip-mode" title="Palette Mode">
                        {mode}
                      </span>
                      <span className="meta-chip chip-typo" title="Typography">
                        {typography}
                      </span>
                      {score !== null && (
                        <span className="meta-chip chip-score" title="Design Quality Score">
                          ★ {score}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Preview Container (CR80 Aspect Ratio) */}
                  <div className="card-preview-viewport">
                    {previewSvg ? (
                      <div
                        className="card-svg-container"
                        dangerouslySetInnerHTML={{ __html: previewSvg }}
                      />
                    ) : (
                      <div className="card-preview-placeholder">
                        <span>SVG preview unavailable</span>
                      </div>
                    )}
                  </div>

                  {/* Draft Card Footer / Selection Action */}
                  <div className="draft-card-footer">
                    {buttonState.isLocked ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-full is-locked-btn"
                        disabled
                      >
                        {buttonState.label}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`btn btn-primary btn-full ${
                          buttonState.state === "UPDATE_AVAILABLE" ? "is-update-btn" : ""
                        }`}
                        onClick={() => handleSelectDraft(index)}
                        disabled={isSavingVersion || isGenerating}
                      >
                        {isSavingThis ? (
                          <>
                            <span className="spinner-inline" /> Saving Version...
                          </>
                        ) : (
                          buttonState.label
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
