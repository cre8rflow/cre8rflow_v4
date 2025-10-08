/**
 * Agent orchestrator hook
 * Bridges timeline stores with SSE streaming for agent-driven editing
 */

"use client";

import { startAgentStream } from "@/lib/agent-client";
import { useProjectStore, DEFAULT_FPS } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { toast } from "sonner";

/**
 * Hook for orchestrating agent-driven editing sessions
 * Builds metadata from stores and manages SSE streaming
 */
export function useAgentOrchestrator() {
  const { activeProject } = useProjectStore();
  const { tracks } = useTimelineStore();
  const { currentTime } = usePlaybackStore();
  const { mediaFiles } = useMediaStore();

  return ({ prompt }: { prompt: string }) => {
    // Calculate total timeline duration
    const duration = tracks.reduce((maxDuration, track) => {
      const trackElements = track.elements.map(
        (element) => element.startTime + element.duration
      );
      const trackMaxDuration = trackElements.length
        ? Math.max(...trackElements)
        : 0;
      return Math.max(maxDuration, trackMaxDuration);
    }, 0);

    // Derive TwelveLabs video IDs used in the current timeline
    const usedMediaIds = new Set<string>();
    for (const track of tracks) {
      for (const el of track.elements) {
        if ((el as any).type === "media") usedMediaIds.add((el as any).mediaId);
      }
    }
    const videoIdsUsed = Array.from(usedMediaIds)
      .map((id) => mediaFiles.find((m) => m.id === id)?.twelveLabsVideoId)
      .filter((v): v is string => !!v);

    // Build lightweight metadata payload
    const metadata = {
      projectId: activeProject?.id,
      duration,
      fps: activeProject?.fps ?? DEFAULT_FPS,
      playheadTime: currentTime,
      videoIdsUsed,
      tracks: tracks.map((track) => ({
        id: track.id,
        type: track.type,
        elements: track.elements.length,
      })),
    };

    // Start agent stream with integrated callbacks
    const eventSource = startAgentStream({
      prompt,
      metadata,
      onLog: (message) => {
        // Log planning and processing messages
        console.log("[agent]", message);
      },
      onStep: (event) => {
        // Show step progress via toast
        const stepMessage =
          event.instruction?.description ??
          `Step ${(event.stepIndex ?? 0) + 1}/${event.totalSteps ?? "?"}`;
        toast.message(stepMessage);
      },
      onDone: () => {
        // Show completion notification
        toast.success("Agent session complete");
      },
      onError: (message) => {
        // Show error notification
        toast.error(`Agent error: ${message}`);
      },
    });

    return eventSource;
  };
}

/**
 * Hook for advanced agent orchestration with session management
 * Provides additional control and state tracking
 */
export function useAdvancedAgentOrchestrator() {
  const { activeProject } = useProjectStore();
  const { tracks } = useTimelineStore();
  const { currentTime } = usePlaybackStore();

  return {
    /**
     * Start an agent session with full control
     */
    startSession: ({
      prompt,
      options = {},
    }: {
      prompt: string;
      options?: {
        showStepToasts?: boolean;
        showLogs?: boolean;
        onStepComplete?: (stepIndex: number, totalSteps: number) => void;
        onSessionComplete?: () => void;
        onSessionError?: (error: string) => void;
      };
    }) => {
      // Build metadata from current store state
      const duration = tracks.reduce((maxDuration, track) => {
        const trackElements = track.elements.map(
          (element) => element.startTime + element.duration
        );
        const trackMaxDuration = trackElements.length
          ? Math.max(...trackElements)
          : 0;
        return Math.max(maxDuration, trackMaxDuration);
      }, 0);

      const metadata = {
        projectId: activeProject?.id,
        duration,
        fps: activeProject?.fps ?? DEFAULT_FPS,
        playheadTime: currentTime,
        tracks: tracks.map((track) => ({
          id: track.id,
          type: track.type,
          elements: track.elements.length,
        })),
      };

      // Start stream with customizable callbacks
      return startAgentStream({
        prompt,
        metadata,
        onLog: (message) => {
          if (options.showLogs) {
            console.log("[agent]", message);
          }
        },
        onStep: (event) => {
          if (options.showStepToasts) {
            const stepMessage =
              event.instruction?.description ??
              `Step ${(event.stepIndex ?? 0) + 1}/${event.totalSteps ?? "?"}`;
            toast.message(stepMessage);
          }

          options.onStepComplete?.(event.stepIndex ?? 0, event.totalSteps ?? 1);
        },
        onDone: () => {
          if (options.showStepToasts) {
            toast.success("Agent session complete");
          }
          options.onSessionComplete?.();
        },
        onError: (message) => {
          toast.error(`Agent error: ${message}`);
          options.onSessionError?.(message);
        },
      });
    },

    /**
     * Get current timeline metadata without starting a session
     */
    getTimelineMetadata: () => {
      const duration = tracks.reduce((maxDuration, track) => {
        const trackElements = track.elements.map(
          (element) => element.startTime + element.duration
        );
        const trackMaxDuration = trackElements.length
          ? Math.max(...trackElements)
          : 0;
        return Math.max(maxDuration, trackMaxDuration);
      }, 0);

      return {
        projectId: activeProject?.id,
        duration,
        fps: activeProject?.fps ?? DEFAULT_FPS,
        playheadTime: currentTime,
        tracks: tracks.map((track) => ({
          id: track.id,
          type: track.type,
          elements: track.elements.length,
        })),
      };
    },
  };
}

/**
 * Utility hook for testing agent functionality
 * Simplified interface for development and debugging
 */
export function useAgentTester() {
  const orchestrator = useAgentOrchestrator();

  return {
    /**
     * Test with predefined prompts
     */
    testPrompts: {
      cutAndTrim: () =>
        orchestrator({
          prompt: "cut out 5–10 seconds and trim the last clip by 5 seconds",
        }),
      trimSecond: () =>
        orchestrator({
          prompt: "trim the 2nd clip by 0.5s on the right",
        }),
      cutShort: () =>
        orchestrator({
          prompt: "cut out 2–3 seconds",
        }),
      fallback: () =>
        orchestrator({
          prompt: "do something random",
        }),
    },

    /**
     * Test with custom prompt
     */
    test: ({ prompt }: { prompt: string }) => orchestrator({ prompt }),
  };
}
