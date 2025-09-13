/**
 * SSE client connector for agent instruction streaming
 * Handles EventSource connection and instruction execution
 */

import type { AgentRequestPayload, AgentStreamEvent } from "@/types/agent";
import { executeInstruction } from "./agent-executor";

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

        case "step": {
          if (streamEvent.instruction) {
            // Notify about the step
            onStep?.(streamEvent);

            // Execute the instruction using existing executor
            const result = executeInstruction({
              instruction: streamEvent.instruction,
            });

            // Handle execution errors
            if (!result.success && "error" in result) {
              onError?.(result.error);
            }
          }
          break;
        }

        case "done": {
          onDone?.();
          eventSource.close();
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
      onError?.("Malformed SSE event");
      eventSource.close();
    }
  };

  // Handle connection errors
  eventSource.onerror = (error) => {
    console.error("SSE connection error:", error);
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
