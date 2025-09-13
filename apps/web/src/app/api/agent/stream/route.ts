/**
 * SSE route for agent instruction streaming
 * Streams abstract editing steps based on prompt analysis
 */

import { NextRequest } from "next/server";
import { planInstructions } from "@/lib/planner";
import type { AgentRequestPayload } from "@/types/agent";
import { env } from "@/env";

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
        let metadata: AgentRequestPayload["metadata"] = {};
        try {
          metadata = JSON.parse(metadataRaw);
        } catch {}

        // Start with planning log
        const aiFirst = env.AGENT_PLANNER_FALLBACK === "false";
        sseSend(controller, { event: "log", message: `Planning for: ${prompt}` });
        sseSend(controller, { event: "log", message: `Planner mode: ${aiFirst ? "AI-first (no fallback)" : "AI+fallback"}` });
        if (env.OPENAI_API_KEY) {
          const model = env.OPENAI_MODEL || "gpt-4o-mini";
          const configured = env.OPENAI_RESP_FORMAT || "json_object";
          const effective = configured === "json_schema" ? "json_object (downgraded)" : configured;
          sseSend(controller, { event: "log", message: `Calling OpenAI model: ${model} (response_format=${effective})` });
        } else {
          sseSend(controller, { event: "log", message: "No OPENAI_API_KEY set; using heuristic." });
        }

        // Call planner (OpenAI if configured, else fallback heuristics)
        planInstructions({ prompt, metadata })
          .then((result) => {
            if (!result.ok) {
              sseSend(controller, { event: "error", message: result.error });
              controller.close();
              return;
            }

            const instructions = result.steps;

            // Report planner source and hint if any
            sseSend(controller, { event: "log", message: `Planner source: ${result.source}` });
            if (result.hint) {
              sseSend(controller, { event: "log", message: `Planner hint: ${result.hint}` });
            }
            sseSend(controller, { event: "log", message: `Planned ${instructions.length} step(s)` });

            if (instructions.length === 0) {
              sseSend(controller, { event: "error", message: "No steps planned" });
              controller.close();
              return;
            }

            // Stream each planned step
            for (let i = 0; i < instructions.length; i++) {
              sseSend(controller, {
                event: "step",
                stepIndex: i,
                totalSteps: instructions.length,
                instruction: instructions[i],
              });
            }

            sseSend(controller, { event: "done", message: "All steps dispatched" });
            controller.close();
          })
          .catch((err) => {
            sseSend(controller, {
              event: "error",
              message: err instanceof Error ? err.message : "Planner failed",
            });
            controller.close();
          });
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

// Note: ordinal helper moved to planner fallback
