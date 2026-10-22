// @ts-check
/**
 * @module core
 * Main entry point for the core engine.
 */

export * from "./schemas.js";
export { renderCard } from "./render.js";
export { validate, LINE_HEIGHT } from "./validate.js";
export { autofix } from "./autofix.js";
export { applyOperation } from "./operations.js";
export {
  pickThree,
  distance,
  WEIGHTS,
  MIN_PAIR_DISTANCE,
  getCombinations,
  groupKey,
  scoreGroup,
  meetsMinPairDistance,
  filterEligible,
  createDefaultRunStress,
  draftsFor,
} from "./picker.js";
export * from "./stressSet.js";
export { measure, wrap, fitText, PT_TO_MM } from "./text.js";
export {
  deriveTheme,
  isPaletteCompatible,
  ensureContrast,
  DEFAULT_PALETTE,
  deriveRoleColor,
  DEFAULT_ROLE_LIGHTNESS,
  DEFAULT_ROLE_LIGHTNESS_STEPS,
} from "./themeDerivation.js";
export {
  compose,
  composeDrafts,
  scoreQuality,
  ARCHETYPES,
  createPrng,
  hashSeed,
} from "./composer.js";
export * from "./exportSettings.js";
export * from "./sheet.js";
