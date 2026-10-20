// @ts-check
/**
 * @module server/intake
 * Pure intake module for EventSpec scaffold, gap analysis, question bank,
 * answer application, and locking (KB Part 7).
 */

export { emptySpec } from "./emptySpec.js";
export { findGaps, isValidCalendarDate } from "./gaps.js";
export { nextQuestions, QUESTION_BANK } from "./questions.js";
export {
  applyAnswer,
  hexLightness,
  hslToHex,
  defaultRoleColor,
  slugify,
} from "./applyAnswer.js";
export { lockSpec } from "./lockSpec.js";
