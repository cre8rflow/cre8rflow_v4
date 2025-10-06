"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import { useMemo } from "react";

type CommandPhase = "preview" | "executing" | "complete" | "error";

export type CommandEffect =
  | "trim"
  | "cut"
  | "caption"
  | "deadspace"
  | "analysis"
  | "generic";

interface CommandTargetState {
  trackId: string;
  elementId: string;
  progress: number;
}

interface CommandEntry {
  id: string;
  type: CommandEffect;
  description?: string;
  phase: CommandPhase;
  progress: number;
  currentStep: number;
  totalSteps: number;
  targets: Record<string, CommandTargetState>;
  createdAt: number;
  updatedAt: number;
  error?: string;
  theme: {
    color: string;
    fill: string;
    highlight: string;
    label: string;
  };
}

interface UpsertCommandPayload {
  id?: string;
  type: CommandEffect;
  description?: string;
  totalSteps?: number;
  currentStep?: number;
  phase?: CommandPhase;
}

interface RegisterTargetsPayload {
  id: string;
  type: CommandEffect;
  description?: string;
  targets: { trackId: string; elementId: string }[];
}

interface UpdateProgressPayload {
  id: string;
  currentStep?: number;
  totalSteps?: number;
  progress?: number;
  phase?: CommandPhase;
  error?: string;
}

interface TimelineCommandState {
  commands: Record<string, CommandEntry>;
  upsertCommand: (payload: UpsertCommandPayload) => string;
  registerTargets: (payload: RegisterTargetsPayload) => void;
  updateProgress: (payload: UpdateProgressPayload) => void;
  completeCommand: (id: string) => void;
  failCommand: (id: string, error?: string) => void;
  removeCommand: (id: string) => void;
}

const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

const scheduleCleanup = (
  id: string,
  remove: (id: string) => void,
  delay = 2200
) => {
  if (cleanupTimers.has(id)) {
    const timer = cleanupTimers.get(id);
    if (timer) clearTimeout(timer);
  }
  const timer = setTimeout(() => {
    cleanupTimers.delete(id);
    remove(id);
  }, delay);
  cleanupTimers.set(id, timer);
};

const commandKey = (trackId: string, elementId: string) =>
  `${trackId}:${elementId}`;

const mapCommandEffectToTheme = (effect: CommandEffect) => {
  switch (effect) {
    case "trim":
      return {
        color: "var(--command-trim-color)",
        fill: "var(--command-trim-fill)",
        highlight: "var(--command-trim-highlight)",
        label: "TRIM",
      };
    case "cut":
      return {
        color: "var(--command-cut-color)",
        fill: "var(--command-cut-fill)",
        highlight: "var(--command-cut-highlight)",
        label: "CUT",
      };
    case "caption":
      return {
        color: "var(--command-caption-color)",
        fill: "var(--command-caption-fill)",
        highlight: "var(--command-caption-highlight)",
        label: "CAPTIONS",
      };
    case "deadspace":
      return {
        color: "var(--command-deadspace-color)",
        fill: "var(--command-deadspace-fill)",
        highlight: "var(--command-deadspace-highlight)",
        label: "DEADSPACE",
      };
    case "analysis":
      return {
        color: "var(--command-generic-color)",
        fill: "var(--command-generic-fill)",
        highlight: "var(--command-generic-highlight)",
        label: "ANALYZING",
      };
    default:
      return {
        color: "var(--command-generic-color)",
        fill: "var(--command-generic-fill)",
        highlight: "var(--command-generic-highlight)",
        label: "PROCESSING",
      };
  }
};

export const useTimelineCommandStore = create<TimelineCommandState>()(
  (set, get) => ({
    commands: {},

    upsertCommand: ({
      id,
      type,
      description,
      totalSteps,
      currentStep,
      phase,
    }) => {
      const commandId = id ?? nanoid();
      const now = Date.now();
      set((state) => {
        const existing = state.commands[commandId];
        const resolvedEffect = existing?.type || type;
        const baseTheme = mapCommandEffectToTheme(resolvedEffect);
        const resolvedTheme = existing?.theme
          ? { ...baseTheme, ...existing.theme }
          : baseTheme;
        const entry: CommandEntry = existing
          ? {
              ...existing,
              type: existing.type || type,
              description: description ?? existing.description,
              totalSteps: totalSteps ?? existing.totalSteps,
              currentStep: currentStep ?? existing.currentStep,
              phase: phase ?? existing.phase,
              updatedAt: now,
              theme: resolvedTheme,
            }
          : {
              id: commandId,
              type,
              description,
              phase: phase ?? "preview",
              progress: 0,
              currentStep: currentStep ?? 0,
              totalSteps: totalSteps ?? 0,
              targets: {},
              createdAt: now,
              updatedAt: now,
              theme: baseTheme,
            };
        return {
          commands: {
            ...state.commands,
            [commandId]: entry,
          },
        };
      });
      return commandId;
    },

    registerTargets: ({ id, type, description, targets }) => {
      const now = Date.now();
      set((state) => {
        const existing = state.commands[id];
        const targetEntries = targets.reduce<
          Record<string, CommandTargetState>
        >((acc, target) => {
          acc[commandKey(target.trackId, target.elementId)] = {
            ...target,
            progress:
              existing?.targets?.[commandKey(target.trackId, target.elementId)]
                ?.progress ?? 0,
          };
          return acc;
        }, {});

        const entry: CommandEntry = existing
          ? {
              ...existing,
              type: existing.type || type,
              description: description ?? existing.description,
              targets: {
                ...existing.targets,
                ...targetEntries,
              },
              updatedAt: now,
              theme:
                existing.theme ??
                mapCommandEffectToTheme(existing.type || type),
            }
          : {
              id,
              type,
              description,
              phase: "preview",
              progress: 0,
              currentStep: 0,
              totalSteps: 0,
              targets: targetEntries,
              createdAt: now,
              updatedAt: now,
              theme: mapCommandEffectToTheme(type),
            };

        return {
          commands: {
            ...state.commands,
            [id]: entry,
          },
        };
      });
    },

    updateProgress: ({
      id,
      currentStep,
      totalSteps,
      progress,
      phase,
      error,
    }) => {
      const now = Date.now();
      set((state) => {
        const existing = state.commands[id];
        if (!existing) return state;

        const nextProgress =
          progress ??
          (() => {
            const total = totalSteps ?? existing.totalSteps;
            const current = currentStep ?? existing.currentStep;
            if (total <= 0) return existing.progress;
            return Math.min(1, Math.max(existing.progress, current / total));
          })();

        const updatedTargets = Object.fromEntries(
          Object.entries(existing.targets).map(([key, target]) => [
            key,
            {
              ...target,
              progress: nextProgress,
            },
          ])
        );

        return {
          commands: {
            ...state.commands,
            [id]: {
              ...existing,
              currentStep: currentStep ?? existing.currentStep,
              totalSteps: totalSteps ?? existing.totalSteps,
              progress: nextProgress,
              phase:
                phase ??
                (existing.phase === "preview" ? "executing" : existing.phase),
              error: error ?? existing.error,
              targets: updatedTargets,
              updatedAt: now,
            },
          },
        };
      });
    },

    completeCommand: (id) => {
      const remove = (state: TimelineCommandState) => {
        const nextCommands = { ...state.commands };
        delete nextCommands[id];
        return { commands: nextCommands };
      };

      set((state) => {
        const existing = state.commands[id];
        if (!existing) return state;
        const now = Date.now();
        const updatedTargets = Object.fromEntries(
          Object.entries(existing.targets).map(([key, target]) => [
            key,
            { ...target, progress: 1 },
          ])
        );
        scheduleCleanup(id, (commandId) => set((s) => remove(s)), 2400);
        return {
          commands: {
            ...state.commands,
            [id]: {
              ...existing,
              phase: "complete",
              progress: 1,
              targets: updatedTargets,
              updatedAt: now,
            },
          },
        };
      });
    },

    failCommand: (id, error) => {
      set((state) => {
        const existing = state.commands[id];
        if (!existing) return state;
        scheduleCleanup(
          id,
          (commandId) =>
            set((s) => {
              const next = { ...s.commands };
              delete next[commandId];
              return { commands: next };
            }),
          3200
        );
        return {
          commands: {
            ...state.commands,
            [id]: {
              ...existing,
              phase: "error",
              error,
              updatedAt: Date.now(),
            },
          },
        };
      });
    },

    removeCommand: (id) => {
      set((state) => {
        if (!(id in state.commands)) return state;
        const next = { ...state.commands };
        delete next[id];
        return { commands: next };
      });
    },
  })
);

export interface ElementCommandStatus {
  command: CommandEntry;
  target: CommandTargetState;
}

export function useElementCommandStatus(trackId: string, elementId: string) {
  const commands = useTimelineCommandStore((state) => state.commands);
  return useMemo(() => {
    const results: ElementCommandStatus[] = [];
    const key = commandKey(trackId, elementId);
    for (const command of Object.values(commands)) {
      const target = command.targets[key];
      if (target) {
        results.push({ command, target });
      }
    }
    return results;
  }, [commands, trackId, elementId]);
}

export function useActiveTimelineCommands() {
  const commands = useTimelineCommandStore((state) => state.commands);
  return useMemo(
    () =>
      Object.values(commands).filter(
        (command) => command.phase !== "complete" && command.phase !== "error"
      ),
    [commands]
  );
}

export type { CommandEntry, CommandPhase, CommandTargetState };
