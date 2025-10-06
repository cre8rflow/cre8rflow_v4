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
      sides: { left?: string; right?: string };
      targetCount: number;
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
    const left = instruction.sides?.left?.mode;
    const right = instruction.sides?.right?.mode;
    executedActions.push({ kind: "trim", sides: { left, right }, targetCount });
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

export async function summarizeExecutedActions(
  actions: ExecutedAction[],
  onDelta?: (delta: string) => void
): Promise<string> {
  const bullets: string[] = [];
  for (const a of actions) {
    if (a.kind === "trim") {
      bullets.push(
        `Trim: ${a.sides.left ? `left(${a.sides.left})` : ""}${
          a.sides.left && a.sides.right ? "/" : ""
        }${a.sides.right ? `right(${a.sides.right})` : ""} on ${a.targetCount} clip(s)`
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

  type ExecutedAction =
    | {
        kind: "trim";
        sides: { left?: string; right?: string };
        targetCount: number;
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

  // (Removed duplicate inner definitions; top-level versions are exported)

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
            onLog?.(streamEvent.message);
          }
          break;
        }

        case "error": {
          if (streamEvent.message) {
            onError?.(streamEvent.message);
          }
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
