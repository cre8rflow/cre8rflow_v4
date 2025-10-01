/**
 * SSE route for agent instruction streaming
 * Streams abstract editing steps based on prompt analysis
 */

import { NextRequest } from "next/server";
import { planInstructions } from "@/lib/planner";
import type { AgentRequestPayload } from "@/types/agent";
import { env } from "@/env";
import { twelveLabsService } from "@/lib/twelvelabs-service";
import { getMediaIndexJobs } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Helper function to send SSE-formatted data
 */
type SseController = {
  enqueue: ReadableStreamDefaultController["enqueue"];
  close: ReadableStreamDefaultController["close"];
};

function createSseHelpers(controller: ReadableStreamDefaultController) {
  let closed = false;

  const safeClose = () => {
    if (!closed) {
      closed = true;
      try {
        controller.close();
      } catch (error) {
        console.error("SSE close failed", error);
      }
    }
  };

  const safeSend = (data: unknown) => {
    if (closed) return;
    try {
      controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      closed = true;
      console.error("SSE send failed", error);
    }
  };

  return { safeSend, safeClose, isClosed: () => closed };
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
      const { safeSend, safeClose, isClosed } = createSseHelpers(controller);
      try {
        // Parse metadata safely
        let metadata: AgentRequestPayload["metadata"] = {};
        try {
          metadata = JSON.parse(metadataRaw);
        } catch {}

        // Start with planning log
        const aiFirst = env.AGENT_PLANNER_FALLBACK === "false";
        safeSend({ event: "log", message: `Planning for: ${prompt}` });
        safeSend({
          event: "log",
          message: `Planner mode: ${aiFirst ? "AI-first (no fallback)" : "AI+fallback"}`,
        });
        if (env.OPENAI_API_KEY) {
          const model = env.OPENAI_MODEL || "gpt-4o-mini";
          const configured = env.OPENAI_RESP_FORMAT || "json_object";
          const effective =
            configured === "json_schema"
              ? "json_object (downgraded)"
              : configured;
          safeSend({
            event: "log",
            message: `Calling OpenAI model: ${model} (response_format=${effective})`,
          });
        } else {
          safeSend({
            event: "log",
            message: "No OPENAI_API_KEY set; using heuristic.",
          });
        }

        // Call planner (OpenAI if configured, else fallback heuristics)
        planInstructions({ prompt, metadata })
          .then(async (result) => {
            if (!result.ok) {
              safeSend({ event: "error", message: result.error });
              safeClose();
              return;
            }

            // Resolve TwelveLabs search steps server-side into applyCut
            const instructions: any[] = [];
            for (const instr of result.steps) {
              if (instr.type === "twelvelabs.search") {
                const query = instr.query;
                safeSend({
                  event: "log",
                  message: `Calling TwelveLabs for: ${query}`,
                });

                // Check indexing readiness using Supabase (projectId from metadata)
                const projectId = (metadata as any).projectId;
                if (projectId) {
                  try {
                    const jobs = await getMediaIndexJobs(projectId);
                    const readyCount = jobs.filter(
                      (j) => j.status === "ready"
                    ).length;
                    if (readyCount === 0) {
                      safeSend({
                        event: "log",
                        message:
                          "Still analyzing video(s). Try again after indexing completes.",
                      });
                      // Skip this step gracefully
                      continue;
                    }
                  } catch (e) {
                    safeSend({
                      event: "log",
                      message:
                        "Could not verify indexing status; proceeding to search.",
                    });
                  }
                }

                try {
                  const userId = "default-user";
                  const videoIdsUsed: string[] | undefined = (metadata as any)
                    .videoIdsUsed;
                  if (videoIdsUsed && videoIdsUsed.length) {
                    safeSend({
                      event: "log",
                      message: `Restricting search to ${videoIdsUsed.length} video(s) on timeline`,
                    });
                  }
                  const searchResp = await twelveLabsService.searchVideos(
                    userId,
                    query,
                    { page_limit: 1, threshold: "medium" },
                    videoIdsUsed
                  );
                  const allMatches = searchResp.results?.data ?? [];
                  const filteredMatches =
                    videoIdsUsed && videoIdsUsed.length
                      ? allMatches.filter((match) =>
                          videoIdsUsed.includes(match.video_id)
                        )
                      : allMatches;

                  if (allMatches.length && !filteredMatches.length) {
                    safeSend({
                      event: "log",
                      message:
                        "TwelveLabs returned matches, but none are on the current timeline; ignoring result.",
                    });
                  }

                  const top = filteredMatches[0];
                  if (!top) {
                    safeSend({
                      event: "log",
                      message: "No TwelveLabs matches found.",
                    });
                    continue;
                  }

                  safeSend({
                    event: "log",
                    message: `TwelveLabs match: video=${top.video_id} ${top.start.toFixed(2)}s–${top.end.toFixed(2)}s`,
                  });
                  instructions.push({
                    type: "twelvelabs.applyCut",
                    videoId: top.video_id,
                    start: top.start,
                    end: top.end,
                    description: `Cut out matched content (${top.start.toFixed(2)}–${top.end.toFixed(2)}s)`,
                  });
                } catch (e: any) {
                  safeSend({
                    event: "error",
                    message: `TwelveLabs search failed: ${e?.message || e}`,
                  });
                }
              } else {
                instructions.push(instr);
              }
            }

            // Report planner source and hint if any
            safeSend({
              event: "log",
              message: `Planner source: ${result.source}`,
            });
            if (result.hint) {
              safeSend({
                event: "log",
                message: `Planner hint: ${result.hint}`,
              });
            }

            safeSend({
              event: "log",
              message: `Planned ${instructions.length} step(s)`,
            });

            if (instructions.length === 0) {
              safeSend({ event: "error", message: "No steps planned" });
              safeClose();
              return;
            }

            // Stream each planned step
            for (let i = 0; i < instructions.length; i++) {
              safeSend({
                event: "step",
                stepIndex: i,
                totalSteps: instructions.length,
                instruction: instructions[i],
              });
            }

            safeSend({ event: "done", message: "All steps dispatched" });
            safeClose();
          })
          .catch((err) => {
            safeSend({
              event: "error",
              message: err instanceof Error ? err.message : "Planner failed",
            });
            safeClose();
          });
      } catch (error) {
        // Handle any errors during processing
        safeSend({
          event: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        safeClose();
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
