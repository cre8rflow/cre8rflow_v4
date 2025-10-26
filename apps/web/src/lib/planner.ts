/**
 * Agent Planner (server-side)
 * Calls OpenAI to turn a natural-language prompt + lightweight metadata
 * into a validated list of edit instructions our client can execute.
 */

import { env } from "@/env";
import type { AgentRequestPayload, TargetSpec } from "@/types/agent";
import { AnyInstructionSchema, type AnyInstruction } from "@/types/agent";
import { z } from "zod";

// Response schema: { steps: AnyInstruction[] }
const PlannerResponseSchema = z.object({
  steps: z.array(AnyInstructionSchema).min(1).max(20),
});

export type PlannerSource =
  | "openai" // first try succeeded
  | "retry" // corrective retry succeeded
  | "rule"; // deterministic shortcut

export type PlannerResult =
  | {
      ok: true;
      steps: AnyInstruction[];
      source: PlannerSource;
      hint?: string; // brief reason when retry used
    }
  | {
      ok: false;
      error: string;
      source?: "openai" | "retry";
      hint?: string;
    };

/**
 * Call OpenAI to get a structured plan.
 */
export async function planInstructions({
  prompt,
  metadata,
}: AgentRequestPayload): Promise<PlannerResult> {
  if (!env.OPENAI_API_KEY) {
    return {
      ok: false,
      error: "OpenAI API key not configured",
    };
  }

  const wantsDeadspaceOnly =
    /(dead\s*space|remove\s+silence|trim\s+silence|cut\s+silence|silence\s+(at\s+)?(start|beginning)\s*(and|&|\+)\s*(end|finish))/i.test(
      prompt
    ) &&
    !/(\band\b|\balso\b|\bplus\b|\bthen\b|\bafter\b|\bcaption\b|\bsubtitle\b|\bcolor\b|\bgrade\b|\bcrop\b|\bhighlight\b|\bmusic\b|\bsync\b)/i.test(
      prompt
    );

  if (wantsDeadspaceOnly) {
    const defaultSteps: AnyInstruction[] = [
      {
        type: "deadspace.trim",
        target: {
          kind: "clipsOverlappingRange",
          start: 0,
          end: 1e9,
          track: "media",
        },
        description: "Trim dead space at start and end across media clips",
      },
    ];

    return {
      ok: true,
      steps: normalizePlannedSteps(prompt, defaultSteps),
      source: "rule",
    };
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
  - Deadspace: {"type":"deadspace.trim","target":TargetSpec,"language"?:string,"description"?:string}
- TargetSpec (abstract, NO element IDs): one of
  {"kind":"clipAtPlayhead"}
  {"kind":"clipAtTime","time":number}
  {"kind":"lastClip","track"?:"media"|"audio"|"text"|"all"|{"id":string}}
  {"kind":"nthClip","index":number,"track"?:"media"|"audio"|"text"|"all"|{"id":string}}
    NOTE: index is 1-based (first clip = 1, second = 2, etc.). 0 will be auto-corrected to 1.
  {"kind":"clipsOverlappingRange","start":number,"end":number,"track"?:"media"|"audio"|"text"|"all"|{"id":string}}
- RangeSpec: one of
  {"mode":"elementSeconds","start":number,"end":number}
  {"mode":"globalSeconds","start":number,"end":number}
  {"mode":"aroundPlayhead","left":number,"right":number}
- TrimSide: REQUIRED fields per mode:
  {"mode":"toSeconds","time":number} - time is REQUIRED
  {"mode":"toPlayhead"} - no additional fields
  {"mode":"deltaSeconds","delta":number} - delta is REQUIRED
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
        messages: [{ role: "system", content: system }, user],
        temperature: 0,
        response_format,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `OpenAI error ${resp.status}: ${text}`,
        source: "openai",
      };
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
    const validated = PlannerResponseSchema.safeParse(parsed);
    if (!validated.success) {
      // Try a corrective retry with error feedback
      const hint = summarizeZodError(validated.error);
      const retry = await correctiveRetry({ model, system, user, hint });
      if (retry.ok) {
        return {
          ok: true,
          steps: normalizePlannedSteps(prompt, retry.steps),
          source: "retry",
          hint,
        };
      }

      return {
        ok: false,
        error: `Planner invalid output: ${hint}`,
        source: "retry",
        hint,
      };
    }

    return {
      ok: true,
      steps: normalizePlannedSteps(prompt, validated.data.steps),
      source: "openai",
    };
  } catch (error) {
    let lastError =
      error instanceof Error ? error : new Error("Planner failed");

    try {
      const model = env.OPENAI_MODEL || "gpt-4o-mini";
      const system =
        'You must output only valid JSON for {"steps": AnyInstruction[]} with no commentary.';
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

      if (!resp2.ok) {
        const text = await resp2.text().catch(() => "");
        lastError = new Error(
          `OpenAI retry error ${resp2.status}: ${text || "no response body"}`
        );
      } else {
        const data2 = await resp2.json();
        const content2 = data2?.choices?.[0]?.message?.content;

        let parsed2: unknown = content2;
        if (typeof content2 === "string") {
          try {
            parsed2 = JSON.parse(content2);
          } catch (parseError) {
            throw new Error(
              `Retry completion parsing failed: ${(parseError as Error).message}`
            );
          }
        }

        const validated2 = PlannerResponseSchema.safeParse(parsed2);
        if (validated2.success) {
          return {
            ok: true,
            steps: normalizePlannedSteps(prompt, validated2.data.steps),
            source: "retry",
          };
        }

        const retryHint = summarizeZodError(validated2.error);
        lastError = new Error(`Planner retry invalid output: ${retryHint}`);
      }
    } catch (retryError) {
      if (retryError instanceof Error) {
        lastError = retryError;
      } else {
        lastError = new Error("Planner retry failed");
      }
    }

    return {
      ok: false,
      error: lastError.message,
      source: "openai",
      hint: lastError.message,
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
      messages: [{ role: "system", content: system }, user, correction],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    return { ok: false, error: `Retry failed ${resp.status}`, source: "retry" };
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content)
    return { ok: false, error: "Empty retry content", source: "retry" };
  const parsed = typeof content === "string" ? JSON.parse(content) : content;

  const validated = PlannerResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: summarizeZodError(validated.error),
      source: "retry",
    };
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
          // Deadspace trim instruction
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "target"],
            properties: {
              type: { const: "deadspace.trim" },
              target: { $ref: "#/definitions/TargetSpec" },
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
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "clipAtPlayhead" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "time"],
          properties: {
            kind: { const: "clipAtTime" },
            time: { type: "number", minimum: 0 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: { const: "lastClip" },
            track: { $ref: "#/definitions/TrackFilter" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "index"],
          properties: {
            kind: { const: "nthClip" },
            index: { type: "integer", minimum: 0 },
            track: { $ref: "#/definitions/TrackFilter" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "start", "end"],
          properties: {
            kind: { const: "clipsOverlappingRange" },
            start: { type: "number", minimum: 0 },
            end: { type: "number", minimum: 0 },
            track: { $ref: "#/definitions/TrackFilter" },
          },
        },
      ],
    },
    RangeSpec: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "start", "end"],
          properties: {
            mode: { const: "elementSeconds" },
            start: { type: "number", minimum: 0 },
            end: { type: "number", minimum: 0 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "start", "end"],
          properties: {
            mode: { const: "globalSeconds" },
            start: { type: "number", minimum: 0 },
            end: { type: "number", minimum: 0 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "left", "right"],
          properties: {
            mode: { const: "aroundPlayhead" },
            left: { type: "number", minimum: 0 },
            right: { type: "number", minimum: 0 },
          },
        },
      ],
    },
    TrimSide: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "time"],
          properties: {
            mode: { const: "toSeconds" },
            time: { type: "number", minimum: 0 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["mode"],
          properties: {
            mode: { const: "toPlayhead" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "delta"],
          properties: {
            mode: { const: "deltaSeconds" },
            delta: { type: "number", minimum: 0 },
          },
        },
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

function canonicalInstructionKey(instr: AnyInstruction): string {
  const clone = JSON.parse(JSON.stringify(instr));
  delete (clone as any).description;
  if (
    (clone as any).options &&
    Object.keys((clone as any).options).length === 0
  ) {
    delete (clone as any).options;
  }
  return JSON.stringify(clone);
}

function normalizePlannedSteps(
  prompt: string,
  steps: AnyInstruction[]
): AnyInstruction[] {
  const lower = prompt.toLowerCase();
  const explicitRange = extractExplicitTimeRange(prompt);
  const mentionsCutOut =
    /\bcut\s*out\b/.test(lower) ||
    (/\bremove\b/.test(lower) && /\bseconds?\b/.test(lower));
  const simpleRangeCutRequest = !!explicitRange && mentionsCutOut;

  // Extract patterns like "last 2 seconds", "last 3s"
  const lastMatch = lower.match(
    /last\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/
  );
  let lastSeconds = lastMatch ? parseFloat(lastMatch[1]) : undefined;
  if (lastSeconds === undefined) {
    if (/last\s+(?:a|one)\s+(?:second|sec)\b/.test(lower)) {
      lastSeconds = 1;
    } else if (/last\s+(?:half|0\.5)\s+(?:second|sec)\b/.test(lower)) {
      lastSeconds = 0.5;
    }
  }

  // Extract patterns like "to 2 seconds", "make it 2s long"
  const toMatch = lower.match(
    /\b(?:to|make it)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/
  );
  const toSeconds = toMatch ? parseFloat(toMatch[1]) : undefined;

  // Insert captions.generate if the prompt clearly asks for captions/subtitles and planner omitted it
  const wantsCaptions =
    /(\bcaption\b|\bcaptions\b|\bsubtitle\b|\bsubtitles\b|\badd captions\b|\bcreate captions\b)/.test(
      lower
    );
  if (
    wantsCaptions &&
    !steps.some((s: any) => s.type === "captions.generate")
  ) {
    steps = [
      ...steps,
      {
        type: "captions.generate",
        language: "auto",
        description: "Generate captions",
      } as any,
    ];
  }

  // Insert deadspace.trim if user asks to remove dead space / silence at start & end
  const wantsDeadspace =
    /(dead\s*space|remove\s+silence|trim\s+silence|cut\s+silence|silence\s+(at\s+)?(start|beginning)\s*(and|&|\+)\s*(end|finish))/i.test(
      lower
    );
  if (wantsDeadspace && !steps.some((s: any) => s.type === "deadspace.trim")) {
    steps = [
      {
        type: "deadspace.trim",
        target: {
          kind: "clipsOverlappingRange",
          start: 0,
          end: 1e9,
          track: "media",
        },
        description: "Trim dead space at start and end across media clips",
      } as any,
      ...steps,
    ];
  }

  const referencesEachClip =
    /\b(each|every)\s+(clip|clips|video|videos|segment|segments)\b/.test(lower);

  const captionSteps: AnyInstruction[] = [];
  const nonCaptionSteps = steps.filter((step) => {
    if ((step as any).type === "captions.generate") {
      captionSteps.push(step);
      return false;
    }
    return true;
  });

  let normalizedSteps = nonCaptionSteps.map((step) => {
    if (step.type === "trim") {
      const cloned = JSON.parse(JSON.stringify(step)) as typeof step;
      let scopeChangedToLast = false;

      if (referencesEachClip) {
        cloned.target = {
          kind: "clipsOverlappingRange",
          start: 0,
          end: 1e9,
          track: "media",
        };
      }

      // If prompt suggests "last N seconds", ensure right: deltaSeconds
      if (lastSeconds !== undefined) {
        const right = cloned.sides?.right;
        if (!cloned.sides) cloned.sides = {};
        // Only override if planner used toSeconds incorrectly or omitted right
        if (!right || right.mode !== "deltaSeconds") {
          cloned.sides.right = { mode: "deltaSeconds", delta: lastSeconds };
        }
        // Adjust target scope based on prompt
        if (!referencesEachClip && cloned.target?.kind !== "lastClip") {
          cloned.target = { kind: "lastClip", track: "media" };
          scopeChangedToLast = true;
        }
      }

      // If prompt suggests "to N seconds", prefer toSeconds
      if (toSeconds !== undefined) {
        if (!cloned.sides) cloned.sides = {};
        cloned.sides.right = { mode: "toSeconds", time: toSeconds };
      }

      if (referencesEachClip || scopeChangedToLast) {
        normalizeTrimDescription(cloned, referencesEachClip);
      }

      return cloned;
    }
    return step;
  });

  if (lastSeconds !== undefined) {
    const deltaTolerance = Math.max(0.2, lastSeconds * 0.15);
    const convertTailCutToTrim = (
      step: Extract<AnyInstruction, { type: "cut-out" }>
    ): AnyInstruction => {
      const trimTarget: TargetSpec = referencesEachClip
        ? {
            kind: "clipsOverlappingRange",
            start: 0,
            end: 1e9,
            track: "media",
          }
        : { kind: "lastClip", track: "media" };

      const baseOptions = step.options
        ? {
            pushHistory: step.options?.pushHistory,
            showToast: step.options?.showToast,
            clamp: step.options?.clamp,
            dryRun: step.options?.dryRun,
            precision: step.options?.precision,
          }
        : undefined;

      return {
        type: "trim",
        target: trimTarget,
        sides: { right: { mode: "deltaSeconds", delta: lastSeconds } },
        options: baseOptions,
        description:
          (step as any).description ??
          (referencesEachClip
            ? `Trim ${formatSeconds(lastSeconds)}s from each clip`
            : `Trim ${formatSeconds(lastSeconds)}s from the last clip`),
      } as AnyInstruction;
    };

    normalizedSteps = normalizedSteps.map((step) => {
      if (step.type !== "cut-out") return step;

      let rangeDuration: number | null = null;
      switch (step.range.mode) {
        case "aroundPlayhead": {
          rangeDuration = step.range.left + step.range.right;
          break;
        }
        case "globalSeconds":
        case "elementSeconds": {
          rangeDuration = Math.abs(step.range.end - step.range.start);
          break;
        }
        default:
          rangeDuration = null;
      }

      if (
        rangeDuration == null
      ) {
        return step;
      }

      const matchesLastSeconds =
        Math.abs(rangeDuration - lastSeconds) <= deltaTolerance;

      const tailTargetKinds = new Set([
        "lastClip",
        "clipAtPlayhead",
        "nthClip",
        "clipsOverlappingRange",
      ]);
      const targetKind = step.target?.kind;
      const targetSuggestsTail =
        targetKind && tailTargetKinds.has(targetKind) && !explicitRange;

      const targetSpan =
        step.target?.kind === "clipsOverlappingRange"
          ? Math.abs(step.target.end - step.target.start)
          : undefined;

      const coversEntireTarget =
        !explicitRange &&
        targetSpan !== undefined &&
        targetSpan > 0 &&
        Math.abs(rangeDuration - targetSpan) <=
          Math.max(0.5, targetSpan * 0.05);

      if (!matchesLastSeconds && !coversEntireTarget && !targetSuggestsTail) {
        return step;
      }

      return convertTailCutToTrim(step);
    });
  }

  if (simpleRangeCutRequest && explicitRange) {
    const { start, end } = explicitRange;
    let cutOutFound = false;

    normalizedSteps = normalizedSteps.map((step) => {
      if (step.type !== "cut-out") return step;

      cutOutFound = true;
      const existingTarget =
        step.target ?? ({ kind: "clipsOverlappingRange", start, end } as const);
      const targetTrack =
        ("track" in existingTarget && existingTarget.track) ||
        (existingTarget.kind === "clipsOverlappingRange"
          ? existingTarget.track
          : undefined) ||
        "media";

      return {
        ...step,
        target: {
          kind: "clipsOverlappingRange",
          start,
          end,
          track: targetTrack,
        },
        range: {
          mode: "globalSeconds",
          start,
          end,
        },
      } as AnyInstruction;
    });

    normalizedSteps = normalizedSteps.filter(
      (step) => step.type !== "twelvelabs.search"
    );

    if (!cutOutFound) {
      normalizedSteps = [
        ...normalizedSteps,
        {
          type: "cut-out",
          target: {
            kind: "clipsOverlappingRange",
            start,
            end,
            track: "media",
          },
          range: {
            mode: "globalSeconds",
            start,
            end,
          },
          description: `Cut out ${formatSeconds(start)}–${formatSeconds(end)}s across media clips`,
        } as AnyInstruction,
      ];
    }
  }

  if (lastSeconds !== undefined) {
    const hasTrim = normalizedSteps.some((step) => step.type === "trim");
    if (!hasTrim) {
      const trimTarget: TargetSpec = referencesEachClip
        ? { kind: "clipsOverlappingRange", start: 0, end: 1e9, track: "media" }
        : { kind: "lastClip", track: "media" };
      const trimInstruction: AnyInstruction = {
        type: "trim",
        target: trimTarget,
        sides: { right: { mode: "deltaSeconds", delta: lastSeconds } },
        description: referencesEachClip
          ? `Trim ${formatSeconds(lastSeconds)}s from each clip`
          : `Trim ${formatSeconds(lastSeconds)}s from the last clip`,
      } as AnyInstruction;

      if (mentionsCutOut) {
        normalizedSteps.push(trimInstruction);
      } else {
        const cutOutIndex = normalizedSteps.findIndex(
          (step) => step.type === "cut-out"
        );
        if (cutOutIndex !== -1) {
          normalizedSteps.splice(cutOutIndex, 1, trimInstruction);
        } else {
          normalizedSteps.push(trimInstruction);
        }
      }
    }
  }

  const seen = new Set<string>();
  const result: AnyInstruction[] = [];
  for (const step of normalizedSteps) {
    const key = canonicalInstructionKey(step);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(step);
  }
  for (const step of normalizedSteps) {
    const key = canonicalInstructionKey(step);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(step);
  }

  if (captionSteps.length) {
    for (const step of captionSteps) {
      const key = canonicalInstructionKey(step);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(step);
    }
  }

  return result;
}

const EACH_SCOPE_REGEX =
  /\b(each|every)\s+(clip|clips|video|videos|segment|segments)\b/i;
const LAST_SCOPE_REGEX =
  /\b(last|final)\s+(clip|clips|video|videos|segment|segments)\b/i;

function normalizeTrimDescription(
  instruction: Extract<AnyInstruction, { type: "trim" }>,
  referencesEachClip: boolean
) {
  const description = instruction.description ?? "";
  const mentionsEachScope = EACH_SCOPE_REGEX.test(description);
  const mentionsLastScope = LAST_SCOPE_REGEX.test(description);

  const shouldUpdate = referencesEachClip
    ? !mentionsEachScope
    : mentionsEachScope;

  if (!shouldUpdate) {
    return;
  }

  instruction.description = buildTrimScopeDescription(
    instruction,
    referencesEachClip ? "each clip" : "the last clip"
  );
}

function buildTrimScopeDescription(
  instruction: Extract<AnyInstruction, { type: "trim" }>,
  scopeLabel: string
): string {
  const sides = instruction.sides ?? {};
  const left = sides.left;
  const right = sides.right;

  const leftDelta =
    left?.mode === "deltaSeconds" && typeof left.delta === "number"
      ? left.delta
      : undefined;
  const rightDelta =
    right?.mode === "deltaSeconds" && typeof right.delta === "number"
      ? right.delta
      : undefined;

  if (leftDelta !== undefined && rightDelta !== undefined) {
    return `Trim ${formatSeconds(leftDelta)}s from the start and ${formatSeconds(rightDelta)}s from the end of ${scopeLabel}`;
  }

  if (leftDelta !== undefined) {
    return `Trim ${formatSeconds(leftDelta)}s from the start of ${scopeLabel}`;
  }

  if (rightDelta !== undefined) {
    return `Trim ${formatSeconds(rightDelta)}s from ${scopeLabel}`;
  }

  if (right?.mode === "toSeconds" && typeof right.time === "number") {
    return `Trim ${scopeLabel} to ${formatSeconds(right.time)}s`;
  }

  if (left?.mode === "toSeconds" && typeof left.time === "number") {
    return `Trim the start of ${scopeLabel} to ${formatSeconds(left.time)}s`;
  }

  return `Trim ${scopeLabel}`;
}

function extractExplicitTimeRange(
  text: string
): { start: number; end: number } | null {
  const rangeRegex =
    /(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(?:s|sec|secs|seconds))?\s*(?:-|–|to)\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(?:s|sec|secs|seconds))?/i;

  const match = text.match(rangeRegex);
  if (!match) return null;

  const start = parseTimeToken(match[1]);
  const end = parseTimeToken(match[2]);
  if (start == null || end == null) return null;

  const normStart = Math.max(0, Math.min(start, end));
  const normEnd = Math.max(0, Math.max(start, end));
  if (normEnd <= normStart) return null;

  return { start: normStart, end: normEnd };
}

function parseTimeToken(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(trimmed)) {
    const segments = trimmed.split(":");
    let multiplier = 1;
    let total = 0;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const value = parseFloat(segments[i]);
      if (Number.isNaN(value)) {
        return null;
      }
      total += value * multiplier;
      multiplier *= 60;
    }
    return total;
  }

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const value = parseFloat(trimmed);
    return Number.isNaN(value) ? null : value;
  }

  return null;
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}
