/**
 * Utility functions for programmatic editing commands
 * Pure functions for calculations, validation, and data transformation
 */

import type {
  TrimSideSpec,
  ElementCommandData,
  TimeRange,
  RangeSpec,
} from "./types";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Floating point comparison tolerance for timeline operations
 * Used to handle precision issues when comparing times and positions
 */
export const EPSILON = 0.001;

// =============================================================================
// MATH UTILITIES
// =============================================================================

/**
 * Clamp a number to a specific range
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Check if a number is within a valid range (inclusive)
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Round a number to a specific number of decimal places
 */
export function roundToPrecision(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// =============================================================================
// ELEMENT VALIDATION
// =============================================================================

/**
 * Validate that an element has the minimum required data for trim operations
 */
export function isValidElementForTrim(
  element: Partial<ElementCommandData>
): element is ElementCommandData {
  return (
    typeof element.id === "string" &&
    typeof element.trackId === "string" &&
    typeof element.startTime === "number" &&
    typeof element.duration === "number" &&
    typeof element.trimStart === "number" &&
    typeof element.trimEnd === "number" &&
    element.duration > 0
  );
}

/**
 * Check if an element has any effective duration (not completely trimmed)
 */
export function hasEffectiveDuration(element: ElementCommandData): boolean {
  const effectiveDuration =
    element.duration - element.trimStart - element.trimEnd;
  return effectiveDuration > 0;
}

/**
 * Calculate the effective duration of an element after trimming
 */
export function getEffectiveDuration(element: ElementCommandData): number {
  return Math.max(0, element.duration - element.trimStart - element.trimEnd);
}

/**
 * Calculate the effective time range of an element (global timeline position)
 */
export function getEffectiveTimeRange(element: ElementCommandData): TimeRange {
  const effectiveDuration = getEffectiveDuration(element);
  return {
    start: element.startTime,
    end: element.startTime + effectiveDuration,
    duration: effectiveDuration,
  };
}

// =============================================================================
// TRIM CALCULATIONS
// =============================================================================

/**
 * Parameters for trim calculations
 */
interface TrimCalculationParams {
  side: TrimSideSpec;
  element: ElementCommandData;
  currentTime: number;
  clampEnabled: boolean;
  precision?: number;
}

/**
 * Compute new left trim value based on trim specification
 */
export function computeLeftTrim(params: TrimCalculationParams): number | null {
  const { side, element, currentTime, clampEnabled, precision = 3 } = params;
  const { startTime, duration, trimStart, trimEnd } = element;

  // Maximum allowed left trim (must leave room for right trim)
  const maxLeftTrim = duration - trimEnd;

  let newTrimStart: number;

  switch (side.mode) {
    case "toSeconds": {
      // Trim to absolute time within element's timeline
      newTrimStart = side.time;
      break;
    }

    case "toPlayhead": {
      // Trim to current playhead position
      const relativeTime = currentTime - startTime;

      // If clamping is disabled, check if playhead is within element bounds
      if (!clampEnabled && !isPlayheadInElement(element, currentTime)) {
        return null; // Skip element if playhead is outside bounds
      }

      newTrimStart = relativeTime;
      break;
    }

    case "deltaSeconds": {
      // Trim by relative delta
      newTrimStart = trimStart + side.delta;
      break;
    }

    default: {
      return null;
    }
  }

  // Apply bounds checking if clamping is enabled
  if (clampEnabled) {
    newTrimStart = clamp(newTrimStart, 0, maxLeftTrim);
  } else if (!isInRange(newTrimStart, 0, maxLeftTrim)) {
    // If clamping is disabled and value is out of bounds, return null to skip
    return null;
  }

  return roundToPrecision(newTrimStart, precision);
}

/**
 * Compute new right trim value based on trim specification
 */
export function computeRightTrim(params: TrimCalculationParams): number | null {
  const { side, element, currentTime, clampEnabled, precision = 3 } = params;
  const { startTime, duration, trimStart, trimEnd } = element;

  // Maximum allowed right trim (must leave room for left trim)
  const maxRightTrim = duration - trimStart;

  let newTrimEnd: number;

  switch (side.mode) {
    case "toSeconds": {
      // Trim to absolute time within element's timeline (convert to trim from end)
      newTrimEnd = duration - side.time;
      break;
    }

    case "toPlayhead": {
      // Trim to current playhead position (convert to trim from end)
      const relativeTime = currentTime - startTime;

      // If clamping is disabled, check if playhead is within element bounds
      if (!clampEnabled && !isPlayheadInElement(element, currentTime)) {
        return null; // Skip element if playhead is outside bounds
      }

      newTrimEnd = duration - relativeTime;
      break;
    }

    case "deltaSeconds": {
      // Trim by relative delta
      newTrimEnd = trimEnd + side.delta;
      break;
    }

    default: {
      return null;
    }
  }

  // Apply bounds checking if clamping is enabled
  if (clampEnabled) {
    newTrimEnd = clamp(newTrimEnd, 0, maxRightTrim);
  } else if (!isInRange(newTrimEnd, 0, maxRightTrim)) {
    // If clamping is disabled and value is out of bounds, return null to skip
    return null;
  }

  return roundToPrecision(newTrimEnd, precision);
}

/**
 * Validate that trim values don't exceed element duration
 */
export function validateTrimBounds(
  element: ElementCommandData,
  newTrimStart: number,
  newTrimEnd: number
): { valid: boolean; adjustedStart: number; adjustedEnd: number } {
  const { duration } = element;
  const totalTrim = newTrimStart + newTrimEnd;

  // If total trim exceeds duration, we need to adjust
  if (totalTrim > duration) {
    const overflow = totalTrim - duration;
    const halfOverflow = overflow / 2;

    return {
      valid: false,
      adjustedStart: Math.max(0, newTrimStart - halfOverflow),
      adjustedEnd: Math.max(0, newTrimEnd - halfOverflow),
    };
  }

  return {
    valid: true,
    adjustedStart: newTrimStart,
    adjustedEnd: newTrimEnd,
  };
}

// =============================================================================
// PLAYHEAD UTILITIES
// =============================================================================

/**
 * Check if playhead is within element's effective time range
 */
export function isPlayheadInElement(
  element: ElementCommandData,
  currentTime: number
): boolean {
  const timeRange = getEffectiveTimeRange(element);
  return currentTime >= timeRange.start && currentTime <= timeRange.end;
}

/**
 * Convert global timeline time to element-relative time
 */
export function globalToElementTime(
  element: ElementCommandData,
  globalTime: number
): number {
  return globalTime - element.startTime;
}

/**
 * Convert element-relative time to global timeline time
 */
export function elementToGlobalTime(
  element: ElementCommandData,
  elementTime: number
): number {
  return element.startTime + elementTime;
}

// =============================================================================
// ERROR MESSAGES
// =============================================================================

export const TRIM_ERROR_MESSAGES = {
  NO_TARGETS: "No target elements resolved",
  NO_ELEMENTS_UPDATED: "No elements were updated",
  INVALID_ELEMENT: "Element data is invalid or incomplete",
  NO_EFFECTIVE_DURATION: "Element has no effective duration to trim",
  PLAYHEAD_OUT_OF_RANGE: "Playhead is outside element bounds",
  INVALID_TRIM_VALUES: "Trim values would exceed element duration",
} as const;

// =============================================================================
// CUT-OUT UTILITIES
// =============================================================================

/**
 * Convert any RangeSpec to element-relative coordinates (seconds from element start)
 */
export function normalizeRangeToElement(
  element: ElementCommandData,
  range: RangeSpec,
  currentTime: number,
  options: { clamp?: boolean; precision?: number } = {}
): { start: number; end: number } | null {
  const { clamp = true, precision = 3 } = options;
  const { startTime } = element;

  let start: number;
  let end: number;

  switch (range.mode) {
    case "elementSeconds": {
      start = range.start;
      end = range.end;
      break;
    }

    case "globalSeconds": {
      start = range.start - startTime;
      end = range.end - startTime;
      break;
    }

    case "aroundPlayhead": {
      const playheadRelative = currentTime - startTime;
      start = playheadRelative - range.left;
      end = playheadRelative + range.right;
      break;
    }

    default: {
      return null;
    }
  }

  // Validate range order
  if (!isValidRange(start, end)) {
    return null;
  }

  // Apply precision rounding
  start = roundToPrecision(start, precision);
  end = roundToPrecision(end, precision);

  // Handle bounds checking
  const effectiveDuration = getEffectiveDuration(element);
  if (clamp) {
    start = Math.max(0, Math.min(start, effectiveDuration));
    end = Math.max(start, Math.min(end, effectiveDuration));

    // Check if clamped range is still valid
    if (!isValidRange(start, end)) {
      return null;
    }
  } else {
    // Strict bounds checking - range must be within element
    if (start < 0 || end > effectiveDuration || start >= end) {
      return null;
    }
  }

  return { start, end };
}

/**
 * Intersect cut range with element's effective range
 */
export function intersectWithEffectiveRange(
  element: ElementCommandData,
  start: number,
  end: number,
  clampEnabled: boolean
): { start: number; end: number } | null {
  const effectiveDuration = getEffectiveDuration(element);

  if (clampEnabled) {
    const clampedStart = Math.max(0, Math.min(start, effectiveDuration));
    const clampedEnd = Math.max(clampedStart, Math.min(end, effectiveDuration));

    // Return null if range collapses after clamping
    if (clampedStart >= clampedEnd) {
      return null;
    }

    return { start: clampedStart, end: clampedEnd };
  }

  // Strict intersection - range must be fully within bounds
  if (start < 0 || end > effectiveDuration || start >= end) {
    return null;
  }

  return { start, end };
}

/**
 * Validate that a range has positive duration
 */
export function isValidRange(start: number, end: number): boolean {
  return end > start && isFinite(start) && isFinite(end);
}

/**
 * Calculate the actual cut range within an element after all validations
 */
export function getValidCutRange(
  element: ElementCommandData,
  range: RangeSpec,
  currentTime: number,
  options: { clamp?: boolean; precision?: number } = {}
): { start: number; end: number; duration: number } | null {
  // First normalize to element coordinates
  const normalized = normalizeRangeToElement(
    element,
    range,
    currentTime,
    options
  );
  if (!normalized) {
    return null;
  }

  // Then intersect with effective range
  const intersected = intersectWithEffectiveRange(
    element,
    normalized.start,
    normalized.end,
    options.clamp !== false
  );
  if (!intersected) {
    return null;
  }

  return {
    start: intersected.start,
    end: intersected.end,
    duration: intersected.end - intersected.start,
  };
}

/**
 * Convert element-relative time to global timeline time
 */
export function elementToGlobalRange(
  element: ElementCommandData,
  start: number,
  end: number
): { globalStart: number; globalEnd: number } {
  return {
    globalStart: element.startTime + start,
    globalEnd: element.startTime + end,
  };
}

// Cut-out specific error messages
export const CUT_OUT_ERROR_MESSAGES = {
  NO_TARGETS: "No target elements resolved",
  NO_ELEMENTS_UPDATED: "No elements were updated",
  INVALID_RANGE: "Cut range is invalid or has zero duration",
  OUT_OF_BOUNDS: "Cut range is outside element bounds",
  RANGE_TOO_SMALL: "Cut range is too small after precision rounding",
  ELEMENT_TOO_SHORT: "Element is too short to perform cut operation",
} as const;
