/**
 * Programmatic editing commands
 * Entry point for all command operations
 */

// Main command functions
export {
  trim,
  trimSelectionToPlayheadLeft,
  trimSelectionToPlayheadRight,
  trimElementByDelta,
} from "./trim";

export {
  cutOut,
  cutOutSelectionAroundPlayhead,
  cutOutElementBySeconds,
  cutOutSelectionByGlobalSeconds,
} from "./cut-out";

// Types for external usage
export type {
  // Base types
  BaseCommandResult,
  ElementTarget,
  UpdatedElement,
  BaseCommandOptions,
  CommandPlan,
  CommandResult,
  // Trim-specific types
  TrimMode,
  TrimSideSpec,
  TrimSideToSeconds,
  TrimSideToPlayhead,
  TrimSideDelta,
  TrimPlan,
  TrimResult,
  // Cut-out-specific types
  RangeMode,
  RangeSpec,
  RangeSpecElementSeconds,
  RangeSpecGlobalSeconds,
  RangeSpecAroundPlayhead,
  CutOutPlan,
  CutOutResult,
  // Utility types
  ElementCommandData,
  TimeRange,
} from "./types";

// Utility functions (for advanced usage)
export {
  clamp,
  isInRange,
  roundToPrecision,
  isValidElementForTrim,
  hasEffectiveDuration,
  getEffectiveDuration,
  getEffectiveTimeRange,
  computeLeftTrim,
  computeRightTrim,
  validateTrimBounds,
  isPlayheadInElement,
  globalToElementTime,
  elementToGlobalTime,
  TRIM_ERROR_MESSAGES,
  // Cut-out utilities
  normalizeRangeToElement,
  intersectWithEffectiveRange,
  isValidRange,
  getValidCutRange,
  elementToGlobalRange,
  CUT_OUT_ERROR_MESSAGES,
  // Constants
  EPSILON,
} from "./utils";
