/**
 * Programmatic cut-out command implementation
 * Handles cutting out sections from timeline elements using two-split algorithm
 */

import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { toast } from "sonner";
import type { TimelineElement } from "@/types/timeline";
import type {
  CutOutPlan,
  CutOutResult,
  ElementTarget,
  ElementCommandData,
  UpdatedElement,
} from "./types";
import {
  isValidElementForTrim,
  hasEffectiveDuration,
  getValidCutRange,
  elementToGlobalRange,
  CUT_OUT_ERROR_MESSAGES,
  EPSILON,
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
  plan: CutOutPlan,
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
 * Apply cut-out operation to a single element using two-split algorithm
 */
function applyCutOut(
  element: ElementCommandData,
  plan: CutOutPlan,
  currentTime: number,
  timeline: ReturnType<typeof useTimelineStore.getState>
): {
  updated?: UpdatedElement[];
  deleted?: ElementTarget[];
  created?: ElementTarget[];
  removedDuration?: number;
} | null {
  const options = plan.options || {};
  const precision = options.precision || 3;

  // Validate element data
  if (!isValidElementForTrim(element)) {
    console.warn("Invalid element data for cut-out:", element);
    return null;
  }

  // Check if element has effective duration
  if (!hasEffectiveDuration(element)) {
    console.warn("Element has no effective duration to cut:", element.id);
    return null;
  }

  // Get valid cut range
  const cutRange = getValidCutRange(element, plan.range, currentTime, {
    clamp: options.clamp !== false,
    precision,
  });

  if (!cutRange) {
    console.warn("Invalid or out-of-bounds cut range for element:", element.id);
    return null;
  }

  // Validate that cut duration is meaningful after precision rounding
  if (cutRange.duration <= EPSILON) {
    console.warn(
      "Cut range too small after precision rounding:",
      cutRange.duration,
      "for element:",
      element.id
    );
    return null; // Will be counted as skipped
  }

  // Convert to global timeline coordinates for splits
  const { globalStart, globalEnd } = elementToGlobalRange(
    element,
    cutRange.start,
    cutRange.end
  );

  // Skip actual operations if this is a dry run
  if (options.dryRun) {
    return {
      deleted: [{ trackId: element.trackId, elementId: element.id }],
      removedDuration: cutRange.duration,
    };
  }

  // Cut-out always uses ripple behavior to ensure remaining pieces are adjacent

  try {
    // Step 1: First split at the end of cut range to create right piece
    timeline.splitSelected(globalEnd, element.trackId, element.id);

    // Step 2: Re-fetch tracks to get updated element IDs after first split
    const updatedTimeline = useTimelineStore.getState();
    const track = updatedTimeline.tracks.find((t) => t.id === element.trackId);
    if (!track) {
      console.error("Track not found after first split");
      return null;
    }

    // Find the original element (now becomes left piece) and the newly created right piece
    const leftElement = track.elements.find((e) => e.id === element.id);
    const rightElement = track.elements.find(
      (e) => Math.abs(e.startTime - globalEnd) < EPSILON && e.id !== element.id
    );

    if (!leftElement) {
      console.error("Left element not found after first split");
      return null;
    }

    // Step 3: Second split at the start of cut range to isolate the middle piece
    timeline.splitSelected(globalStart, element.trackId, element.id);

    // Step 4: Re-fetch tracks again to get all three pieces
    const finalTimeline = useTimelineStore.getState();
    const finalTrack = finalTimeline.tracks.find(
      (t) => t.id === element.trackId
    );
    if (!finalTrack) {
      console.error("Track not found after second split");
      return null;
    }

    // Identify the middle piece (the one to delete)
    // It should start at globalStart and have duration equal to cut range
    const middleElement = finalTrack.elements.find(
      (e) => Math.abs(e.startTime - globalStart) < EPSILON
    );

    if (!middleElement) {
      console.error("Middle element not found after splits");
      return null;
    }

    // Step 5: Delete the middle piece
    // Cut-out always uses ripple deletion to close gaps and align remaining pieces
    // This ensures the left and right pieces are adjacent regardless of global ripple setting
    timeline.removeElementFromTrackWithRipple(
      element.trackId,
      middleElement.id,
      false, // Don't push history here - managed by main function
      true // Force ripple regardless of global setting
    );

    // Post-ripple snap: ensure the immediate right neighbor aligns exactly to the cut start
    // to avoid sub-frame gaps introduced by floating point rounding.
    try {
      const EPS_SNAP = 1e-3;
      const SNAP_WINDOW = 0.05; // 50ms window to catch near-neighbor start times
      const postDeleteTimeline = useTimelineStore.getState();
      const postTrack = postDeleteTimeline.tracks.find((t) => t.id === element.trackId);
      if (postTrack) {
        const elementStartTime = element.startTime;
        const neighbor = postTrack.elements
          .filter((e) => e.startTime >= elementStartTime - EPS_SNAP)
          .sort((a, b) => a.startTime - b.startTime)[0];
        if (
          neighbor &&
          neighbor.startTime > elementStartTime + EPS_SNAP &&
          neighbor.startTime - elementStartTime <= SNAP_WINDOW
        ) {
          postDeleteTimeline.updateElementStartTime(
            element.trackId,
            neighbor.id,
            elementStartTime,
            false
          );
        }
      }
    } catch {}

    // Collect results
    const result = {
      deleted: [{ trackId: element.trackId, elementId: middleElement.id }],
      removedDuration: cutRange.duration,
      updated: [] as UpdatedElement[],
      created: [] as ElementTarget[],
    };

    // Add right piece to created if it exists
    if (rightElement) {
      result.created.push({
        trackId: element.trackId,
        elementId: rightElement.id,
      });
    }

    // Original element (left piece) is updated if it still exists and was modified
    if (cutRange.start > 0) {
      const latest = useTimelineStore.getState();
      const latestTrack = latest.tracks.find((t) => t.id === element.trackId);
      const latestLeft = latestTrack?.elements.find((e) => e.id === element.id);
      if (latestLeft) {
        result.updated.push({
          trackId: element.trackId,
          elementId: element.id,
          trimStart: latestLeft.trimStart,
          trimEnd: latestLeft.trimEnd,
        });
      }
    }

    return result;
  } catch (error) {
    console.error("Error during cut-out operation:", error);
    return null;
  }
}

/**
 * Main cut-out command entry point
 */
export function cutOut({ plan }: { plan: CutOutPlan }): CutOutResult {
  // Get current state from stores
  const timeline = useTimelineStore.getState();
  const playback = usePlaybackStore.getState();
  const currentTime = playback.currentTime;

  // Resolve target elements
  const targetElements = resolveTargetElements(plan, timeline);

  if (targetElements.length === 0) {
    const error = CUT_OUT_ERROR_MESSAGES.NO_TARGETS;

    // Show toast notification unless disabled
    if (plan.options?.showToast !== false) {
      toast.error(error);
    }

    return {
      success: false,
      error,
    };
  }

  // Push history once at the start if we're going to make changes and it's not a dry run
  const shouldPushHistory =
    plan.options?.pushHistory !== false && !plan.options?.dryRun;
  if (shouldPushHistory && targetElements.length > 0) {
    timeline.pushHistory();
  }

  // Apply cut-out to each target element
  let totalUpdated: UpdatedElement[] = [];
  let totalDeleted: ElementTarget[] = [];
  let totalCreated: ElementTarget[] = [];
  let totalRemovedDuration = 0;
  let skippedCount = 0;

  for (const element of targetElements) {
    const result = applyCutOut(element, plan, currentTime, timeline);

    if (result) {
      if (result.updated) totalUpdated.push(...result.updated);
      if (result.deleted) totalDeleted.push(...result.deleted);
      if (result.created) totalCreated.push(...result.created);
      if (result.removedDuration)
        totalRemovedDuration += result.removedDuration;
    } else {
      skippedCount++;
    }
  }

  // Check if any elements were successfully processed
  const totalProcessed =
    totalUpdated.length + totalDeleted.length + totalCreated.length;
  if (totalProcessed === 0) {
    const error = CUT_OUT_ERROR_MESSAGES.NO_ELEMENTS_UPDATED;

    // Show toast notification unless disabled
    if (plan.options?.showToast !== false) {
      toast.error(error);
    }

    return {
      success: false,
      skipped: skippedCount,
      error,
    };
  }

  // Show success notification unless disabled
  if (plan.options?.showToast !== false && !plan.options?.dryRun) {
    const elementText = totalDeleted.length === 1 ? "element" : "elements";
    const durationText = totalRemovedDuration.toFixed(2);
    toast.success(
      `Cut out ${durationText}s from ${totalDeleted.length} ${elementText}`
    );
  }

  return {
    success: true,
    updated: totalUpdated.length > 0 ? totalUpdated : undefined,
    deleted: totalDeleted.length > 0 ? totalDeleted : undefined,
    created: totalCreated.length > 0 ? totalCreated : undefined,
    skipped: skippedCount > 0 ? skippedCount : undefined,
    removedDuration:
      totalRemovedDuration > 0 ? totalRemovedDuration : undefined,
  };
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Cut out a range around the current playhead position
 */
export function cutOutSelectionAroundPlayhead(
  left: number,
  right: number
): CutOutResult {
  return cutOut({
    plan: {
      type: "cut-out",
      scope: "selection",
      range: {
        mode: "aroundPlayhead",
        left,
        right,
      },
    },
  });
}

/**
 * Cut out a specific time range from an element using element-relative coordinates
 */
export function cutOutElementBySeconds(
  element: ElementTarget,
  start: number,
  end: number
): CutOutResult {
  return cutOut({
    plan: {
      type: "cut-out",
      scope: "element",
      element,
      range: {
        mode: "elementSeconds",
        start,
        end,
      },
    },
  });
}

/**
 * Cut out a range from current selection using global timeline coordinates
 * Automatically normalizes the range order to be forgiving of parameter order
 */
export function cutOutSelectionByGlobalSeconds(
  start: number,
  end: number
): CutOutResult {
  // Normalize range order to be forgiving of parameter mistakes
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);

  return cutOut({
    plan: {
      type: "cut-out",
      scope: "selection",
      range: {
        mode: "globalSeconds",
        start: normalizedStart,
        end: normalizedEnd,
      },
    },
  });
}
