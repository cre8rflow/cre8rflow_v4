import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { baseRateLimit } from "@/lib/rate-limit";
import { isTranscriptionConfigured } from "@/lib/transcription-utils";

const trimRequestSchema = z.object({
  filename: z.string().min(1, "Filename is required"),
  language: z.string().optional().default("auto"),
  prePadding: z.number().min(0).max(1).optional().default(0.08),
  postPadding: z.number().min(0).max(1).optional().default(0.6),
  aggressiveness: z.number().int().min(0).max(3).optional().default(3),
  frameMs: z.number().int().min(10).max(30).optional().default(30),
  decryptionKey: z.string().min(1).optional(),
  iv: z.string().min(1).optional(),
});

const modalResponseSchema = z.object({
  speechDetected: z.boolean(),
  speechStart: z.number(),
  speechEnd: z.number(),
  speechDuration: z.number(),
  trimStart: z.number(),
  trimEnd: z.number(),
  duration: z.number(),
  confidence: z.number().optional(),
  padding: z
    .object({
    pre: z.number().optional(),
    post: z.number().optional(),
  })
    .optional(),
  analysisSource: z.enum(["vad", "transcript"]).optional(),
  transcript: z
    .object({
      start: z.number().nullable().optional(),
      end: z.number().nullable().optional(),
      segments: z
        .array(
          z.object({
            start: z.number(),
            end: z.number(),
            text: z.string(),
            words: z
              .array(
                z.object({
                  start: z.number(),
                  end: z.number(),
                  text: z.string(),
                })
              )
              .optional(),
            firstWordStart: z.number().optional(),
            lastWordEnd: z.number().optional(),
          })
        )
        .optional(),
      error: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
  traceback: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
    const { success } = await baseRateLimit.limit(ip);

    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    if (!env.MODAL_DEADSPACE_URL) {
      return NextResponse.json(
        {
          error: "Deadspace trim service not configured",
          message:
            "Set MODAL_DEADSPACE_URL to enable server-side dead space trimming.",
        },
        { status: 503 }
      );
    }

    const transcriptionCheck = isTranscriptionConfigured();
    if (!transcriptionCheck.configured) {
      return NextResponse.json(
        {
          error: "Missing transcription configuration",
          message: `Dead space trimming requires environment variables: ${transcriptionCheck.missingVars.join(", ")}`,
        },
        { status: 503 }
      );
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const validationResult = trimRequestSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request parameters",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

  const {
    filename,
    language,
    prePadding,
    postPadding,
    aggressiveness,
    frameMs,
    decryptionKey,
      iv,
    } = validationResult.data;

    const modalRequestBody: Record<string, unknown> = {
      filename,
      language,
      prePadding,
      postPadding,
      aggressiveness,
      frameMs,
    };

    if (decryptionKey && iv) {
      modalRequestBody.decryptionKey = decryptionKey;
      modalRequestBody.iv = iv;
    }

    const response = await fetch(env.MODAL_DEADSPACE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(modalRequestBody),
    });

    const rawText = await response.text().catch(() => null);
    let rawResult: unknown = null;
    if (typeof rawText === "string" && rawText.length > 0) {
      try {
        rawResult = JSON.parse(rawText);
      } catch (parseError) {
        console.error("Failed to parse Modal deadspace response JSON:", parseError);
      }
    }

    if (env.NODE_ENV !== "production") {
      console.debug("[api/trim-deadspace] Modal response:", rawResult ?? rawText);
    }

    if (!response.ok) {
      const message =
        (rawResult && typeof rawResult === "object" && rawResult !== null && "error" in rawResult
          ? (rawResult as any).error
          : undefined) ||
        `Deadspace service error (${response.status})`;
      return NextResponse.json(
        {
          error: message,
          message: "Failed to process deadspace trim request",
        },
        { status: response.status >= 500 ? 502 : response.status }
      );
    }

    if (!rawResult || typeof rawResult !== "object") {
      console.error("Modal deadspace response not JSON object:", rawText);
      return NextResponse.json(
        { error: "Invalid response from deadspace service" },
        { status: 502 }
      );
    }

    const modalValidation = modalResponseSchema.safeParse(rawResult);
    if (modalValidation.success) {
      return NextResponse.json(modalValidation.data);
    }

    const derived = deriveDeadspaceFromTranscript(rawResult, {
      prePadding,
      postPadding,
    });

    if (!derived) {
      console.error("Invalid Modal deadspace response:", modalValidation.error);
      return NextResponse.json(
        { error: "Invalid response from deadspace service" },
        { status: 502 }
      );
    }

    return NextResponse.json(derived);
  } catch (error) {
    console.error("Deadspace trim API error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred during deadspace trimming",
      },
      { status: 500 }
    );
  }
}

function deriveDeadspaceFromTranscript(
  raw: any,
  options: { prePadding: number; postPadding: number }
) {
  const segmentsInput = raw?.segments;
  if (!Array.isArray(segmentsInput) || segmentsInput.length === 0) {
    return null;
  }

  const segments = segmentsInput
    .map((seg: any) => {
      const words = Array.isArray(seg?.words) ? seg.words : [];
      const wordStarts = words
        .map((w: any) => Number(w?.start))
        .filter((value) => Number.isFinite(value));
      const wordEnds = words
        .map((w: any) => Number(w?.end))
        .filter((value) => Number.isFinite(value));

      const start = [
        Number(seg?.firstWordStart),
        wordStarts.length > 0 ? Math.min(...wordStarts) : undefined,
        Number(seg?.start),
      ].find((value) => Number.isFinite(value)) as number | undefined;

      const end = [
        Number(seg?.lastWordEnd),
        wordEnds.length > 0 ? Math.max(...wordEnds) : undefined,
        Number(seg?.end),
      ].find((value) => Number.isFinite(value)) as number | undefined;

      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      const text = typeof seg?.text === "string" ? seg.text.trim() : "";
      return { start, end, text };
    })
    .filter((seg: { start: number; end: number; text: string } | null) =>
      seg && seg.end > seg.start
    ) as Array<{ start: number; end: number; text: string }>;

  if (segments.length === 0) {
    return null;
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const speechStart = first.start;
  const speechEnd = last.end;

  const totalDurationRaw = Number(raw?.duration);
  const totalDuration = Number.isFinite(totalDurationRaw)
    ? totalDurationRaw
    : speechEnd;

  const MIN_PRE_BUFFER = 0.08;
  const trimStart = Math.max(
    0,
    speechStart - Math.max(options.prePadding, MIN_PRE_BUFFER)
  );
  const MIN_POST_BUFFER = 0.2;
  const trimEnd = Math.min(
    totalDuration,
    speechEnd + Math.max(options.postPadding, MIN_POST_BUFFER)
  );

  if (!(trimEnd > trimStart)) {
    return null;
  }

  const payload = {
    speechDetected: true,
    speechStart,
    speechEnd,
    speechDuration: Math.max(0, speechEnd - speechStart),
    trimStart,
    trimEnd,
    duration: totalDuration,
    confidence: 0.5,
    padding: {
      pre: options.prePadding,
      post: options.postPadding,
    },
    analysisSource: "transcript" as const,
    transcript: {
      start: speechStart,
      end: speechEnd,
      segments: segments.map((seg) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text,
      })),
    },
  };

  const validation = modalResponseSchema.safeParse(payload);
  if (!validation.success) {
    console.error(
      "Derived transcript payload failed validation:",
      validation.error
    );
    return null;
  }

  return validation.data;
}
