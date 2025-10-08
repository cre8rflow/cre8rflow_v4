/**
 * Client-side target resolver for the agentic edit system
 * Converts abstract TargetSpec into concrete ElementTarget[] from timeline store
 */

import type { TargetSpec, TrackFilter } from "@/types/agent";
import type { TimelineTrack } from "@/types/timeline";
import type { ElementTarget } from "@/lib/commands/types";
import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get current tracks from timeline store
 */
function getTracks(): TimelineTrack[] {
  return useTimelineStore.getState().tracks;
}

/**
 * Filter tracks based on TrackFilter specification
 */
function filterTracks({
  tracks,
  filter,
}: {
  tracks: TimelineTrack[];
  filter?: TrackFilter;
}): TimelineTrack[] {
  if (!filter || filter === "all") {
    return tracks;
  }

  if (typeof filter === "object" && "id" in filter) {
    return tracks.filter((t) => t.id === filter.id);
  }

  return tracks.filter((t) => t.type === filter);
}

/**
 * Calculate the effective end time of an element (considering trims)
 */
function effectiveEnd(element: TimelineTrack["elements"][number]): number {
  return (
    element.startTime + (element.duration - element.trimStart - element.trimEnd)
  );
}

/**
 * Calculate the effective start time of an element (considering trims)
 */
function effectiveStart(element: TimelineTrack["elements"][number]): number {
  return element.startTime;
}

/**
 * Check if a time point is within an element's effective range
 */
function isTimeInElement(
  time: number,
  element: TimelineTrack["elements"][number]
): boolean {
  const start = effectiveStart(element);
  const end = effectiveEnd(element);
  return time >= start && time < end;
}

/**
 * Check if a time range overlaps with an element's effective range
 */
function rangeOverlapsElement(
  rangeStart: number,
  rangeEnd: number,
  element: TimelineTrack["elements"][number]
): boolean {
  const elementStart = effectiveStart(element);
  const elementEnd = effectiveEnd(element);

  // No overlap if range ends before element starts or range starts after element ends
  return !(rangeEnd <= elementStart || rangeStart >= elementEnd);
}

// =============================================================================
// MAIN RESOLVER FUNCTION
// =============================================================================

/**
 * Resolve abstract TargetSpec into concrete ElementTarget array
 * This is the main entry point for target resolution
 */
export function resolveTargets(target: TargetSpec): ElementTarget[] {
  const tracks = getTracks();

  // Extract track filter safely using discriminated union
  const withFilter = "track" in target ? target.track : undefined;
  const filteredTracks = filterTracks({ tracks, filter: withFilter });

  let rawTargets: ElementTarget[];

  switch (target.kind) {
    case "clipAtPlayhead":
      rawTargets = resolveClipAtPlayhead(filteredTracks);
      break;

    case "clipAtTime":
      rawTargets = resolveClipAtTime({
        tracks: filteredTracks,
        time: target.time,
      });
      break;

    case "lastClip":
      rawTargets = resolveLastClip({
        tracks: filteredTracks,
        filter: withFilter,
      });
      break;

    case "nthClip":
      rawTargets = resolveNthClip({
        tracks: filteredTracks,
        index: target.index,
      });
      break;

    case "clipsOverlappingRange":
      rawTargets = resolveClipsOverlappingRange({
        tracks: filteredTracks,
        start: target.start,
        end: target.end,
      });
      break;

    default: {
      // Exhaustive check - this should never happen with proper typing
      const _exhaustive: never = target;
      console.warn("Unknown target kind");
      rawTargets = [];
    }
  }

  // Apply deduplication and deterministic sorting
  return dedupeAndSortTargets(rawTargets);
}

// =============================================================================
// TARGET RESOLUTION IMPLEMENTATIONS
// =============================================================================

/**
 * Find elements at current playhead position
 */
function resolveClipAtPlayhead(tracks: TimelineTrack[]): ElementTarget[] {
  const currentTime = usePlaybackStore.getState().currentTime;
  const hits: ElementTarget[] = [];

  for (const track of tracks) {
    for (const element of track.elements) {
      if (isTimeInElement(currentTime, element)) {
        hits.push({ trackId: track.id, elementId: element.id });
      }
    }
  }

  return hits;
}

/**
 * Find elements at specific time
 */
function resolveClipAtTime({
  tracks,
  time,
}: {
  tracks: TimelineTrack[];
  time: number;
}): ElementTarget[] {
  const hits: ElementTarget[] = [];

  for (const track of tracks) {
    for (const element of track.elements) {
      if (isTimeInElement(time, element)) {
        hits.push({ trackId: track.id, elementId: element.id });
      }
    }
  }

  return hits;
}

/**
 * Find the last clip by start time
 * Prefers media tracks if no specific filter is provided
 */
function resolveLastClip({
  tracks,
  filter,
}: {
  tracks: TimelineTrack[];
  filter?: TrackFilter;
}): ElementTarget[] {
  // If no filter provided, prefer media tracks for better UX
  let candidateTracks = tracks;
  if (!filter) {
    const mediaTracks = tracks.filter((t) => t.type === "media");
    candidateTracks = mediaTracks.length > 0 ? mediaTracks : tracks;
  }

  let lastElement: ElementTarget | null = null;
  let maxStartTime = -Infinity;

  for (const track of candidateTracks) {
    for (const element of track.elements) {
      if (element.startTime > maxStartTime) {
        maxStartTime = element.startTime;
        lastElement = { trackId: track.id, elementId: element.id };
      }
    }
  }

  return lastElement ? [lastElement] : [];
}

/**
 * Find nth clip chronologically (1-based indexing)
 */
function resolveNthClip({
  tracks,
  index,
}: {
  tracks: TimelineTrack[];
  index: number;
}): ElementTarget[] {
  // Collect all elements with their track info and sort by start time
  const allElements = tracks
    .flatMap((track) =>
      track.elements.map((element) => ({
        trackId: track.id,
        element,
      }))
    )
    .sort((a, b) => a.element.startTime - b.element.startTime);

  // Convert to 0-based index
  const arrayIndex = index - 1;

  if (arrayIndex >= 0 && arrayIndex < allElements.length) {
    const target = allElements[arrayIndex];
    return [{ trackId: target.trackId, elementId: target.element.id }];
  }

  return [];
}

/**
 * Find clips overlapping with specified time range
 */
function resolveClipsOverlappingRange({
  tracks,
  start,
  end,
}: {
  tracks: TimelineTrack[];
  start: number;
  end: number;
}): ElementTarget[] {
  const hits: ElementTarget[] = [];
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);

  for (const track of tracks) {
    for (const element of track.elements) {
      if (rangeOverlapsElement(rangeStart, rangeEnd, element)) {
        hits.push({ trackId: track.id, elementId: element.id });
      }
    }
  }

  return hits;
}

// =============================================================================
// TARGET POST-PROCESSING UTILITIES
// =============================================================================

/**
 * Remove duplicate targets and sort deterministically by start time
 */
export function dedupeAndSortTargets(
  targets: ElementTarget[]
): ElementTarget[] {
  if (targets.length === 0) return targets;

  const tracks = getTracks();
  const seenIds = new Set<string>();
  const uniqueTargets: ElementTarget[] = [];

  // Remove duplicates
  for (const target of targets) {
    const uniqueId = `${target.trackId}:${target.elementId}`;
    if (!seenIds.has(uniqueId)) {
      seenIds.add(uniqueId);
      uniqueTargets.push(target);
    }
  }

  // Sort by start time for deterministic ordering
  uniqueTargets.sort((a, b) => {
    const trackA = tracks.find((t) => t.id === a.trackId);
    const trackB = tracks.find((t) => t.id === b.trackId);
    const elementA = trackA?.elements.find((e) => e.id === a.elementId);
    const elementB = trackB?.elements.find((e) => e.id === b.elementId);

    // If elements not found, sort by IDs for consistency
    if (!elementA || !elementB) {
      return a.elementId.localeCompare(b.elementId);
    }

    // Primary sort: by start time
    const startTimeDiff = elementA.startTime - elementB.startTime;
    if (startTimeDiff !== 0) return startTimeDiff;

    // Secondary sort: by element ID for deterministic ordering
    return a.elementId.localeCompare(b.elementId);
  });

  return uniqueTargets;
}

// =============================================================================
// UTILITY FUNCTIONS FOR DEBUGGING/TESTING
// =============================================================================

/**
 * Debug utility to get human-readable description of targets
 */
export function describeTargets(targets: ElementTarget[]): string[] {
  const tracks = getTracks();
  const descriptions: string[] = [];

  for (const target of targets) {
    const track = tracks.find((t) => t.id === target.trackId);
    const element = track?.elements.find((e) => e.id === target.elementId);

    if (track && element) {
      // Guard against undefined names with fallback to IDs
      const trackName = track.name ?? track.id;
      const elementName = element.name ?? element.id;

      const startTime = element.startTime.toFixed(2);
      const duration = (
        element.duration -
        element.trimStart -
        element.trimEnd
      ).toFixed(2);
      descriptions.push(
        `${trackName}[${track.type}]: "${elementName}" at ${startTime}s (${duration}s)`
      );
    } else {
      descriptions.push(
        `Invalid target: ${target.trackId}/${target.elementId}`
      );
    }
  }

  return descriptions;
}

/**
 * Debug utility to describe a target spec without resolving it
 */
export function describeTargetSpec(spec: TargetSpec): string {
  switch (spec.kind) {
    case "clipAtPlayhead":
      return "clip at current playhead position";

    case "clipAtTime":
      return `clip at time ${spec.time}s`;

    case "lastClip": {
      const trackFilter = spec.track
        ? ` on ${JSON.stringify(spec.track)} tracks`
        : "";
      return `last clip${trackFilter}`;
    }

    case "nthClip": {
      const nthTrackFilter = spec.track
        ? ` on ${JSON.stringify(spec.track)} tracks`
        : "";
      return `${spec.index}${getOrdinalSuffix(spec.index)} clip${nthTrackFilter}`;
    }

    case "clipsOverlappingRange": {
      const rangeTrackFilter = spec.track
        ? ` on ${JSON.stringify(spec.track)} tracks`
        : "";
      return `clips overlapping ${spec.start}s-${spec.end}s${rangeTrackFilter}`;
    }

    default:
      return "unknown target spec";
  }
}

/**
 * Helper to get ordinal suffix for numbers (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
