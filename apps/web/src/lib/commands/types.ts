/**
 * Shared types for programmatic editing commands
 * These types define the interface between editing agents and the command execution layer
 */

// Base command result interface that all commands should implement
export interface BaseCommandResult {
  success: boolean;
  error?: string;
}

// Element targeting interfaces
export interface ElementTarget {
  trackId: string;
  elementId: string;
}

export interface UpdatedElement extends ElementTarget {
  trimStart: number;
  trimEnd: number;
}

// Common command options
export interface BaseCommandOptions {
  pushHistory?: boolean; // Whether to push to undo history (default: true)
  showToast?: boolean; // Whether to show toast notifications (default: true)
  clamp?: boolean; // Whether to clamp values to valid ranges (default: true)
  dryRun?: boolean; // Whether to simulate without applying changes (default: false)
  precision?: number; // Decimal precision for time values (default: 3)
}

// =============================================================================
// TRIM COMMAND TYPES
// =============================================================================

// Trim modes for different trimming strategies
export type TrimMode = "toSeconds" | "toPlayhead" | "deltaSeconds";

// Trim to absolute time within element's local timeline
export interface TrimSideToSeconds {
  mode: "toSeconds";
  time: number; // Absolute time in seconds from element start
}

// Trim to current playhead position
export interface TrimSideToPlayhead {
  mode: "toPlayhead";
}

// Trim by relative delta (positive = trim inward, negative = extend outward)
export interface TrimSideDelta {
  mode: "deltaSeconds";
  delta: number; // Delta in seconds to add to current trim
}

export type TrimSideSpec =
  | TrimSideToSeconds
  | TrimSideToPlayhead
  | TrimSideDelta;

// Trim command input specification
export interface TrimPlan {
  type: "trim";
  scope: "element" | "selection"; // Target specific element or current selection
  element?: ElementTarget; // Required when scope === "element"
  sides: {
    left?: TrimSideSpec; // Left/start trim specification
    right?: TrimSideSpec; // Right/end trim specification
  };
  options?: BaseCommandOptions;
}

// Trim command result
export interface TrimResult extends BaseCommandResult {
  updated: UpdatedElement[]; // Elements that were successfully updated
  skipped?: number; // Number of elements skipped (for user feedback)
}

// =============================================================================
// CUT-OUT COMMAND TYPES
// =============================================================================

// Range specification modes for cut-out operations
export type RangeMode = "elementSeconds" | "globalSeconds" | "aroundPlayhead";

// Range specification for element-local coordinates (seconds from element start)
export interface RangeSpecElementSeconds {
  mode: "elementSeconds";
  start: number; // Start time in seconds from element beginning
  end: number; // End time in seconds from element beginning
}

// Range specification for global timeline coordinates
export interface RangeSpecGlobalSeconds {
  mode: "globalSeconds";
  start: number; // Start time in global timeline seconds
  end: number; // End time in global timeline seconds
}

// Range specification relative to playhead position
export interface RangeSpecAroundPlayhead {
  mode: "aroundPlayhead";
  left: number; // Seconds to cut before playhead (positive value)
  right: number; // Seconds to cut after playhead (positive value)
}

export type RangeSpec =
  | RangeSpecElementSeconds
  | RangeSpecGlobalSeconds
  | RangeSpecAroundPlayhead;

// Cut-out command input specification
export interface CutOutPlan {
  type: "cut-out";
  scope: "element" | "selection"; // Target specific element or current selection
  element?: ElementTarget; // Required when scope === "element"
  range: RangeSpec; // Range to cut out
  options?: BaseCommandOptions & {
    ripple?: boolean; // Override global ripple setting (default: use timeline.rippleEditingEnabled)
  };
}

// Cut-out command result
export interface CutOutResult extends BaseCommandResult {
  updated?: UpdatedElement[]; // Elements that were modified (trimmed)
  deleted?: ElementTarget[]; // Elements that were completely removed
  created?: ElementTarget[]; // New elements created from splits
  skipped?: number; // Number of elements skipped (for user feedback)
  removedDuration?: number; // Total duration removed in seconds
}

// =============================================================================
// FUTURE COMMAND TYPES (to be implemented)
// =============================================================================

// Union type for all supported command plans
export type CommandPlan = TrimPlan | CutOutPlan; // | ...future commands

// Union type for all command results
export type CommandResult = TrimResult | CutOutResult; // | ...future commands

// =============================================================================
// UTILITY TYPES
// =============================================================================

// Helper type for element data needed by commands
export interface ElementCommandData {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
}

// Helper type for time-related operations
export interface TimeRange {
  start: number;
  end: number;
  duration: number;
}
