// @ts-check

/**
 * Normalizes input people array or set into a Set of person ID strings.
 *
 * @param {Array<any> | Set<string>} [currentPeople=[]]
 * @returns {Set<string>}
 */
export function extractPersonIdSet(currentPeople = []) {
  if (currentPeople instanceof Set) {
    return currentPeople;
  }
  if (!Array.isArray(currentPeople)) {
    return new Set();
  }
  const idSet = new Set();
  for (const p of currentPeople) {
    if (typeof p === "string" && p.trim().length > 0) {
      idSet.add(p.trim());
    } else if (p && typeof p === "object" && typeof p.id === "string" && p.id.trim().length > 0) {
      idSet.add(p.id.trim());
    }
  }
  return idSet;
}

/**
 * Classifies whether a stored draft issue is a synthetic stress-test issue
 * (evaluating sample personas HX26-S-001..008) rather than an issue for a real attendee.
 *
 * Proven by architectural tracing: every entry in stored draft.issues originates exclusively
 * from composeDrafts() rendering core/stressSet.js sample cards.
 *
 * Rules:
 * 1. Bad/malformed input (null, undefined, non-object, missing/empty code) -> treated as real (false).
 * 2. If the issue carries a personId that exists in current attendee data -> strictly real (false).
 * 3. Modern marker: issue.source === "stress-set" -> stress-set (true).
 * 4. Synthetic persona ID: personId matches /^HX26-S-00[1-8]$/ and does not exist in current data -> stress-set (true).
 * 5. Legacy untagged issues with no personId (e.g. legacy NO_PHOTO or TEXT_TRUNCATED from drafts) -> stress-set (true).
 *
 * @param {any} issue
 * @param {Array<any> | Set<string>} [currentPeople=[]]
 * @returns {boolean}
 */
export function isStressSetIssue(issue, currentPeople = []) {
  if (!issue || typeof issue !== "object") return false;
  if (typeof issue.code !== "string" || !issue.code.trim()) return false;

  const realPersonIds = extractPersonIdSet(currentPeople);

  // Extract personId if present on issue or in message text
  let personId = typeof issue.personId === "string" ? issue.personId.trim() : null;
  if (!personId && typeof issue.message === "string") {
    const match = issue.message.match(
      /^Person\s+"([^"]+)"\s+has\s+invalid\s+or\s+unrecognised\s+roleId/
    );
    if (match && match[1]) {
      personId = match[1].trim();
    }
  }

  // If the issue refers to an attendee ID present in the current dataset, it is a genuine attendee issue!
  if (personId && realPersonIds.has(personId)) {
    return false;
  }

  // 1. Explicit marker from modern composer
  if (issue.source === "stress-set") {
    return true;
  }

  // 2. Synthetic persona ID (HX26-S-001 through HX26-S-008) not in current people
  if (personId && /^HX26-S-00[1-8]$/.test(personId)) {
    return true;
  }

  // 3. Legacy untagged issue with no personId (originates from stored draft.issues render)
  if (!personId) {
    return true;
  }

  return false;
}

/**
 * Partitions draft validation issues into real attendee issues and sample-person stress test issues.
 *
 * @param {any[]} [issues=[]]
 * @param {Array<any> | Set<string>} [currentPeople=[]]
 * @returns {{ attendeeIssues: any[]; stressTestIssues: any[] }}
 */
export function partitionPreflightIssues(issues = [], currentPeople = []) {
  if (!Array.isArray(issues)) {
    return { attendeeIssues: [], stressTestIssues: [] };
  }

  const attendeeIssues = [];
  const stressTestIssues = [];

  for (const issue of issues) {
    if (isStressSetIssue(issue, currentPeople)) {
      stressTestIssues.push(issue);
    } else {
      attendeeIssues.push(issue);
    }
  }

  return { attendeeIssues, stressTestIssues };
}

/**
 * Pure evaluation helper for the preflight export gate.
 *
 * Rules:
 * - Real errors block export unconditionally.
 * - Real warnings require the acknowledgement tick.
 * - Stress-set issues (only) allow export without requiring the tick.
 *
 * @param {{
 *   attendeeIssues?: any[];
 *   acknowledgedWarnings?: boolean;
 * }} [params]
 * @returns {{
 *   canExport: boolean;
 *   hasErrors: boolean;
 *   hasWarnings: boolean;
 *   requiresAcknowledgement: boolean;
 *   reason: "READY" | "BLOCKED_ERROR" | "REQUIRES_ACK" | "ACKNOWLEDGED";
 *   errorCount: number;
 *   warningCount: number;
 * }}
 */
export function evaluateExportGate({
  attendeeIssues = [],
  acknowledgedWarnings = false,
} = {}) {
  const issues = Array.isArray(attendeeIssues) ? attendeeIssues : [];
  const errors = issues.filter((i) => i && i.severity === "error");
  const warnings = issues.filter((i) => i && i.severity === "warning");

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  if (hasErrors) {
    return {
      canExport: false,
      hasErrors: true,
      hasWarnings,
      requiresAcknowledgement: false,
      reason: "BLOCKED_ERROR",
      errorCount: errors.length,
      warningCount: warnings.length,
    };
  }

  if (hasWarnings) {
    return {
      canExport: Boolean(acknowledgedWarnings),
      hasErrors: false,
      hasWarnings: true,
      requiresAcknowledgement: !acknowledgedWarnings,
      reason: acknowledgedWarnings ? "ACKNOWLEDGED" : "REQUIRES_ACK",
      errorCount: 0,
      warningCount: warnings.length,
    };
  }

  return {
    canExport: true,
    hasErrors: false,
    hasWarnings: false,
    requiresAcknowledgement: false,
    reason: "READY",
    errorCount: 0,
    warningCount: 0,
  };
}

/**
 * Determines whether two draft objects represent the identical design template.
 * Compares seed and archetype rather than option index.
 *
 * @param {any} draftA
 * @param {any} draftB
 * @returns {boolean}
 */
export function isSameDesign(draftA, draftB) {
  if (!draftA || !draftB) return false;

  const seedA = draftA.seed || draftA.look?.seed;
  const seedB = draftB.seed || draftB.look?.seed;
  if (!seedA || !seedB || seedA !== seedB) return false;

  const archA = draftA.archetype || draftA.look?.attributes?.archetype;
  const archB = draftB.archetype || draftB.look?.attributes?.archetype;
  if (archA && archB && archA !== archB) return false;

  return true;
}

/**
 * Pure helper deciding the selection button state in DesignPreviewStep.
 *
 * States:
 * - "LOCKED": Same design AND the saved version already includes current photos -> disabled "✓ Selected (Version N)"
 * - "UPDATE_AVAILABLE": Same design BUT current project has more attendees with photos than saved version -> enabled "Save as Version N+1 (includes newly uploaded photos)"
 * - "NEW_DESIGN": Different design or fresh draft -> enabled "Select Design Option N"
 *
 * @param {{
 *   draft: any;
 *   latestVersion: any;
 *   currentPhotoCount?: number;
 *   savedPhotoCount?: number;
 *   optionIndex?: number;
 * }} params
 * @returns {{
 *   state: "LOCKED" | "UPDATE_AVAILABLE" | "NEW_DESIGN";
 *   label: string;
 *   isLocked: boolean;
 * }}
 */
export function getDesignSelectionState({
  draft,
  latestVersion,
  currentPhotoCount,
  savedPhotoCount,
  optionIndex = 0,
}) {
  const optionNum = optionIndex + 1;

  if (!draft || !latestVersion || !latestVersion.draft) {
    return {
      state: "NEW_DESIGN",
      label: `Select Design Option ${optionNum}`,
      isLocked: false,
    };
  }

  const same = isSameDesign(draft, latestVersion.draft);
  if (!same) {
    return {
      state: "NEW_DESIGN",
      label: `Select Design Option ${optionNum}`,
      isLocked: false,
    };
  }

  // Same design: check whether project has newly uploaded photos that are missing from the saved snapshot
  const hasPhotoCounts =
    typeof currentPhotoCount === "number" &&
    typeof savedPhotoCount === "number" &&
    !isNaN(currentPhotoCount) &&
    !isNaN(savedPhotoCount);

  if (hasPhotoCounts && currentPhotoCount > savedPhotoCount) {
    const nextVer = (latestVersion.versionNumber || 0) + 1;
    return {
      state: "UPDATE_AVAILABLE",
      label: `Save as Version ${nextVer} (includes newly uploaded photos)`,
      isLocked: false,
    };
  }

  return {
    state: "LOCKED",
    label: `✓ Selected (Version ${latestVersion.versionNumber || 1})`,
    isLocked: true,
  };
}
