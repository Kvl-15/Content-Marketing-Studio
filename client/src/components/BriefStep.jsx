import React, { useState } from "react";
import { parseBrief } from "../api.js";

/**
 * Step 1: Event Brief entry & AI parse.
 *
 * @param {{
 *   onSpecExtracted: (spec: any, fromAi: boolean) => void;
 *   onError: (err: any) => void;
 * }} props
 */
export function BriefStep({ onSpecExtracted, onError }) {
  const [briefText, setBriefText] = useState(
    "We need ID cards for the 24-hour Hackathon at SVNIT Surat on 2026-10-20. " +
      "We expect 200 participants and 15 mentors. Participant cards should display name, role, and organization."
  );
  const [loading, setLoading] = useState(false);

  const handleParseWithAi = async () => {
    if (!briefText.trim()) {
      onError({ code: "EMPTY_BRIEF", message: "Please enter a brief description of your event." });
      return;
    }

    setLoading(true);
    onError(null);

    try {
      const result = await parseBrief(briefText);

      if (result.ok && result.spec) {
        onSpecExtracted(result.spec, true);
      } else if (result.emptySpec) {
        // Fallback path: 422 BRIEF_PARSE_FAILED or AI_UNAVAILABLE (D-12)
        onError({
          code: result.error?.code || "AI_FALLBACK",
          message: `${result.error?.message || "AI extraction unavailable"}. Switched to manual form fallback.`,
        });
        onSpecExtracted(result.emptySpec, false);
      }
    } catch (err) {
      onError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSkipAi = async () => {
    // Manual form fallback (D-12): use empty spec directly
    setLoading(true);
    onError(null);
    try {
      const emptyScaffold = {
        schemaVersion: 1,
        designType: "id-card",
        event: {
          name: { value: null, status: "unknown" },
          tagline: { value: null, status: "unknown" },
          venue: { value: null, status: "unknown" },
          dates: { value: null, status: "unknown" },
          palette: undefined,
        },
        roles: [],
        fields: { value: null, status: "unknown" },
        card: {
          widthMm: 54,
          heightMm: 85.6,
          orientation: "portrait",
          bleedMm: 3,
          safeMarginMm: 3,
          sides: "front",
        },
        qr: {
          enabled: false,
          urlPattern: "",
        },
      };
      onSpecExtracted(emptyScaffold, false);
    } catch (err) {
      onError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-panel">
      <div className="panel-header">
        <div>
          <h2 className="section-title">Step 1: Event Description</h2>
          <p className="section-desc">
            Describe your event in plain English. The AI gateway will extract details like name,
            dates, venue, attendee roles, and badge requirements. Any detail not explicitly in your brief
            will remain unknown and requested via the step-by-step form (D-02).
          </p>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="brief-input" className="form-label">
          <span>Event Brief</span>
          <span className="form-label-hint">Plain text description</span>
        </label>
        <textarea
          id="brief-input"
          className="input-textarea"
          value={briefText}
          onChange={(e) => setBriefText(e.target.value)}
          placeholder="e.g. We need ID cards for the Annual Tech Symposium at SVNIT Surat..."
          rows={5}
          disabled={loading}
        />
        <div className="privacy-pill">
          <span className="privacy-icon">&#128274;</span>
          <span>
            <strong>Privacy guarantee (D-10):</strong> Only the event brief text and schema are sent to the AI.
            No participant names, emails, or photos are ever transmitted.
          </span>
        </div>
      </div>

      <div className="btn-group">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleParseWithAi}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner-inline" /> Parsing with Gemini...
            </>
          ) : (
            "Extract with Gemini AI"
          )}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleSkipAi}
          disabled={loading}
        >
          Skip AI (Manual Form Fallback)
        </button>
      </div>
    </div>
  );
}
