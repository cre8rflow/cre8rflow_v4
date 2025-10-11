'use client';

/**
 * SSE client connector for agent instruction streaming
 * Handles EventSource connection and instruction execution
 */

import type {
  AgentRequestPayload,
  AgentStreamEvent,
  AnyInstruction,
} from "@/types/agent";
import { executeInstruction } from "./agent-executor";
import { env } from "@/env";
import { useTimelineCommandStore } from "@/stores/timeline-command-store";
import type { CommandEffect } from "@/stores/timeline-command-store";
import { formatSearchQuery } from "@/lib/agent-utils";
import {
  AgentProgressReporter,
  formatAgentProgressContent,
  type AgentProgressStatus,
} from "@/lib/agent-progress";

type TrimSideSpec = {
  mode: string;
  [key: string]: unknown;
};

const mapInstructionToEffect = (instructionType: string): CommandEffect => {
  switch (instructionType) {
    case "trim":
      return "trim";
    case "cut-out":
      return "cut";
    case "captions.generate":
      return "caption";
    case "deadspace.trim":
      return "deadspace";
    default:
      return "generic";
  }
};

// ---------------------------------------------------------------------------
// Executed actions aggregation for post-run summary (module-scoped)
// ---------------------------------------------------------------------------

export type ExecutedAction =
  | {
      kind: "trim";
      sides: { left?: TrimSideSpec; right?: TrimSideSpec };
      targetCount: number;
      meta?: { ripple?: boolean };
    }
  | {
      kind: "cut";
      range: {
        mode: string;
        start?: number;
        end?: number;
        left?: number;
        right?: number;
      };
      targetCount: number;
      meta?: {
        source?: string;
        searchQuery?: string;
        searchSummary?: string;
        searchWasQuoted?: boolean;
      };
    }
  | { kind: "captions" }
  | { kind: "deadspace"; targetCount: number };

const executedActions: ExecutedAction[] = [];

function recordExecutedFromInstruction(
  instruction: AnyInstruction,
  targetCount: number
): void {
  if (instruction.type === "trim") {
    const left = instruction.sides?.left
      ? JSON.parse(JSON.stringify(instruction.sides.left))
      : undefined;
    const right = instruction.sides?.right
      ? JSON.parse(JSON.stringify(instruction.sides.right))
      : undefined;
    executedActions.push({
      kind: "trim",
      sides: { left, right },
      targetCount,
      meta: { ripple: instruction.options?.ripple === true },
    });
  } else if (instruction.type === "cut-out") {
    const r = instruction.range as any;
    executedActions.push({
      kind: "cut",
      range: {
        mode: r.mode,
        start: r.start,
        end: r.end,
        left: r.left,
        right: r.right,
      },
      targetCount,
    });
  } else if (instruction.type === "captions.generate") {
    executedActions.push({ kind: "captions" });
  } else if (instruction.type === "deadspace.trim") {
    executedActions.push({ kind: "deadspace", targetCount });
  } else if ((instruction as any).type === "twelvelabs.applyCut") {
    const i = instruction as any;
    const normalized = i.queryNormalized;
    const searchQuery =
      i.query || i.query_text || normalized?.text || normalized?.raw || "";
    const searchSummary =
      i.summaryQuery || formatSearchQuery(normalized) || searchQuery;
    executedActions.push({
      kind: "cut",
      range: { mode: "timeline", start: i.start, end: i.end },
      targetCount,
      meta: {
        source: "twelvelabs",
        searchQuery,
        searchSummary,
        searchWasQuoted: normalized?.wasQuoted,
      },
    });
  }
}

type FriendlyInstructionCopy = {
  pending: string;
  complete: string;
  failure: string;
};

const FALLBACK_CLIP_LABEL = "selected clip";

function stripSurroundingQuotes(text: string): string {
  return text.replace(/^["']+|["']+$/g, "");
}

function stripTrailingParenthetical(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function normalizeFriendlyLabel(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const cleaned = stripSurroundingQuotes(
    stripTrailingParenthetical(raw.trim())
  ).replace(/\.+$/, "");
  return cleaned || fallback;
}

function friendlyQueryFromInstruction(
  instruction: Extract<AnyInstruction, { type: "twelvelabs.applyCut" }>
): string {
  const normalized = instruction.queryNormalized;
  const summary =
    instruction.summaryQuery ||
    (normalized ? formatSearchQuery(normalized) : undefined) ||
    instruction.query ||
    instruction.query_text;
  return normalizeFriendlyLabel(summary, "requested clip");
}

function getFriendlyCopyForInstruction(
  instruction: AnyInstruction
): FriendlyInstructionCopy | null {
  switch (instruction.type) {
    case "twelvelabs.applyCut": {
      const label = friendlyQueryFromInstruction(instruction);
      return {
        pending: `Cutting ${label}...`,
        complete: `Cut out ${label}.`,
        failure: `Could not cut out ${label}.`,
      };
    }
    case "cut-out": {
      const label = normalizeFriendlyLabel(
        instruction.description,
        FALLBACK_CLIP_LABEL
      );
      return {
        pending: `Cutting ${label}...`,
        complete: `Cut out ${label}.`,
        failure: `Could not cut out ${label}.`,
      };
    }
    case "trim": {
      const label = normalizeFriendlyLabel(
        instruction.description,
        FALLBACK_CLIP_LABEL
      );
      return {
        pending: `Trimming ${label}...`,
        complete: `Trimmed ${label}.`,
        failure: `Could not trim ${label}.`,
      };
    }
    case "captions.generate": {
      const label = normalizeFriendlyLabel(
        instruction.description,
        "captions"
      );
      return {
        pending: `Adding ${label}...`,
        complete: `Added ${label}.`,
        failure: `Could not add ${label}.`,
      };
    }
    case "deadspace.trim": {
      const label = normalizeFriendlyLabel(
        instruction.description,
        "silence"
      );
      return {
        pending: `Removing ${label}...`,
        complete: `Removed ${label}.`,
        failure: `Could not remove ${label}.`,
      };
    }
    default:
      return null;
  }
}

export async function summarizeExecutedActions(
  actions: ExecutedAction[],
  onDelta?: (delta: string) => void
): Promise<string> {
  const bullets: string[] = [];
  for (const a of actions) {
    if (a.kind === "trim") {
      const left = describeTrimSide(a.sides.left, "left");
      const right = describeTrimSide(a.sides.right, "right");
      const sideText = [left, right].filter(Boolean).join(" & ");
      const targetPhrase = `${a.targetCount} clip${a.targetCount === 1 ? "" : "s"}`;
      bullets.push(
        sideText
          ? `Trimmed ${sideText} on ${targetPhrase}`
          : `Trimmed ${targetPhrase}`
      );
    } else if (a.kind === "cut") {
      const r = a.range as any;
      let rangeText = "";
      if (
        r.mode === "timeline" ||
        r.mode === "globalSeconds" ||
        r.mode === "elementSeconds" ||
        r.mode === "source"
      ) {
        const s = Number(r.start ?? 0);
        const e = Number(r.end ?? 0);
        rangeText = `${s.toFixed(2)}–${e.toFixed(2)}s`;
      } else {
        rangeText = `around playhead (${r.left ?? 0}s/${r.right ?? 0}s)`;
      }
      const meta = a.meta;
      const hint =
        meta?.source === "twelvelabs" && meta?.searchSummary
          ? ` via search${meta.searchWasQuoted ? " (quoted)" : " (no quotes)"} ${meta.searchSummary}`
          : "";
      bullets.push(
        `Cut: removed ${rangeText}${hint} on ${a.targetCount} clip(s)`
      );
    } else if (a.kind === "captions") {
      bullets.push("Captions: added to match spoken audio");
    } else if (a.kind === "deadspace") {
      bullets.push(`Trimmed silence on ${a.targetCount} clip(s)`);
    }
  }

  const fallback = bullets.length
    ? `Completed edits: ${bullets.join("; ")}.`
    : "Made small timeline adjustments.";

  // Call server route to summarize with streaming support
  try {
    const resp = await fetch("/api/agent/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bullets, actions }),
    });

    if (!resp.ok || !resp.body) {
      if (onDelta) onDelta(fallback);
      return fallback;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          if (data.event === "summary_delta" && data.delta) {
            accumulated += data.delta;
            if (onDelta) onDelta(data.delta);
          } else if (data.event === "summary_done") {
            return accumulated || fallback;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    return accumulated || fallback;
  } catch {
    if (onDelta) onDelta(fallback);
    return fallback;
  }
}

export function getAndClearExecutedActions(): ExecutedAction[] {
  const copy = executedActions.slice();
  executedActions.length = 0;
  return copy;
}

function describeTrimSide(
  side: TrimSideSpec | undefined,
  position: "left" | "right"
): string {
  if (!side) return "";

  const labelPrefix = position === "left" ? "left edge" : "right edge";

  const secondsText = (value: number | undefined) =>
    value !== undefined ? `${formatSeconds(value)}s` : undefined;

  switch (side.mode) {
    case "deltaSeconds": {
      const value = typeof side.delta === "number" ? side.delta : undefined;
      if (value !== undefined) {
        return `${labelPrefix} by ${secondsText(value)}`;
      }
      break;
    }
    case "toSeconds": {
      const value = typeof side.time === "number" ? side.time : undefined;
      if (value !== undefined) {
        return `${labelPrefix} to ${secondsText(value)}`;
      }
      break;
    }
    case "toPlayhead":
      return `${labelPrefix} to playhead`;
    case "deltaFrames": {
      const frames = typeof side.frames === "number" ? side.frames : undefined;
      if (frames !== undefined) {
        return `${labelPrefix} by ${frames} frame${frames === 1 ? "" : "s"}`;
      }
      break;
    }
    default:
      break;
  }

  const extras = Object.entries(side)
    .filter(([key]) => key !== "mode")
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");

  return extras
    ? `${labelPrefix} (${side.mode}: ${extras})`
    : `${labelPrefix} (${side.mode})`;
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const scaled = Math.round(value * 100) / 100;
  return Number.isInteger(scaled) ? `${Math.trunc(scaled)}` : `${scaled}`;
}

/**
 * Start an agent stream session with SSE
 * Opens EventSource connection, parses events, and executes instructions
 */
export function startAgentStream({
  prompt,
  metadata,
  onLog,
  onStep,
  onDone,
  onError,
}: {
  prompt: string;
  metadata: AgentRequestPayload["metadata"];
  onLog?: (msg: string) => void;
  onStep?: (evt: AgentStreamEvent) => void;
  onDone?: () => void;
  onError?: (msg: string) => void;
}): EventSource {
  // Build query parameters for SSE endpoint
  const params = new URLSearchParams({
    prompt,
    metadata: JSON.stringify(metadata),
  });

  // Create EventSource connection
  const eventSource = new EventSource(`/api/agent/stream?${params.toString()}`);

  const progress = new AgentProgressReporter();
  const instructionMessages = new Map<
    string,
    { key: string; copy: FriendlyInstructionCopy }
  >();
  let instructionSequence = 0;
  let searchSequence = 0;

  const logFriendlyStatus = (status: AgentProgressStatus, text: string) => {
    console.log("[agent-chat]", formatAgentProgressContent(status, text));
  };

  type PendingSearchContext = {
    analyzeKey: string;
    findKey: string;
    summary: string;
  };

  const pendingSearches: PendingSearchContext[] = [];

  const beginSearchMessages = (summaryRaw: string) => {
    const summary = normalizeFriendlyLabel(summaryRaw, "the requested moment");
    const analyzeKey = `search-${++searchSequence}-analyze`;
    const findKey = `search-${searchSequence}-find`;
    progress.begin(analyzeKey, "Analyzing video.");
    progress.begin(findKey, `Finding ${summary}...`);
    logFriendlyStatus("pending", "Analyzing video.");
    logFriendlyStatus("pending", `Finding ${summary}...`);
    pendingSearches.push({ analyzeKey, findKey, summary });
  };

  const completeSearchMessages = () => {
    const ctx = pendingSearches.shift();
    if (!ctx) return;
    progress.complete(ctx.analyzeKey, "Analyzed video.");
    progress.complete(ctx.findKey, `Found ${ctx.summary}.`);
    logFriendlyStatus("complete", "Analyzed video.");
    logFriendlyStatus("complete", `Found ${ctx.summary}.`);
  };

  const failSearchMessages = (override?: string) => {
    const ctx = pendingSearches.shift();
    if (!ctx) return;
    progress.complete(ctx.analyzeKey, "Analyzed video.");
    const failureText = override ?? `Could not find ${ctx.summary}.`;
    progress.fail(ctx.findKey, failureText);
    logFriendlyStatus("complete", "Analyzed video.");
    logFriendlyStatus("error", failureText);
  };

  const handleFriendlyLog = (message: string) => {
    if (message.startsWith("Calling TwelveLabs for:")) {
      const summary = message.split("Calling TwelveLabs for:")[1]?.trim() ?? "";
      beginSearchMessages(summary);
      return;
    }

    if (message.startsWith("TwelveLabs match:")) {
      completeSearchMessages();
      return;
    }

    if (
      message.startsWith("No TwelveLabs matches found") ||
      message.includes("none are on the current timeline")
    ) {
      failSearchMessages();
      return;
    }

    if (message.startsWith("TwelveLabs search failed:")) {
      failSearchMessages("TwelveLabs search failed.");
      return;
    }

    if (message.includes("Still analyzing video(s). Try again")) {
      failSearchMessages("Video analysis is still in progress.");
    }
  };

  const registerInstructionMessage = (
    instruction: AnyInstruction,
    commandKey: string
  ) => {
    if (instructionMessages.has(commandKey)) return;
    const copy = getFriendlyCopyForInstruction(instruction);
    if (!copy) return;
    const key = `instruction-${++instructionSequence}`;
    instructionMessages.set(commandKey, { key, copy });
    progress.begin(key, copy.pending);
    logFriendlyStatus("pending", copy.pending);
  };

  const settleInstructionMessage = (
    commandKey: string,
    outcome: "success" | "error"
  ) => {
    const entry = instructionMessages.get(commandKey);
    if (!entry) return;
    instructionMessages.delete(commandKey);
    if (outcome === "success") {
      progress.complete(entry.key, entry.copy.complete);
      logFriendlyStatus("complete", entry.copy.complete);
    } else {
      progress.fail(entry.key, entry.copy.failure);
      logFriendlyStatus("error", entry.copy.failure);
    }
  };

  const failAllPendingInstructions = (reason?: string) => {
    instructionMessages.forEach(({ key, copy }) => {
      const message = reason ?? copy.failure;
      progress.fail(key, message);
      logFriendlyStatus("error", message);
    });
    instructionMessages.clear();
  };

  const failAllPendingSearches = (reason?: string) => {
    while (pendingSearches.length) {
      failSearchMessages(reason);
    }
  };

  const commandRegistry = new Map<
    string,
    { id: string; type: CommandEffect }
  >();
  const activeCommands = new Set<string>();
  const pendingSteps: Array<{
    instruction: AnyInstruction;
    stepIndex: number;
    totalSteps: number;
    registryEntry: { id: string; type: CommandEffect };
    commandKey: string;
  }> = [];
  let isProcessing = false;

  const commandStore = useTimelineCommandStore.getState();
  const STEP_DELAY_MS = 600;
  const processedInstructionKeys = new Set<string>();

  // ---------------------------------------------------------------------------
  // Executed actions aggregation for post-run summary
  // ---------------------------------------------------------------------------

  const processQueue = () => {
    if (isProcessing) return;
    const next = pendingSteps.shift();
    if (!next) {
      return;
    }
    isProcessing = true;

    const { instruction, stepIndex, totalSteps, registryEntry, commandKey } =
      next;
    const currentStepIndex = stepIndex + 1;
    const effectiveTotal = totalSteps || currentStepIndex;

    commandStore.upsertCommand({
      id: registryEntry.id,
      type: registryEntry.type,
      description: (instruction as any).description,
      totalSteps: effectiveTotal,
      currentStep: currentStepIndex,
      phase: "executing",
    });

    const result = executeInstruction({
      instruction,
      context: {
        commandId: registryEntry.id,
        totalSteps,
        stepIndex,
      },
    });

    if (!result.success && "error" in result) {
      commandStore.failCommand(registryEntry.id, result.error);
      onError?.(result.error);
      settleInstructionMessage(commandKey, "error");
    } else {
      commandStore.updateProgress({
        id: registryEntry.id,
        currentStep: currentStepIndex,
        totalSteps: effectiveTotal,
        phase: "executing",
      });
      // Record executed action for later summarization with accurate counts
      if (result.success) {
        const resolved = (result as any).targetsResolved ?? 1;
        // Prefer pre-edit timeline range if provided by executor meta
        if (
          (instruction as any).type === "twelvelabs.applyCut" &&
          (result as any).meta?.timelineRange
        ) {
          const r = (result as any).meta.timelineRange as {
            start: number;
            end: number;
          };
          const tlInstruction = instruction as any;
          const normalized = tlInstruction.queryNormalized;
          const queryFromInstruction =
            tlInstruction.query || tlInstruction.query_text;
          const queryFromResult = (result as any).meta?.tlQuery;
          const query = queryFromInstruction || queryFromResult || "";
          const summaryQuery =
            tlInstruction.summaryQuery ||
            formatSearchQuery(normalized) ||
            query;
          recordExecutedFromInstruction(
            {
              type: "twelvelabs.applyCut",
              start: r.start,
              end: r.end,
              query,
              query_text: query,
              summaryQuery,
              queryNormalized: normalized,
            } as any,
            resolved
          );
        } else {
          recordExecutedFromInstruction(
            instruction as AnyInstruction,
            resolved
          );
        }
      }
      settleInstructionMessage(commandKey, "success");
    }

    // Wait before processing next step to allow animation to be seen
    setTimeout(() => {
      processedInstructionKeys.add(commandKey);
      isProcessing = false;
      processQueue();
    }, STEP_DELAY_MS);
  };

  // Handle incoming messages
  eventSource.onmessage = (event) => {
    try {
      const streamEvent = JSON.parse(event.data) as AgentStreamEvent;

      // Handle different event types
      switch (streamEvent.event) {
        case "log": {
          if (streamEvent.message) {
            handleFriendlyLog(streamEvent.message);
            onLog?.(streamEvent.message);
          }
          break;
        }

        case "error": {
          if (streamEvent.message) {
            onError?.(streamEvent.message);
          }
          failAllPendingSearches();
          failAllPendingInstructions(streamEvent.message);
          eventSource.close();
          return;
        }

        case "thought": {
          // Thought events are handled by agent panel only
          break;
        }

        case "thought_done": {
          // Thought events are handled by agent panel only
          break;
        }

        case "step": {
          if (streamEvent.instruction) {
            // Notify about the step
            onStep?.(streamEvent);

            const instruction = streamEvent.instruction;
            const commandKey = JSON.stringify(instruction);
            let registryEntry = commandRegistry.get(commandKey);
            if (!registryEntry) {
              const id = `cmd-${mapInstructionToEffect(instruction.type)}-${commandRegistry.size + 1}`;
              registryEntry = {
                id,
                type: mapInstructionToEffect(instruction.type),
              };
              commandRegistry.set(commandKey, registryEntry);
            }
            const alreadyQueued = pendingSteps.some(
              (step) => step.commandKey === commandKey
            );
            if (alreadyQueued || processedInstructionKeys.has(commandKey)) {
              return;
            }
            activeCommands.add(registryEntry.id);

            registerInstructionMessage(instruction, commandKey);

            pendingSteps.push({
              instruction,
              stepIndex: streamEvent.stepIndex ?? 0,
              totalSteps: streamEvent.totalSteps ?? 0,
              registryEntry,
              commandKey,
            });

            processQueue();
          }
          break;
        }

        case "done": {
          const finalize = () => {
            activeCommands.forEach((commandId) => {
              commandStore.completeCommand(commandId);
            });
            activeCommands.clear();
            commandRegistry.clear();
            onDone?.();
            eventSource.close();
          };

          if (pendingSteps.length === 0 && !isProcessing) {
            finalize();
          } else {
            const interval = setInterval(() => {
              if (pendingSteps.length === 0 && !isProcessing) {
                clearInterval(interval);
                finalize();
              }
            }, 100);
          }
          return;
        }

        default: {
          // Exhaustive check for unknown events
          const _exhaustive: never = streamEvent.event;
          console.warn("Unknown SSE event type:", _exhaustive);
        }
      }
    } catch (parseError) {
      // Handle malformed JSON or parsing errors
      activeCommands.forEach((commandId) => {
        commandStore.failCommand(commandId, "Malformed SSE event");
      });
      activeCommands.clear();
      failAllPendingInstructions("Agent stream ended unexpectedly.");
      failAllPendingSearches("Agent stream ended unexpectedly.");
      onError?.("Malformed SSE event");
      eventSource.close();
    }
  };

  // Handle connection errors
  eventSource.onerror = (error) => {
    console.error("SSE connection error:", error);
    activeCommands.forEach((commandId) => {
      commandStore.failCommand(commandId, "Stream connection error");
    });
    activeCommands.clear();
    failAllPendingInstructions("Stream connection error.");
    failAllPendingSearches("Stream connection error.");
    onError?.("Stream connection error");
    eventSource.close();
  };

  return eventSource;
}

/**
 * Utility type for SSE connection state management
 */
export interface AgentStreamSession {
  eventSource: EventSource;
  isActive: boolean;
  close: () => void;
}

/**
 * Create a managed agent stream session with state tracking
 * Provides additional utilities for session management
 */
export function createAgentStreamSession({
  prompt,
  metadata,
  onLog,
  onStep,
  onDone,
  onError,
}: {
  prompt: string;
  metadata: AgentRequestPayload["metadata"];
  onLog?: (msg: string) => void;
  onStep?: (evt: AgentStreamEvent) => void;
  onDone?: () => void;
  onError?: (msg: string) => void;
}): AgentStreamSession {
  let isActive = true;

  const eventSource = startAgentStream({
    prompt,
    metadata,
    onLog,
    onStep,
    onDone: () => {
      isActive = false;
      onDone?.();
    },
    onError: (msg) => {
      isActive = false;
      onError?.(msg);
    },
  });

  return {
    eventSource,
    get isActive() {
      return isActive;
    },
    close: () => {
      if (isActive) {
        isActive = false;
        eventSource.close();
      }
    },
  };
}

/**
 * Utility for testing SSE connections
 * Provides simplified interface for quick testing
 */
export function testAgentStream({
  prompt,
  verbose = false,
}: {
  prompt: string;
  verbose?: boolean;
}): EventSource {
  return startAgentStream({
    prompt,
    metadata: {
      duration: 60,
      fps: 30,
      tracks: [{ id: "test-track", type: "media", elements: 3 }],
    },
    onLog: (msg) => {
      if (verbose) console.log("[SSE Log]", msg);
    },
    onStep: (evt) => {
      console.log(
        "[SSE Step]",
        evt.stepIndex,
        "/",
        evt.totalSteps,
        ":",
        evt.instruction?.description
      );
    },
    onDone: () => {
      console.log("[SSE Done] Stream completed");
    },
    onError: (msg) => {
      console.error("[SSE Error]", msg);
    },
  });
}
