import React, { useState } from "react";
import { ErrorBanner } from "./components/ErrorBanner.jsx";
import { BriefStep } from "./components/BriefStep.jsx";
import { QuestionsStep } from "./components/QuestionsStep.jsx";
import { ReviewStep } from "./components/ReviewStep.jsx";

export default function App() {
  const [step, setStep] = useState(1);
  const [spec, setSpec] = useState(null);
  const [isFromAi, setIsFromAi] = useState(false);
  const [lockedSpec, setLockedSpec] = useState(null);
  const [error, setError] = useState(null);

  const handleSpecExtracted = (extractedSpec, fromAi) => {
    setSpec(extractedSpec);
    setIsFromAi(fromAi);
    setStep(2);
  };

  const handleSpecUpdated = (newSpec) => {
    setSpec(newSpec);
  };

  const handleReadyToLock = () => {
    setStep(3);
  };

  const handleSpecLocked = (locked) => {
    setLockedSpec(locked);
    setSpec(locked);
  };

  const handleReset = () => {
    setStep(1);
    setSpec(null);
    setIsFromAi(false);
    setLockedSpec(null);
    setError(null);
  };

  return (
    <div className="app-container">
      {/* Dev-Tool Top Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-badge">CMS</div>
          <div>
            <h1 className="app-title">Content Marketing Studio</h1>
            <p className="app-subtitle">
              Event Intake &amp; Specification Engine &bull; Deterministic &amp; Privacy-First (D-02, D-10, D-12)
            </p>
          </div>
        </div>
        <div className="header-meta">
          <span className="env-badge">DevTools</span>
        </div>
      </header>

      {/* Global Error Notification */}
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Polished Horizontal Stepper with Connecting Lines */}
      <div className="stepper-wrapper">
        <div className="stepper">
          <div
            className={`stepper-step ${
              step === 1 ? "active" : step > 1 ? "completed" : "pending"
            }`}
          >
            <div className="stepper-circle">{step > 1 ? "\u2713" : "1"}</div>
            <div className="stepper-content">
              <span className="stepper-step-num">Step 1</span>
              <span className="stepper-label">Event Brief</span>
            </div>
          </div>

          <div className={`stepper-divider ${step > 1 ? "completed" : ""}`} />

          <div
            className={`stepper-step ${
              step === 2 ? "active" : step > 2 ? "completed" : "pending"
            }`}
          >
            <div className="stepper-circle">{step > 2 ? "\u2713" : "2"}</div>
            <div className="stepper-content">
              <span className="stepper-step-num">Step 2</span>
              <span className="stepper-label">Questions &amp; Gaps</span>
            </div>
          </div>

          <div className={`stepper-divider ${step > 2 ? "completed" : ""}`} />

          <div
            className={`stepper-step ${
              step === 3 ? "active" : lockedSpec ? "completed" : "pending"
            }`}
          >
            <div className="stepper-circle">{lockedSpec ? "\u2713" : "3"}</div>
            <div className="stepper-content">
              <span className="stepper-step-num">Step 3</span>
              <span className="stepper-label">Review &amp; Lock</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Step Panels */}
      <main className="main-content">
        {step === 1 && (
          <BriefStep
            onSpecExtracted={handleSpecExtracted}
            onError={setError}
          />
        )}

        {step === 2 && spec && (
          <QuestionsStep
            spec={spec}
            onSpecUpdated={handleSpecUpdated}
            onReadyToLock={handleReadyToLock}
            onError={setError}
          />
        )}

        {step === 3 && spec && (
          <ReviewStep
            spec={spec}
            onSpecLocked={handleSpecLocked}
            onBack={() => setStep(2)}
            onReset={handleReset}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}
