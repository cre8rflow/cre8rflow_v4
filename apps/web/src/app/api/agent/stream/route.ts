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
import {
  waitUntil,
  normalizeSearchQuery,
  formatSearchQuery,
} from "@/lib/agent-utils";

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
 * Stream reasoning/thinking from OpenAI
 * Provides high-level explanation of what will be done
 * NOTE: Does NOT send thought_done - caller handles it via .finally()
 */
async function streamReasoning({
  prompt,
  metadata,
  safeSend,
  signal,
}: {
  prompt: string;
  metadata: AgentRequestPayload["metadata"];
  safeSend: (data: unknown) => void;
  signal: AbortSignal;
}): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    safeSend({ event: "thought", delta: "Analyzing your request…" });
    return;
  }

  try {
    const model = env.OPENAI_MODEL || "gpt-4o-mini";
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: 80,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "Explain in 2-3 clear sentences what you will do to edit this video. Be specific about actions (trim, cut, add captions) but brief. No technical jargon. Address the user directly using 'I'll'.",
          },
          {
            role: "user",
            content: `Command:\n${prompt}\n\nMetadata:\n${JSON.stringify(metadata)}`,
          },
        ],
      }),
      signal,
    });

    if (!resp.ok || !resp.body) {
      safeSend({ event: "thought", delta: "Analyzing your request…" });
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      if (signal.aborted) break;

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        if (!chunk.startsWith("data:")) continue;
        const data = chunk.slice(5).trim();
        if (data === "[DONE]") {
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) {
            safeSend({ event: "thought", delta });
          }
        } catch {
          // Ignore malformed chunks
        }
      }
    }
  } catch (error) {
    // Network error or aborted - send fallback
    if (!signal.aborted) {
      safeSend({ event: "thought", delta: "Analyzing your request…" });
    }
  }
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

        // Start thinking stream in parallel with completion tracking
        const thoughtAbort = new AbortController();
        let thoughtDone = false;
        streamReasoning({
          prompt,
          metadata,
          safeSend,
          signal: thoughtAbort.signal,
        }).finally(() => {
          thoughtDone = true;
          safeSend({ event: "thought_done" });
        });

        // Start with planning log
        safeSend({ event: "log", message: `Planning for: ${prompt}` });
        safeSend({
          event: "log",
          message: "Planner mode: OpenAI (LLM only)",
        });
        if (!env.OPENAI_API_KEY) {
          safeSend({
            event: "error",
            message: "OpenAI API key not configured. Please add OPENAI_API_KEY to continue.",
          });
          thoughtAbort.abort();
          if (!thoughtDone) {
            safeSend({ event: "thought_done" });
          }
          safeClose();
          return;
        }
        const model = env.OPENAI_MODEL || "gpt-4o-mini";
        const configured = env.OPENAI_RESP_FORMAT || "json_object";
        const effective =
          configured === "json_schema" ? "json_object (downgraded)" : configured;
        safeSend({
          event: "log",
          message: `Calling OpenAI model: ${model} (response_format=${effective})`,
        });

        // Call planner (OpenAI LLM)
        planInstructions({ prompt, metadata })
          .then(async (result) => {
            if (!result.ok) {
              thoughtAbort.abort();
              if (!thoughtDone) {
                safeSend({ event: "thought_done" });
              }
              safeSend({ event: "error", message: result.error });
              safeClose();
              return;
            }

            // Resolve TwelveLabs search steps server-side into applyCut
            const instructions: any[] = [];

            for (const instr of result.steps) {
              if (instr.type === "twelvelabs.search") {
                const normalized = normalizeSearchQuery(instr.query);
                const query = normalized.text || normalized.raw;
                const summaryQuery = formatSearchQuery(normalized) || query;
                safeSend({
                  event: "log",
                  message: `Calling TwelveLabs for: ${summaryQuery}`,
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
                    query,
                    query_text: query, // explicit text for downstream summarization
                    queryNormalized: normalized,
                    summaryQuery,
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

            const captionQueue: typeof instructions = [];
            const orderedInstructions: typeof instructions = [];
            for (const step of instructions) {
              if (step?.type === "captions.generate") {
                captionQueue.push(step);
              } else {
                orderedInstructions.push(step);
              }
            }
            orderedInstructions.push(...captionQueue);

            safeSend({
              event: "log",
              message: `Planned ${orderedInstructions.length} step(s)`,
            });

            if (orderedInstructions.length === 0) {
              thoughtAbort.abort();
              if (!thoughtDone) {
                safeSend({ event: "thought_done" });
              }
              safeSend({ event: "error", message: "No steps planned" });
              safeClose();
              return;
            }

            // Wait for thinking to complete based on mode
            const strictMode = env.AGENT_THOUGHT_STRICT === "true";
            if (strictMode) {
              // Wait for full thinking paragraph before executing steps
              const timeout = env.AGENT_THINKING_TIMEOUT_MS;
              const completed = await waitUntil(() => thoughtDone, timeout);
              if (!completed) {
                // Timeout - proceed anyway but log it
                safeSend({
                  event: "log",
                  message: "Thinking timeout - proceeding with steps",
                });
              }
            } else {
              // Soft mode - abort thinking immediately before first step
              thoughtAbort.abort();
              if (!thoughtDone) {
                safeSend({ event: "thought_done" });
              }
            }

            // Stream each planned step
            for (let i = 0; i < orderedInstructions.length; i++) {
              safeSend({
                event: "step",
                stepIndex: i,
                totalSteps: orderedInstructions.length,
                instruction: orderedInstructions[i],
              });
            }

            safeSend({ event: "done", message: "All steps dispatched" });
            safeClose();
          })
          .catch((err) => {
            thoughtAbort.abort();
            if (!thoughtDone) {
              safeSend({ event: "thought_done" });
            }
            safeSend({
              event: "error",
              message: err instanceof Error ? err.message : "Planner failed",
            });
            safeClose();
          });
      } catch (error) {
        // Handle any errors during processing
        // We are outside the lexical scope of thoughtAbort/thoughtDone here on some engines.
        // Just send a generic error and close safely.
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
