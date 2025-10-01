"use client";

import { create } from "zustand";
import { generateUUID } from "@/lib/utils";

const DEFAULT_HIGHLIGHT_TTL = 2600; // milliseconds

export type HighlightEffect =
  | "trim"
  | "cut"
  | "caption"
  | "deadspace"
  | "analysis"
  | "generic";

export type HighlightRangeMode = "element" | "timeline";

export interface HighlightRange {
  /**
   * Inclusive start time for the animation sweep.
   * When mode === "element", the value is in element-local seconds.
   * When mode === "timeline", the value is global timeline seconds.
   */
  start: number;
  /**
   * Exclusive end time for the animation sweep.
   * Aligns with the same coordinate system as `start`.
   */
  end: number;
  mode: HighlightRangeMode;
}

export interface HighlightInput {
  trackId: string;
  elementId: string;
  effect?: HighlightEffect;
  range?: HighlightRange | null;
  meta?: Record<string, unknown>;
  ttl?: number;
  delay?: number;
}

export interface TimelineHighlight extends HighlightInput {
  id: string;
  effect: HighlightEffect;
  createdAt: number;
  expiresAt: number;
}

interface TimelineHighlightState {
  active: TimelineHighlight[];
  /**
   * Add highlight entries for a set of timeline elements. Existing entries with the same
   * (trackId, elementId, effect) tuple are replaced so repeated pulses retrigger animations.
   */
  addHighlights: (
    inputs: HighlightInput[],
    opts?: { ttl?: number }
  ) => string[];
  /**
   * Convenience helper to pulse elements with default options.
   */
  pulseElements: (
    inputs: HighlightInput[],
    opts?: { ttl?: number }
  ) => string[];
  removeHighlightById: (id: string) => void;
  removeHighlightsForElement: (
    trackId: string,
    elementId: string,
    effect?: HighlightEffect
  ) => void;
  clearByEffect: (effect: HighlightEffect) => void;
  clearExpired: () => void;
  clearAll: () => void;
}

const highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();
const highlightDelayTimers = new Map<string, ReturnType<typeof setTimeout>>();

const scheduleExpiry = (
  id: string,
  ttl: number,
  clear: (id: string) => void
) => {
  if (highlightTimers.has(id)) {
    const existing = highlightTimers.get(id);
    if (existing) clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    clear(id);
  }, ttl);
  highlightTimers.set(id, timer);
};

const cancelTimer = (id: string) => {
  const timer = highlightTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    highlightTimers.delete(id);
  }
};

const cancelDelayTimer = (id: string) => {
  const timer = highlightDelayTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    highlightDelayTimers.delete(id);
  }
};

export const useTimelineHighlightStore = create<TimelineHighlightState>()(
  (set, get) => ({
    active: [],

    addHighlights: (inputs, opts) => {
      if (!inputs.length) return [];

      const ttl = opts?.ttl ?? DEFAULT_HIGHLIGHT_TTL;
      const now = Date.now();

      const removeById = (id: string) => {
        set((state) => ({
          active: state.active.filter((entry) => entry.id !== id),
        }));
        cancelTimer(id);
      };

      const commitEntry = (entry: TimelineHighlight) => {
        set((state) => {
          const keep = state.active.filter(
            (existing) =>
              !(
                existing.trackId === entry.trackId &&
                existing.elementId === entry.elementId &&
                existing.effect === entry.effect
              )
          );
          return {
            active: [...keep, entry].sort((a, b) => a.createdAt - b.createdAt),
          };
        });

        scheduleExpiry(entry.id, entry.expiresAt - now, removeById);
      };

      const entryIds: string[] = [];

      inputs.forEach((input) => {
        const effect = input.effect ?? "generic";
        const highlightTtl = input.ttl ?? ttl;
        const id = generateUUID();
        const entry: TimelineHighlight = {
          ...input,
          effect,
          id,
          createdAt: now,
          expiresAt: now + highlightTtl,
          ttl: highlightTtl,
        };
        entryIds.push(id);

        const delay = Math.max(0, input.delay ?? 0);
        if (delay > 0) {
          const timer = setTimeout(() => {
            highlightDelayTimers.delete(id);
            commitEntry(entry);
          }, delay);
          highlightDelayTimers.set(id, timer);
        } else {
          commitEntry(entry);
        }
      });

      return entryIds;
    },

    pulseElements(inputs, opts) {
      return get().addHighlights(inputs, opts);
    },

    removeHighlightById: (id) => {
      cancelTimer(id);
      cancelDelayTimer(id);
      set((state) => ({
        active: state.active.filter((entry) => entry.id !== id),
      }));
    },

    removeHighlightsForElement: (trackId, elementId, effect) => {
      set((state) => {
        const next = state.active.filter((entry) => {
          const match =
            entry.trackId === trackId && entry.elementId === elementId;
          if (!match) return true;
          if (effect && entry.effect !== effect) return true;
          cancelTimer(entry.id);
          cancelDelayTimer(entry.id);
          return false;
        });
        return { active: next };
      });
    },

    clearByEffect: (effect) => {
      set((state) => {
        const next = state.active.filter((entry) => {
          if (entry.effect === effect) {
            cancelTimer(entry.id);
            cancelDelayTimer(entry.id);
            return false;
          }
          return true;
        });
        return { active: next };
      });
    },

    clearExpired: () => {
      const now = Date.now();
      set((state) => {
        const next = state.active.filter((entry) => {
          if (entry.expiresAt <= now) {
            cancelTimer(entry.id);
            cancelDelayTimer(entry.id);
            return false;
          }
          return true;
        });
        return { active: next };
      });
    },

    clearAll: () => {
      set(() => ({ active: [] }));
      highlightTimers.forEach((timer) => {
        clearTimeout(timer);
      });
      highlightTimers.clear();
      highlightDelayTimers.forEach((timer) => {
        clearTimeout(timer);
      });
      highlightDelayTimers.clear();
    },
  })
);
