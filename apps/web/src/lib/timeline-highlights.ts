"use client";

import { useMemo, useRef } from "react";
import type { ElementTarget, CutOutPlan, TrimPlan } from "@/lib/commands/types";
import { useTimelineStore } from "@/stores/timeline-store";
import {
  HighlightEffect,
  HighlightInput,
  HighlightRange,
  useTimelineHighlightStore,
  type TimelineHighlight,
} from "@/stores/timeline-highlight-store";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";

interface HighlightDescriptor {
  trackId: string;
  elementId: string;
  range?: HighlightRange | null;
  includeAttachments?: boolean;
  ttl?: number;
  meta?: Record<string, unknown>;
  delay?: number;
}

interface ElementContext {
  track: TimelineTrack;
  element: TimelineElement;
}

function getElementContext(target: ElementTarget): ElementContext | null {
  const timeline = useTimelineStore.getState();
  const track = timeline.tracks.find((t) => t.id === target.trackId);
  if (!track) return null;
  const element = track.elements.find((el) => el.id === target.elementId);
  if (!element) return null;
  return { track, element };
}

function collectAttachmentTargets(
  ctx: ElementContext,
  seen: Set<string>
): ElementTarget[] {
  const timeline = useTimelineStore.getState();
  const attachments: ElementTarget[] = [];

  if (ctx.element.type === "media") {
    const mediaId = (ctx.element as any).mediaId as string | undefined;
    if (mediaId) {
      for (const track of timeline.tracks) {
        for (const element of track.elements) {
          if (element.id === ctx.element.id) continue;
          if (element.type !== "media") continue;
          const otherMediaId = (element as any).mediaId as string | undefined;
          if (otherMediaId && otherMediaId === mediaId) {
            const key = `${track.id}:${element.id}`;
            if (seen.has(key)) continue;
            attachments.push({ trackId: track.id, elementId: element.id });
            seen.add(key);
          }
        }
      }
    }
  }

  return attachments;
}

export function emitTimelineHighlightBatch({
  effect,
  descriptors,
  ttl,
  includeAttachments,
  meta,
  delayBetween,
}: {
  effect: HighlightEffect;
  descriptors: HighlightDescriptor[];
  ttl?: number;
  includeAttachments?: boolean;
  meta?: Record<string, unknown>;
  delayBetween?: number;
}): string[] {
  const highlightStore = useTimelineHighlightStore.getState();
  const timeline = useTimelineStore.getState();
  if (!descriptors.length || timeline.tracks.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const inputs: HighlightInput[] = [];

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    const ctx = getElementContext({
      trackId: descriptor.trackId,
      elementId: descriptor.elementId,
    });
    if (!ctx) {
      continue;
    }

    const key = `${ctx.track.id}:${ctx.element.id}`;
    const baseDelay =
      descriptor.delay ??
      (delayBetween !== undefined
        ? Math.max(0, index * delayBetween)
        : undefined);
    if (!seen.has(key)) {
      seen.add(key);
      inputs.push({
        trackId: ctx.track.id,
        elementId: ctx.element.id,
        effect,
        range: descriptor.range ?? null,
        ttl: descriptor.ttl ?? ttl,
        meta: descriptor.meta ?? meta,
        delay: baseDelay,
      });
    }

    const shouldAttach = descriptor.includeAttachments ?? includeAttachments;
    if (shouldAttach) {
      const attachmentTargets = collectAttachmentTargets(ctx, seen);
      for (const target of attachmentTargets) {
        inputs.push({
          trackId: target.trackId,
          elementId: target.elementId,
          effect,
          range: null,
          ttl: descriptor.ttl ?? ttl,
          meta: descriptor.meta ?? meta,
          delay: baseDelay,
        });
      }
    }
  }

  if (!inputs.length) return [];
  return highlightStore.pulseElements(inputs);
}

export function emitTrimHighlights({
  targets,
  includeAttachments = true,
  ttl,
  meta,
  delayBetween,
}: {
  targets: ElementTarget[];
  includeAttachments?: boolean;
  ttl?: number;
  meta?: Record<string, unknown>;
  delayBetween?: number;
}): string[] {
  const descriptors: HighlightDescriptor[] = targets.map((target) => ({
    trackId: target.trackId,
    elementId: target.elementId,
  }));
  return emitTimelineHighlightBatch({
    effect: "trim",
    descriptors,
    ttl,
    includeAttachments,
    meta,
    delayBetween,
  });
}

export function emitCutHighlights({
  items,
  includeAttachments = true,
  ttl,
  meta,
  delayBetween,
}: {
  items: Array<{
    target: ElementTarget;
    range?: HighlightRange | null;
    includeAttachments?: boolean;
    ttl?: number;
    meta?: Record<string, unknown>;
  }>;
  includeAttachments?: boolean;
  ttl?: number;
  meta?: Record<string, unknown>;
  delayBetween?: number;
}): string[] {
  const descriptors: HighlightDescriptor[] = items.map((item) => ({
    trackId: item.target.trackId,
    elementId: item.target.elementId,
    range: item.range,
    includeAttachments: item.includeAttachments,
    ttl: item.ttl,
    meta: item.meta,
  }));
  return emitTimelineHighlightBatch({
    effect: "cut",
    descriptors,
    ttl,
    includeAttachments,
    meta,
    delayBetween,
  });
}

export function emitCaptionHighlights({
  targets,
  ttl,
  meta,
}: {
  targets: ElementTarget[];
  ttl?: number;
  meta?: Record<string, unknown>;
}): string[] {
  const descriptors: HighlightDescriptor[] = targets.map((target) => ({
    trackId: target.trackId,
    elementId: target.elementId,
  }));
  return emitTimelineHighlightBatch({
    effect: "caption",
    descriptors,
    ttl,
    includeAttachments: false,
    meta,
  });
}

export function getTargetsFromPlan(
  plan: TrimPlan | CutOutPlan
): ElementTarget[] {
  if (plan.scope === "element" && plan.element) {
    return [plan.element];
  }

  if (plan.scope === "selection") {
    const timeline = useTimelineStore.getState();
    return timeline.selectedElements.slice();
  }

  return [];
}

export function useElementHighlights(trackId: string, elementId: string) {
  const cacheRef = useRef<{
    ids: string[];
    result: TimelineHighlight[];
  } | null>(null);

  return useTimelineHighlightStore((state) => {
    const filtered = state.active.filter(
      (entry) => entry.trackId === trackId && entry.elementId === elementId
    );

    const previous = cacheRef.current;
    if (previous && previous.ids.length === filtered.length) {
      let same = true;
      for (let i = 0; i < filtered.length; i += 1) {
        if (filtered[i].id !== previous.ids[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        return previous.result;
      }
    }

    cacheRef.current = {
      ids: filtered.map((entry) => entry.id),
      result: filtered,
    };
    return filtered;
  });
}
