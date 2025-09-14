/**
 * Agent Planner (server-side)
 * Calls OpenAI to turn a natural-language prompt + lightweight metadata
 * into a validated list of edit instructions our client can execute.
 */

import { env } from "@/env";
import type { AgentRequestPayload, AnyInstruction } from "@/types/agent";
import { AnyInstructionSchema } from "@/types/agent";
import { z } from "zod";

// Response schema: { steps: AnyInstruction[] }
const PlannerResponseSchema = z.object({
  steps: z.array(AnyInstructionSchema).min(1).max(20),
});

export type PlannerSource =
  | "openai" // first try succeeded
  | "retry"   // corrective retry succeeded
  | "fallback" // heuristic fallback used
  | "no-key";  // no OPENAI key, heuristic used

export type PlannerResult =
  | {
      ok: true;
      steps: AnyInstruction[];
      source: PlannerSource;
      hint?: string; // brief reason when retry/fallback/no-key used
    }
  | {
      ok: false;
      error: string;
      source?: "openai" | "retry";
      hint?: string;
    };

/**
 * Call OpenAI to get a structured plan. Falls back to mock if unavailable.
 */
export async function planInstructions({
  prompt,
  metadata,
}: AgentRequestPayload): Promise<PlannerResult> {
  const hasKey = !!env.OPENAI_API_KEY;
  if (!hasKey) {
    const fallback = mockPlan(prompt);
    return { ok: true, steps: fallback, source: "no-key" };
  }

  try {
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    // Very strict system prompt with hard constraints
    const system = `You are an editing planner that must output ONLY strict JSON.
Task: Convert the user's prompt and provided metadata into a list of edit instructions our client can execute.

Hard rules:
- Output MUST be a single JSON object with a "steps" array (non-empty).
- Each step MUST be one of:
  - Trim: {"type":"trim","target":TargetSpec,"sides":{"left"?:TrimSide,"right"?:TrimSide},"options"?:TrimOptions,"description"?:string}
  - Cut-out: {"type":"cut-out","target":TargetSpec,"range":RangeSpec,"options"?:CutOutOptions,"description"?:string}
  - Captions: {"type":"captions.generate","language"?:string,"description"?:string}
- TargetSpec (abstract, NO element IDs): one of
  {"kind":"clipAtPlayhead"}
  {"kind":"clipAtTime","time":number}
  {"kind":"lastClip","track"?:"media"|"audio"|"text"|"all"|{"id":string}}
  {"kind":"nthClip","index":number,"track"?:"media"|"audio"|"text"|"all"|{"id":string}}
  {"kind":"clipsOverlappingRange","start":number,"end":number,"track"?:"media"|"audio"|"text"|"all"|{"id":string}}
- RangeSpec: one of
  {"mode":"elementSeconds","start":number,"end":number}
  {"mode":"globalSeconds","start":number,"end":number}
  {"mode":"aroundPlayhead","left":number,"right":number}
- TrimSide: one of
  {"mode":"toSeconds","time":number} | {"mode":"toPlayhead"} | {"mode":"deltaSeconds","delta":number}
- Numbers MUST be numbers (not strings), non-negative.
- Prefer {"mode":"globalSeconds"} when the prompt contains absolute times (e.g., 2–3 seconds).
- IMPORTANT semantic mapping:
  - If the user says "trim the last N seconds" or similar (remove N seconds from the end), use {"mode":"deltaSeconds","delta":N} on the RIGHT side.
  - If the user says "trim to N seconds" or "make it N seconds long", use {"mode":"toSeconds","time":N} on the RIGHT side.
- If the user gives a semantic description that requires understanding video content (e.g., "the man in sunglasses walking in the water"), output a server step first:
  {"type":"twelvelabs.search","query":"<concise semantic phrase>"}.
  Do not guess the time range; the backend will call TwelveLabs and return an applyCut step.
- Do NOT include markdown, code fences, comments, explanations, or extra properties.
- Keep total steps ≤ 6.
`;

    const user = {
      role: "user",
      content: [
        {
          type: "text",
          text: `Prompt:\n${prompt}\n\nMetadata (JSON):\n${JSON.stringify(metadata)}`,
        },
      ],
    } as const;

    // Use json_object format. Note: json_schema is currently not used because
    // OpenAI's schema support disallows union-friendly keywords like oneOf/$ref
    // that we need for our instruction unions.
    const response_format = { type: "json_object" } as const;

    // Use Chat Completions via fetch to avoid adding SDK deps
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          user,
        ],
        temperature: 0,
        response_format,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, error: `OpenAI error ${resp.status}: ${text}`, source: "openai" };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, error: "Empty completion content" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Some models already return object (not string) when json_object used
      parsed = content;
    }

    // First validation
    let validated = PlannerResponseSchema.safeParse(parsed);
    if (!validated.success) {
      // Try a corrective retry with error feedback
      const hint = summarizeZodError(validated.error);
      const retry = await correctiveRetry({ model, system, user, hint });
      if (retry.ok) {
        return { ok: true, steps: normalizePlannedSteps(prompt, retry.steps), source: "retry", hint };
      }

      // Final decision: fallback or error based on env
      if (env.AGENT_PLANNER_FALLBACK !== "false") {
        const fallback = mockPlan(prompt);
        return { ok: true, steps: fallback, source: "fallback", hint };
      }
      return { ok: false, error: `Planner invalid output: ${hint}`, source: "retry", hint };
    }

    return { ok: true, steps: normalizePlannedSteps(prompt, validated.data.steps), source: "openai" };
  } catch (error) {
    // Network or parsing error – retry once without temperature, then decide
    try {
      const model = env.OPENAI_MODEL || "gpt-4o-mini";
      const system = "You must output only valid JSON for {\"steps\": AnyInstruction[]} with no commentary.";
      const resp2 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify({ prompt, metadata }) },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      });
      if (resp2.ok) {
        const data2 = await resp2.json();
        const content2 = data2?.choices?.[0]?.message?.content;
        const parsed2 = typeof content2 === "string" ? JSON.parse(content2) : content2;
        const validated2 = PlannerResponseSchema.safeParse(parsed2);
        if (validated2.success) {
          return { ok: true, steps: normalizePlannedSteps(prompt, validated2.data.steps), source: "retry" };
        }
      }
    } catch {}

    if (env.AGENT_PLANNER_FALLBACK !== "false") {
      const fallback = mockPlan(prompt);
      return { ok: true, steps: fallback, source: "fallback", hint: "network or parse error" };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Planner failed",
      source: "openai",
      hint: "network or parse error",
    };
  }
}

async function correctiveRetry({
  model,
  system,
  user,
  hint,
}: {
  model: string;
  system: string;
  user: { role: "user"; content: any };
  hint: string;
}): Promise<PlannerResult> {
  const correction = {
    role: "system",
    content:
      `Your previous response did not match the schema. Fix these issues: ${hint}. ` +
      `Respond again with ONLY strict JSON for {"steps": AnyInstruction[]}.`,
  } as const;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        user,
        correction,
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    return { ok: false, error: `Retry failed ${resp.status}`, source: "retry" };
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return { ok: false, error: "Empty retry content", source: "retry" };
  const parsed = typeof content === "string" ? JSON.parse(content) : content;

  const validated = PlannerResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, error: summarizeZodError(validated.error), source: "retry" };
  }

  return { ok: true, steps: validated.data.steps, source: "retry" };
}

function summarizeZodError(err: z.ZodError): string {
  const first = err.issues?.[0];
  if (!first) return "unknown error";
  const path = first.path?.join(".") || "root";
  return `${path}: ${first.message}`;
}

// JSON Schema for structured outputs (mirrors zod validator at a high-level)
const plannerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["steps"],
  properties: {
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        oneOf: [
          // Trim instruction
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "target", "sides"],
            properties: {
              type: { const: "trim" },
              target: { $ref: "#/definitions/TargetSpec" },
              sides: {
                type: "object",
                additionalProperties: false,
                properties: {
                  left: { $ref: "#/definitions/TrimSide" },
                  right: { $ref: "#/definitions/TrimSide" },
                },
              },
              options: { $ref: "#/definitions/BaseOptions" },
              description: { type: "string" },
            },
          },
          // Cut-out instruction
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "target", "range"],
            properties: {
              type: { const: "cut-out" },
              target: { $ref: "#/definitions/TargetSpec" },
              range: { $ref: "#/definitions/RangeSpec" },
              options: { $ref: "#/definitions/CutOutOptions" },
              description: { type: "string" },
            },
          },
          // Captions generation instruction
          {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: { const: "captions.generate" },
              language: { type: "string" },
              description: { type: "string" },
            },
          },
        ],
      },
    },
  },
  definitions: {
    TrackFilter: {
      oneOf: [
        { enum: ["media", "audio", "text", "all"] },
        {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      ],
    },
    TargetSpec: {
      oneOf: [
        { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "clipAtPlayhead" } } },
        { type: "object", additionalProperties: false, required: ["kind", "time"], properties: { kind: { const: "clipAtTime" }, time: { type: "number", minimum: 0 } } },
        { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "lastClip" }, track: { $ref: "#/definitions/TrackFilter" } } },
        { type: "object", additionalProperties: false, required: ["kind", "index"], properties: { kind: { const: "nthClip" }, index: { type: "integer", minimum: 1 }, track: { $ref: "#/definitions/TrackFilter" } } },
        { type: "object", additionalProperties: false, required: ["kind", "start", "end"], properties: { kind: { const: "clipsOverlappingRange" }, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 }, track: { $ref: "#/definitions/TrackFilter" } } },
      ],
    },
    RangeSpec: {
      oneOf: [
        { type: "object", additionalProperties: false, required: ["mode", "start", "end"], properties: { mode: { const: "elementSeconds" }, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 } } },
        { type: "object", additionalProperties: false, required: ["mode", "start", "end"], properties: { mode: { const: "globalSeconds" }, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 } } },
        { type: "object", additionalProperties: false, required: ["mode", "left", "right"], properties: { mode: { const: "aroundPlayhead" }, left: { type: "number", minimum: 0 }, right: { type: "number", minimum: 0 } } },
      ],
    },
    TrimSide: {
      oneOf: [
        { type: "object", additionalProperties: false, required: ["mode", "time"], properties: { mode: { const: "toSeconds" }, time: { type: "number", minimum: 0 } } },
        { type: "object", additionalProperties: false, required: ["mode"], properties: { mode: { const: "toPlayhead" } } },
        { type: "object", additionalProperties: false, required: ["mode", "delta"], properties: { mode: { const: "deltaSeconds" }, delta: { type: "number", minimum: 0 } } },
      ],
    },
    BaseOptions: {
      type: "object",
      additionalProperties: false,
      properties: {
        pushHistory: { type: "boolean" },
        showToast: { type: "boolean" },
        clamp: { type: "boolean" },
        dryRun: { type: "boolean" },
        precision: { type: "number" },
      },
    },
    CutOutOptions: {
      allOf: [
        { $ref: "#/definitions/BaseOptions" },
        {
          type: "object",
          additionalProperties: false,
          properties: { ripple: { type: "boolean" } },
        },
      ],
    },
  },
} as const;

// Post-processing normalization to correct common semantic mismatches
import type { AnyInstruction } from "@/types/agent";

function normalizePlannedSteps(prompt: string, steps: AnyInstruction[]): AnyInstruction[] {
  const lower = prompt.toLowerCase();

  // Extract patterns like "last 2 seconds", "last 3s"
  const lastMatch = lower.match(/last\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/);
  const lastSeconds = lastMatch ? parseFloat(lastMatch[1]) : undefined;

  // Extract patterns like "to 2 seconds", "make it 2s long"
  const toMatch = lower.match(/\b(?:to|make it)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/);
  const toSeconds = toMatch ? parseFloat(toMatch[1]) : undefined;

  // Insert captions.generate if the prompt clearly asks for captions/subtitles and planner omitted it
  const wantsCaptions = /(\bcaption\b|\bcaptions\b|\bsubtitle\b|\bsubtitles\b|\badd captions\b|\bcreate captions\b)/.test(lower);
  if (wantsCaptions && !steps.some((s: any) => s.type === "captions.generate")) {
    steps = [{ type: "captions.generate", language: "auto", description: "Generate captions" } as any, ...steps];
  }

  return steps.map((step) => {
    if (step.type === "trim") {
      const cloned: AnyInstruction = JSON.parse(JSON.stringify(step));

      // If prompt suggests "last N seconds", ensure right: deltaSeconds
      if (lastSeconds !== undefined) {
        const right = (cloned as any).sides?.right;
        if (!cloned.sides) cloned.sides = {} as any;
        // Only override if planner used toSeconds incorrectly or omitted right
        if (!right || right.mode !== "deltaSeconds") {
          cloned.sides.right = { mode: "deltaSeconds", delta: lastSeconds } as any;
        }
        // Also ensure target is the last clip on media tracks
        if ((cloned as any).target?.kind !== "lastClip") {
          (cloned as any).target = { kind: "lastClip", track: "media" } as any;
        }
      }

      // If prompt suggests "to N seconds", prefer toSeconds
      if (toSeconds !== undefined) {
        if (!cloned.sides) cloned.sides = {} as any;
        cloned.sides.right = { mode: "toSeconds", time: toSeconds } as any;
      }

      return cloned;
    }
    return step;
  });
}

/**
 * Current heuristic fallback used before OpenAI integration.
 */
function mockPlan(prompt: string): AnyInstruction[] {
  const lower = prompt.toLowerCase();
  const steps: AnyInstruction[] = [] as AnyInstruction[];

  const rangeMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
  const hasCutOut = lower.includes("cut out");
  const trimDeltaMatch = lower.match(/trim.*?by\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/);
  const parsedDelta = trimDeltaMatch ? parseFloat(trimDeltaMatch[1]) : undefined;

  if (hasCutOut && rangeMatch) {
    const start = parseFloat(rangeMatch[1]);
    const end = parseFloat(rangeMatch[2]);
    const normStart = Math.min(start, end);
    const normEnd = Math.max(start, end);

    steps.push({
      type: "cut-out",
      target: { kind: "clipsOverlappingRange", start: normStart, end: normEnd, track: "media" },
      range: { mode: "globalSeconds", start: normStart, end: normEnd },
      description: `Cut out ${normStart}–${normEnd}s across media clips`,
    } as AnyInstruction);

    if (lower.includes("trim") && parsedDelta !== undefined) {
      steps.push({
        type: "trim",
        target: { kind: "lastClip", track: "media" },
        sides: { right: { mode: "deltaSeconds", delta: parsedDelta } },
        description: `Trim ${parsedDelta}s off the last clip`,
      } as AnyInstruction);
    }
  }

  const trimMatch = lower.match(/trim.*?(\d+)(?:st|nd|rd|th).*?clip/);
  if (trimMatch) {
    const clipIndex = parseInt(trimMatch[1], 10);
    const deltaMatch = lower.match(/by\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/);
    const delta = deltaMatch ? parseFloat(deltaMatch[1]) : 0.5;
    steps.push({
      type: "trim",
      target: { kind: "nthClip", index: clipIndex, track: "media" },
      sides: { right: { mode: "deltaSeconds", delta } },
      description: `Trim ${delta}s from the ${clipIndex}${getOrdinalSuffix(clipIndex)} clip`,
    } as AnyInstruction);
  }

  if (steps.length === 0) {
    steps.push({
      type: "trim",
      target: { kind: "clipAtPlayhead" },
      sides: { right: { mode: "deltaSeconds", delta: 1 } },
      description: "Fallback: trim 1s from clip at playhead",
    } as AnyInstruction);
  }

  return steps;
}

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
