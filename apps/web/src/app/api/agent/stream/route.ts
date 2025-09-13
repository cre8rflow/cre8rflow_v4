/**
 * SSE route for agent instruction streaming
 * Streams abstract editing steps based on prompt analysis
 */

import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Helper function to send SSE-formatted data
 */
function sseSend(
  controller: ReadableStreamDefaultController,
  data: unknown
): void {
  controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * GET handler for agent instruction streaming
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const prompt = url.searchParams.get("prompt") ?? "";
  const metadataRaw = url.searchParams.get("metadata") ?? "{}";

  const stream = new ReadableStream({
    start(controller) {
      try {
        // Parse metadata safely
        const metadata = JSON.parse(metadataRaw);

        // Start with planning log
        sseSend(controller, {
          event: "log",
          message: `Planning for: ${prompt}`,
        });

        // Mock planner: analyze prompt and generate steps
        const steps: any[] = [];
        const lower = prompt.toLowerCase();

        // Generic parsing
        const rangeMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
        const hasCutOut = lower.includes("cut out");
        const trimDeltaMatch = lower.match(/trim.*?by\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/);
        const parsedDelta = trimDeltaMatch ? parseFloat(trimDeltaMatch[1]) : undefined;

        if (hasCutOut && rangeMatch) {
          const start = parseFloat(rangeMatch[1]);
          const end = parseFloat(rangeMatch[2]);
          const normStart = Math.min(start, end);
          const normEnd = Math.max(start, end);

          // Step 1: cut-out the requested range
          steps.push({
            event: "step",
            stepIndex: steps.length,
            totalSteps: steps.length + 1,
            instruction: {
              type: "cut-out",
              target: { kind: "clipsOverlappingRange", start: normStart, end: normEnd, track: "media" },
              range: { mode: "globalSeconds", start: normStart, end: normEnd },
              description: `Cut out ${normStart}–${normEnd}s across media clips`,
            },
          });

          // Optional follow-up trim step: target the clip at the cut end time (right piece)
          if (lower.includes("trim") && parsedDelta !== undefined) {
            steps.push({
              event: "step",
              stepIndex: steps.length,
              totalSteps: steps.length + 1,
              instruction: {
                type: "trim",
                target: { kind: "clipAtTime", time: normEnd, track: "media" },
                sides: { right: { mode: "deltaSeconds", delta: parsedDelta } },
                description: `Trim ${parsedDelta}s off the clip at ${normEnd}s`,
              },
            });
          }
        }

        // Pattern: Trim specific nth clip (fallback)
        const trimMatch = lower.match(/trim.*?(\d+)(?:st|nd|rd|th).*?clip/);
        if (trimMatch) {
          const clipIndex = parseInt(trimMatch[1], 10);
          const deltaMatch = lower.match(/by\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/);
          const delta = deltaMatch ? parseFloat(deltaMatch[1]) : 0.5;

          steps.push({
            event: "step",
            stepIndex: steps.length,
            totalSteps: steps.length + 1,
            instruction: {
              type: "trim",
              target: { kind: "nthClip", index: clipIndex, track: "media" },
              sides: { right: { mode: "deltaSeconds", delta } },
              description: `Trim ${delta}s from the ${clipIndex}${getOrdinalSuffix(clipIndex)} clip`,
            },
          });
        }

        // Fallback: default action if no patterns matched
        if (steps.length === 0) {
          steps.push({
            event: "step",
            stepIndex: 0,
            totalSteps: 1,
            instruction: {
              type: "trim",
              target: { kind: "clipAtPlayhead", track: "media" },
              sides: { right: { mode: "deltaSeconds", delta: 1 } },
              description: "Fallback: trim 1s from clip at playhead",
            },
          });
        }

        // Stream steps sequentially with proper indexing
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          step.stepIndex = i;
          step.totalSteps = steps.length;
          sseSend(controller, step);
        }

        // Stream completion event
        sseSend(controller, {
          event: "done",
          message: "All steps dispatched",
        });

        controller.close();
      } catch (error) {
        // Handle any errors during processing
        sseSend(controller, {
          event: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
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
