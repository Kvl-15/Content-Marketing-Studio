// @ts-check
import { Operation } from "./schemas.js";

/**
 * @module core/operations
 */

/**
 * Applies an operation to a design configuration.
 *
 * STUB: replace with real implementation
 *
 * @param {Record<string, any>} design
 * @param {unknown} op
 * @returns {Record<string, any>}
 */
export function applyOperation(design, op) {
  Operation.parse(op);
  return design;
}
