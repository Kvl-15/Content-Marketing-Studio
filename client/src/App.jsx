import React, { useState, useEffect } from "react";
import { getProject } from "./api.js";
import { ErrorBanner } from "./components/ErrorBanner.jsx";
import { BriefStep } from "./components/BriefStep.jsx";
import { QuestionsStep } from "./components/QuestionsStep.jsx";
import { ReviewStep } from "./components/ReviewStep.jsx";
import { ProjectDashboard } from "./components/ProjectDashboard.jsx";
import { ProjectWorkflow } from "./components/ProjectWorkflow.jsx";

export default function App() {
  // Top-level views: "dashboard" | "intake" | "project-workflow"
  const [view, setView] = useState("dashboard");

  // Active loaded project for "project-workflow" view
  const [activeProject, setActiveProject] = useState(null);
  const [loadingProject, setLoadingProject] = useState(false);

  // Intake wizard state (Steps 1 to 3)
  const [step, setStep] = useState(1);
  const [spec, setSpec] = useState(null);
  const [isFromAi, setIsFromAi] = useState(false);
  const [lockedSpec, setLockedSpec] = useState(null);

  // Global notification error
  const [error, setError] = useState(null);

  // Reset scroll to top upon view transitions or project load (React effect, not during render)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view, activeProject?.id]);

  // Intake flow handlers
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

  const handleResetIntake = () => {
    setStep(1);
    setSpec(null);
    setIsFromAi(false);
    setLockedSpec(null);
    setError(null);
  };

  const handleStartIntake = () => {
    handleResetIntake();
    setView("intake");
  };

  // Project Creation handler from ReviewStep (POST /projects)
  const handleProjectCreated = (createdProject) => {
    setActiveProject(createdProject);
    setView("project-workflow");
  };

  // Open existing project from Dashboard (GET /projects/:id)
  const handleOpenProject = async (projectId) => {
    setLoadingProject(true);
    setError(null);
    try {
      const fullProject = await getProject(projectId);
      setActiveProject(fullProject);
      setView("project-workflow");
    } catch (err) {
      setError(err);
    } finally {
      setLoadingProject(false);
    }
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
              Event Specification, Attendee Data Pipeline &amp; Photo Matching (D-02, D-10, D-45)
            </p>
          </div>
        </div>

        {/* Global Navigation Tabs */}
        <nav className="header-nav" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-tab ${view === "dashboard" ? "active" : ""}`}
            onClick={() => setView("dashboard")}
          >
            Dashboard
          </button>

          <button
            type="button"
            className={`nav-tab ${view === "intake" ? "active" : ""}`}
            onClick={() => {
              if (view !== "intake") {
                if (!spec) handleStartIntake();
                else setView("intake");
              }
            }}
          >
            Intake Spec {view === "intake" && `(Step ${step})`}
          </button>

          {activeProject && (
            <button
              type="button"
              className={`nav-tab ${view === "project-workflow" ? "active" : ""}`}
              onClick={() => setView("project-workflow")}
            >
              Project: {activeProject.eventCode || activeProject.name}
            </button>
          )}

          <span className="env-badge">DevTools</span>
        </nav>
      </header>

      {/* Global Error Notification */}
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Loading overlay for project fetching */}
      {loadingProject && (
        <div className="global-loading-notice" role="status">
          <span className="spinner-inline" /> Loading project details...
        </div>
      )}

      {/* VIEW 1: Projects Dashboard */}
      {view === "dashboard" && (
        <ProjectDashboard
          onOpenProject={handleOpenProject}
          onStartIntake={handleStartIntake}
          onError={setError}
        />
      )}

      {/* VIEW 2: Intake Flow Wizard (Brief -> Questions -> Review & Lock) */}
      {view === "intake" && (
        <>
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

          {/* Main Intake Step Panels */}
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
                onProjectCreated={handleProjectCreated}
                onBack={() => setStep(2)}
                onReset={handleResetIntake}
                onError={setError}
              />
            )}
          </main>
        </>
      )}

      {/* VIEW 3: Active Project Upload Workflow (Data Upload, A2 Report, Photo ZIP) */}
      {view === "project-workflow" && activeProject && (
        <ProjectWorkflow
          project={activeProject}
          onBackToDashboard={() => setView("dashboard")}
          onProjectUpdated={(updated) => setActiveProject(updated)}
          onError={setError}
        />
      )}
    </div>
  );
}
