import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const bullets = Array.isArray(body?.bullets)
      ? (body.bullets as string[])
      : [];
    const actions = Array.isArray(body?.actions) ? (body.actions as any[]) : [];

    const heuristic = bullets.length
      ? `Completed edits: ${bullets.join("; ")}.`
      : "Made small timeline adjustments.";

    if (!env.OPENAI_API_KEY) {
      return NextResponse.json({ summary: heuristic });
    }

    const system =
      "You are a helpful video editing assistant. Speak in first-person as the editor. Summarize only what you actually did. If a TwelveLabs search query is present, begin with 'I first analyzed the video to find …' and blend the query text smoothly into that sentence. Use the query string exactly as provided: do not add quotation marks unless they already appear in the string, and never add extra words like 'phrase'. Example: query dogs playing -> 'I first analyzed the video to find dogs playing…'; query \"dogs playing\" -> 'I first analyzed the video to find \"dogs playing\"…'. Then describe concrete edits with timeline timestamps (e.g., 'I removed 12.37–21.07s'). For captions, say you added captions to match the spoken audio. No tool names, no steps, no speculation. Keep 1–2 concise sentences.";

    const describeTrimSide = (side: any, position: "left" | "right"): string => {
      if (!side) return "";

      const label = position === "left" ? "left edge" : "right edge";

      const secondsText = (value: number | undefined) =>
        value !== undefined ? `${formatSeconds(value)}s` : undefined;

      switch (side.mode) {
        case "deltaSeconds":
          return secondsText(side.delta)
            ? `${label} by ${secondsText(side.delta)}`
            : `${label} (${side.mode})`;
        case "toSeconds":
          return secondsText(side.time)
            ? `${label} to ${secondsText(side.time)}`
            : `${label} (${side.mode})`;
        case "toPlayhead":
          return `${label} to playhead`;
        case "deltaFrames":
          return typeof side.frames === "number"
            ? `${label} by ${side.frames} frame${side.frames === 1 ? "" : "s"}`
            : `${label} (${side.mode})`;
        default: {
          const extras = Object.entries(side)
            .filter(([key]) => key !== "mode")
            .map(([key, value]) => `${key}=${value}`)
            .join(", ");
          return extras ? `${label} (${side.mode}: ${extras})` : `${label} (${side.mode})`;
        }
      }
    };

    const formatSeconds = (value: number): string => {
      if (!Number.isFinite(value)) return "0";
      const scaled = Math.round(value * 100) / 100;
      return Number.isInteger(scaled) ? `${Math.trunc(scaled)}` : `${scaled}`;
    };

    const renderAction = (a: any): string => {
      if (a?.kind === "cut") {
        const s = Number(a?.range?.start ?? 0);
        const e = Number(a?.range?.end ?? 0);
        const viaSearch =
          a?.meta?.source === "twelvelabs"
            ? a?.meta?.searchSummary
              ? ` via search${a?.meta?.searchWasQuoted ? " (quoted)" : " (no quotes)"} ${a.meta.searchSummary}`
              : " via search"
            : "";
        return `Cut: ${s.toFixed(2)}-${e.toFixed(2)}s${viaSearch}`;
      }
      if (a?.kind === "trim") {
        const left = describeTrimSide(a?.sides?.left, "left");
        const right = describeTrimSide(a?.sides?.right, "right");
        const parts = [left, right].filter(Boolean).join(" & ");
        const targetPhrase = `${a?.targetCount ?? 1} clip${
          (a?.targetCount ?? 1) === 1 ? "" : "s"
        }`;
        return parts
          ? `Trim: ${parts} on ${targetPhrase}`
          : `Trim: adjusted ${targetPhrase}`;
      }
      if (a?.kind === "captions") return "Captions: added";
      if (a?.kind === "deadspace")
        return `Deadspace: trimmed count=${a.targetCount ?? 1}`;
      return "";
    };

    const structured = actions
      .map(renderAction)
      .filter((s) => s && typeof s === "string");

    const user = structured.length
      ? `Actions:\n${structured.map((s: string) => `- ${s}`).join("\n")}`
      : `Editing actions (bullets):\n${bullets.map((b) => `- ${b}`).join("\n")}`;

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const { safeSend, safeClose } = createSseHelpers(controller);

        try {
          const resp = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: env.OPENAI_MODEL || "gpt-4o-mini",
                messages: [
                  { role: "system", content: system },
                  { role: "user", content: user },
                ],
                temperature: 0.2,
                max_tokens: 120,
                stream: true,
              }),
            }
          );

          if (!resp.ok || !resp.body) {
            safeSend({ event: "summary_delta", delta: heuristic });
            safeSend({ event: "summary_done" });
            safeClose();
            return;
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]") continue;
              if (!trimmed.startsWith("data: ")) continue;

              try {
                const json = JSON.parse(trimmed.slice(6));
                const delta = json?.choices?.[0]?.delta?.content;
                if (delta) {
                  const sanitized = delta.replace(/\r/g, "");
                  if (sanitized) {
                    safeSend({ event: "summary_delta", delta: sanitized });
                  }
                }
              } catch (e) {
                // Ignore parse errors for individual chunks
              }
            }
          }

          safeSend({ event: "summary_done" });
        } catch (error) {
          console.error("Streaming error:", error);
          safeSend({ event: "summary_delta", delta: heuristic });
          safeSend({ event: "summary_done" });
        } finally {
          safeClose();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json({ summary: "Made small timeline adjustments." });
  }
}
