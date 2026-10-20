// @ts-check
/**
 * @module server/intake/questions
 * Question bank and follow-up question selector (KB 7.5, D-39).
 * Pure function: no network, no Date.now, no Math.random.
 */

import { findGaps } from "./gaps.js";

/**
 * Question Bank definition.
 * 3 steps:
 *  Step 1: Event Basics (name, dates, venue, designType if missing)
 *  Step 2: Attendees & Elements (roles, fields)
 *  Step 3: Optional Polish (tagline, palette)
 *
 * NOTE: Per D-39 and addendum:
 *  - Do NOT ask QR questions.
 *  - Do NOT ask "how will photos be provided".
 *  - Do NOT offer landscape or back sides.
 */
export const QUESTION_BANK = [
  // Step 1: Event Basics
  {
    id: "designType",
    path: "designType",
    step: 1,
    required: true,
    question: "What type of cards are you creating?",
    help: "Choose the design type for your event.",
    widget: "chips",
    options: ["id-card"],
    extractValue: (spec) => (spec.designType === "id-card" ? "id-card" : null),
  },
  {
    id: "event.name",
    path: "event.name",
    step: 1,
    required: true,
    question: "What is the name of your event?",
    help: "This will appear prominently on every badge (e.g. 'ACM Hackathon 2026').",
    widget: "text",
    placeholder: "e.g. 24-hour Hackathon 2026",
    extractValue: (spec) => spec.event?.name?.value || null,
  },
  {
    id: "event.dates",
    path: "event.dates",
    step: 1,
    required: true,
    question: "What are the dates for the event?",
    help: "Enter one or more calendar dates in YYYY-MM-DD format.",
    widget: "dates",
    placeholder: "YYYY-MM-DD",
    extractValue: (spec) => spec.event?.dates?.value || null,
  },
  {
    id: "event.venue",
    path: "event.venue",
    step: 1,
    required: true,
    question: "Where is the event taking place?",
    help: "Campus, building, or location string.",
    widget: "text",
    placeholder: "e.g. SVNIT Surat, Gujarat",
    extractValue: (spec) => spec.event?.venue?.value || null,
  },

  // Step 2: Roles and Fields
  {
    id: "roles",
    path: "roles",
    step: 2,
    required: true,
    question: "What attendee roles or tiers need badges?",
    help: "Provide attendee roles (e.g. Participant, Mentor, Organizer).",
    widget: "role-list",
    placeholder: "e.g. Participant, Mentor, Organizer",
    extractValue: (spec) => (Array.isArray(spec.roles) && spec.roles.length > 0 ? spec.roles : null),
  },
  {
    id: "fields",
    path: "fields",
    step: 2,
    required: true,
    question: "Which participant fields should appear on the cards?",
    help: "Select the data elements to display.",
    widget: "checkboxes",
    options: ["name", "role", "org", "photo"],
    extractValue: (spec) => spec.fields?.value || null,
  },

  // Step 3: Polish / Optional
  {
    id: "event.tagline",
    path: "event.tagline",
    step: 3,
    required: false,
    question: "Does the event have a tagline or subtitle? (Optional)",
    help: "Short slogan or theme subtitle. You may skip this.",
    widget: "text",
    placeholder: "e.g. Build, Ship, Learn",
    extractValue: (spec) => spec.event?.tagline?.value || null,
  },
  {
    id: "event.palette",
    path: "event.palette",
    step: 3,
    required: false,
    question: "Do you have specific brand colors? (Optional)",
    help: "Up to 3 hex colors (e.g. #2563EB). If skipped, colors will derive from the brand kit.",
    widget: "palette",
    placeholder: "#2563EB",
    extractValue: (spec) => spec.event?.palette || null,
  },
];

/**
 * Returns the next batch of 3 to 5 questions across 2 or 3 steps.
 * Declined paths are never asked again.
 * Values with status "suggestion" never count as provided.
 *
 * @param {any} spec
 * @param {string[] | Set<string>} [declinedInput] - Paths the user has explicitly declined
 * @returns {{
 *   questions: Array<{
 *     id: string;
 *     path: string;
 *     step: number;
 *     required: boolean;
 *     question: string;
 *     help: string;
 *     widget: string;
 *     options?: string[];
 *     placeholder?: string;
 *     prefill: any;
 *     prefillSource: string | null;
 *     isSuggestion: boolean;
 *   }>;
 *   currentStep: number;
 *   totalSteps: number;
 *   allDone: boolean;
 * }}
 */
export function nextQuestions(spec, declinedInput = []) {
  const declinedSet = new Set(
    Array.isArray(declinedInput) ? declinedInput : declinedInput instanceof Set ? declinedInput : []
  );

  // Check gaps
  const gaps = findGaps(spec);
  const gapPaths = new Set([
    ...gaps.required.map((g) => g.path),
    ...gaps.optional.map((g) => g.path),
  ]);

  // Filter candidates from question bank:
  // Must be in gaps, not declined, and not already declined in spec provenance
  const eligibleQuestions = QUESTION_BANK.filter((q) => {
    if (declinedSet.has(q.path)) return false;

    // Check if field in spec is already marked "declined"
    if (q.path.startsWith("event.")) {
      const fieldKey = q.path.slice("event.".length);
      if (spec.event?.[fieldKey]?.status === "declined") return false;
    } else if (q.path === "fields" && spec.fields?.status === "declined") {
      return false;
    }

    return gapPaths.has(q.path);
  });

  if (eligibleQuestions.length === 0) {
    return {
      questions: [],
      currentStep: 3,
      totalSteps: 3,
      allDone: true,
    };
  }

  // Determine current step based on earliest eligible question
  const currentStep = Math.min(...eligibleQuestions.map((q) => q.step));

  // Collect questions starting from currentStep
  let batch = eligibleQuestions.filter((q) => q.step === currentStep);

  // If batch is smaller than 3, and later steps have questions, include them up to 5 max
  if (batch.length < 3) {
    const nextStepQuestions = eligibleQuestions.filter((q) => q.step > currentStep);
    for (const nq of nextStepQuestions) {
      if (batch.length >= 5) break;
      batch.push(nq);
    }
  }

  // Cap at 5 questions max
  if (batch.length > 5) {
    batch = batch.slice(0, 5);
  }

  // Format question objects with prefill information
  const formattedQuestions = batch.map((q) => {
    let prefill = q.extractValue(spec);
    let prefillSource = null;
    let isSuggestion = false;

    if (q.path.startsWith("event.")) {
      const fieldKey = q.path.slice("event.".length);
      const prov = spec.event?.[fieldKey];
      prefillSource = prov?.source || null;
      isSuggestion = prov?.status === "suggestion" || prov?.source === "suggestion";
    } else if (q.path === "fields") {
      prefillSource = spec.fields?.source || null;
      isSuggestion = spec.fields?.status === "suggestion" || spec.fields?.source === "suggestion";
    }

    return {
      id: q.id,
      path: q.path,
      step: q.step,
      required: q.required,
      question: q.question,
      help: q.help,
      widget: q.widget,
      ...(q.options ? { options: q.options } : {}),
      ...(q.placeholder ? { placeholder: q.placeholder } : {}),
      prefill,
      prefillSource,
      isSuggestion,
    };
  });

  return {
    questions: formattedQuestions,
    currentStep,
    totalSteps: 3,
    allDone: false,
  };
}
