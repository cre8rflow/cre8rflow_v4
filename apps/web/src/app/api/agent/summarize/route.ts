import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const bullets = Array.isArray(body?.bullets) ? (body.bullets as string[]) : [];
    const actions = Array.isArray(body?.actions) ? (body.actions as any[]) : [];

    const heuristic = bullets.length
      ? `Completed edits: ${bullets.join("; ")}.`
      : "Made small timeline adjustments.";

    if (!env.OPENAI_API_KEY) {
      return NextResponse.json({ summary: heuristic });
    }

    const system =
      "You are a helpful video editing assistant. Speak in first-person as the editor. Summarize only what you actually did. If a search phrase is present, say 'I first analyzed the video to find <phrase>' (no quotes) — do NOT mention engines or APIs. Make the phrase fit naturally into the sentence with correct grammar. Then describe concrete edits with timeline timestamps (e.g., 'I removed 12.37–21.07s'). For captions, say you added captions to match the spoken audio. No tool names, no steps, no speculation. Keep 1–2 concise sentences.";

    const renderAction = (a: any): string => {
      if (a?.kind === "cut") {
        const s = Number(a?.range?.start ?? 0);
        const e = Number(a?.range?.end ?? 0);
        const q = a?.meta?.query ? ` phrase=${a.meta.query}` : "";
        const via = a?.meta?.source === "twelvelabs" ? " (search)" : "";
        return `Cut: ${s.toFixed(2)}-${e.toFixed(2)}s${q}${via}`;
      }
      if (a?.kind === "trim") return `Trim: sides=${JSON.stringify(a.sides)} count=${a.targetCount ?? 1}`;
      if (a?.kind === "captions") return "Captions: added";
      if (a?.kind === "deadspace") return `Deadspace: trimmed count=${a.targetCount ?? 1}`;
      return "";
    };

    const structured = actions.map(renderAction).filter((s) => s && typeof s === "string");

    const user = structured.length
      ? `Actions:\n${structured.map((s: string) => `- ${s}`).join("\n")}`
      : `Editing actions (bullets):\n${bullets.map((b) => `- ${b}`).join("\n")}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
      }),
    });
    if (!resp.ok) return NextResponse.json({ summary: heuristic });
    const data = await resp.json();
    let content = data?.choices?.[0]?.message?.content?.trim() as string | undefined;
    if (content) {
      // Remove any double-quote characters (straight or curly) to avoid quoted phrases
      content = content.replace(/["“”]+/g, "");
      // Normalize extra whitespace after removal
      content = content.replace(/\s{2,}/g, " ").trim();
    }
    return NextResponse.json({ summary: content || heuristic });
  } catch {
    return NextResponse.json({ summary: "Made small timeline adjustments." });
  }
}

 