/**
 * Programmatic trim command implementation
 * Handles trimming of timeline elements based on various trim specifications
 */

import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { toast } from "sonner";
import type { TimelineElement } from "@/types/timeline";
import type {
  TrimPlan,
  TrimResult,
  ElementTarget,
  ElementCommandData,
  UpdatedElement,
} from "./types";
import {
  isValidElementForTrim,
  hasEffectiveDuration,
  computeLeftTrim,
  computeRightTrim,
  validateTrimBounds,
  TRIM_ERROR_MESSAGES,
} from "./utils";

/**
 * Convert V4 TimelineElement to ElementCommandData for command operations
 */
function convertToElementCommandData(
  element: TimelineElement,
  trackId: string
): ElementCommandData {
  return {
    id: element.id,
    trackId,
    startTime: element.startTime,
    duration: element.duration,
    trimStart: element.trimStart,
    trimEnd: element.trimEnd,
  };
}

/**
 * Resolve target elements based on scope specification
 */
function resolveTargetElements(
  plan: TrimPlan,
  timeline: ReturnType<typeof useTimelineStore.getState>
): ElementCommandData[] {
  const elements: ElementCommandData[] = [];

  if (plan.scope === "element" && plan.element) {
    // Target specific element
    const track = timeline.tracks.find((t) => t.id === plan.element!.trackId);
    if (track) {
      const element = track.elements.find(
        (e) => e.id === plan.element!.elementId
      );
      if (element) {
        elements.push(convertToElementCommandData(element, track.id));
      }
    }
  } else if (plan.scope === "selection") {
    // Target selected elements
    for (const selection of timeline.selectedElements) {
      const track = timeline.tracks.find((t) => t.id === selection.trackId);
      if (track) {
        const element = track.elements.find(
          (e) => e.id === selection.elementId
        );
        if (element) {
          elements.push(convertToElementCommandData(element, track.id));
        }
      }
    }
  }

  return elements;
}

/**
 * Apply trim operation to a single element
 */
function applyElementTrim(
  element: ElementCommandData,
  plan: TrimPlan,
  currentTime: number,
  timeline: ReturnType<typeof useTimelineStore.getState>
): UpdatedElement | null {
  const options = plan.options || {};
  const clampEnabled = options.clamp !== false;
  const precision = options.precision || 3;

  // Validate element data
  if (!isValidElementForTrim(element)) {
    console.warn("Invalid element data for trim:", element);
    return null;
  }

  // Check if element has effective duration
  if (!hasEffectiveDuration(element)) {
    console.warn("Element has no effective duration to trim:", element.id);
    return null;
  }

  let newTrimStart = element.trimStart;
  let newTrimEnd = element.trimEnd;

  // Compute left trim if specified
  if (plan.sides.left) {
    const leftResult = computeLeftTrim({
      side: plan.sides.left,
      element,
      currentTime,
      clampEnabled,
      precision,
    });

    if (leftResult === null) {
      console.warn("Failed to compute left trim for element:", element.id);
      return null;
    }

    newTrimStart = leftResult;
  }

  // Compute right trim if specified (use updated left trim for bounds checking)
  if (plan.sides.right) {
    const elementWithUpdatedLeft = { ...element, trimStart: newTrimStart };
    const rightResult = computeRightTrim({
      side: plan.sides.right,
      element: elementWithUpdatedLeft,
      currentTime,
      clampEnabled,
      precision,
    });

    if (rightResult === null) {
      console.warn("Failed to compute right trim for element:", element.id);
      return null;
    }

    newTrimEnd = rightResult;
  }

  // Validate final trim bounds
  const validation = validateTrimBounds(element, newTrimStart, newTrimEnd);
  if (!validation.valid) {
    if (clampEnabled) {
      // Use adjusted values if clamping is enabled
      newTrimStart = validation.adjustedStart;
      newTrimEnd = validation.adjustedEnd;
    } else {
      console.warn("Trim values exceed element duration:", element.id);
      return null;
    }
  }

  // Skip actual application if this is a dry run
  if (!options.dryRun) {
    // Apply the trim via timeline store (history is managed by main function)
    timeline.updateElementTrim(
      element.trackId,
      element.id,
      newTrimStart,
      newTrimEnd,
      false // Don't push history here - managed by main function
    );
  }

  return {
    trackId: element.trackId,
    elementId: element.id,
    trimStart: newTrimStart,
    trimEnd: newTrimEnd,
  };
}

/**
 * Main trim command entry point
 */
export function trim({ plan }: { plan: TrimPlan }): TrimResult {
  // Get current state from stores
  const timeline = useTimelineStore.getState();
  const playback = usePlaybackStore.getState();
  const currentTime = playback.currentTime;

  // Resolve target elements
  const targetElements = resolveTargetElements(plan, timeline);

  if (targetElements.length === 0) {
    const error = TRIM_ERROR_MESSAGES.NO_TARGETS;

    // Show toast notification unless disabled
    if (plan.options?.showToast !== false) {
      toast.error(error);
    }

    return {
      success: false,
      updated: [],
      error,
    };
  }

  // Push history once at the start if we're going to make changes and it's not a dry run
  const shouldPushHistory =
    plan.options?.pushHistory !== false && !plan.options?.dryRun;
  if (shouldPushHistory && targetElements.length > 0) {
    timeline.pushHistory();
  }

  // Apply trim to each target element
  const updated: UpdatedElement[] = [];
  let skippedCount = 0;

  for (const element of targetElements) {
    const result = applyElementTrim(element, plan, currentTime, timeline);

    if (result) {
      updated.push(result);
    } else {
      skippedCount++;
    }
  }

  // Check if any elements were successfully updated
  if (updated.length === 0) {
    const error = TRIM_ERROR_MESSAGES.NO_ELEMENTS_UPDATED;

    // Show toast notification unless disabled
    if (plan.options?.showToast !== false) {
      toast.error(error);
    }

    return {
      success: false,
      updated: [],
      skipped: skippedCount,
      error,
    };
  }

  // Show success notification unless disabled
  if (plan.options?.showToast !== false && !plan.options?.dryRun) {
    const elementText = updated.length === 1 ? "element" : "elements";
    toast.success(`Successfully trimmed ${updated.length} ${elementText}`);
  }

  return {
    success: true,
    updated,
    skipped: skippedCount > 0 ? skippedCount : undefined,
  };
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Trim current selection to playhead position (left side)
 */
export function trimSelectionToPlayheadLeft(): TrimResult {
  return trim({
    plan: {
      type: "trim",
      scope: "selection",
      sides: {
        left: { mode: "toPlayhead" },
      },
    },
  });
}

/**
 * Trim current selection to playhead position (right side)
 */
export function trimSelectionToPlayheadRight(): TrimResult {
  return trim({
    plan: {
      type: "trim",
      scope: "selection",
      sides: {
        right: { mode: "toPlayhead" },
      },
    },
  });
}

/**
 * Trim specific element by delta amounts
 */
export function trimElementByDelta(
  elementTarget: ElementTarget,
  leftDelta?: number,
  rightDelta?: number
): TrimResult {
  const sides: TrimPlan["sides"] = {};

  if (leftDelta !== undefined) {
    sides.left = { mode: "deltaSeconds", delta: leftDelta };
  }

  if (rightDelta !== undefined) {
    sides.right = { mode: "deltaSeconds", delta: rightDelta };
  }

  return trim({
    plan: {
      type: "trim",
      scope: "element",
      element: elementTarget,
      sides,
    },
  });
}
