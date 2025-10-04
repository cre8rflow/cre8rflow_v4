/**
 * Client-side instruction executor for the agentic edit system
 * Executes instructions by resolving targets and calling existing trim/cut-out commands
 */

import type { AnyInstruction, AgentInstruction } from "@/types/agent";
import { trim, cutOut } from "@/lib/commands";
import {
  resolveTargets,
  describeTargetSpec,
  describeTargets,
} from "./agent-resolver";
import { useTimelineStore } from "@/stores/timeline-store";
import { toast } from "sonner";
import { isAgentInstruction, isServerInstruction } from "@/types/agent";
import { useMediaStore } from "@/stores/media-store";
import { encryptWithRandomKey, arrayBufferToBase64 } from "@/lib/zk-encryption";
import { extractTimelineAudio } from "@/lib/mediabunny-utils";
import { DEFAULT_TEXT_ELEMENT } from "@/constants/text-constants";
import { extractElementAudio } from "@/lib/mediabunny-utils";
import {
  emitCaptionHighlights,
  emitTrimHighlights,
  emitCutHighlights,
} from "@/lib/timeline-highlights";
import { useAgentUIStore } from "@/stores/agent-ui-store";
import { useTimelineCommandStore } from "@/stores/timeline-command-store";
import type { CommandEffect } from "@/stores/timeline-command-store";

// =============================================================================
// RESULT TYPES
// =============================================================================

export interface ExecutionResult {
  success: true;
  targetsResolved: number;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface ExecutionError {
  success: false;
  error: string;
  targetsResolved?: number;
  meta?: Record<string, unknown>;
}

export type ExecutionOutcome = ExecutionResult | ExecutionError;

// =============================================================================
// MAIN EXECUTOR FUNCTION
// =============================================================================

interface InstructionContext {
  commandId?: string;
  totalSteps?: number;
  stepIndex?: number;
}

const instructionTypeToEffect = (
  instruction: AnyInstruction
): CommandEffect => {
  switch (instruction.type) {
    case "trim":
      return "trim";
    case "cut-out":
      return "cut";
    case "captions.generate":
      return "caption";
    case "deadspace.trim":
      return "deadspace";
    default:
      return "generic";
  }
};

/**
 * Execute any instruction (agent or server-side)
 * This is the main entry point for instruction execution
 */
export function executeInstruction({
  instruction,
  context,
}: {
  instruction: AnyInstruction;
  context?: InstructionContext;
}): ExecutionOutcome {
  // New: handle captions generation (async) before other branches
  if (instruction.type === "captions.generate") {
    const i = instruction as any;
    return executeCaptionsGenerateInstruction({
      language: i.language,
      description: i.description,
    });
  }
  if (instruction.type === "deadspace.trim") {
    const i = instruction as any;
    return executeDeadspaceTrimInstruction({
      instruction: i,
    });
  }
  // Handle server-side instructions
  if (isServerInstruction(instruction)) {
    return executeServerInstruction({ instruction });
  }

  // Handle client-side agent instructions
  if (isAgentInstruction(instruction)) {
    return executeAgentInstruction({ instruction, context });
  }

  // Exhaustive check - this should never happen with proper typing
  const _exhaustive: never = instruction;
  return {
    success: false,
    error: "Unsupported instruction type",
  };
}

/**
 * Execute server-side instructions (non-edit operations)
 */
function executeServerInstruction({
  instruction,
}: {
  instruction: Extract<AnyInstruction, { type: string }>;
}): ExecutionOutcome {
  // Handle server-only operations that are executed on the client
  if (instruction.type === "twelvelabs.applyCut") {
    return executeTwelveLabsApplyCut(instruction as any);
  }

  // For other server instructions, we just acknowledge
  console.log("Server instruction received:", instruction);
  return { success: true, targetsResolved: 0, message: instruction.type };
}

/**
 * Execute client-side agent instructions (edit operations)
 */
function executeAgentInstruction({
  instruction,
  context,
}: {
  instruction: AgentInstruction;
  context?: InstructionContext;
}): ExecutionOutcome {
  // Resolve abstract target specification to concrete elements
  const targets = resolveTargets(instruction.target);

  if (targets.length === 0) {
    const targetDesc = describeTargetSpec(instruction.target);
    const errorMessage = `No targets found for: ${targetDesc}`;

    console.warn("Target resolution failed:", {
      instruction: instruction.type,
      target: instruction.target,
      description: targetDesc,
    });

    toast.error(errorMessage);
    return {
      success: false,
      error: errorMessage,
      targetsResolved: 0,
    };
  }

  // Log resolved targets for debugging
  if (process.env.NODE_ENV === "development") {
    const targetDescriptions = describeTargets(targets);
    console.log("Resolved targets:", {
      instruction: instruction.type,
      targetSpec: describeTargetSpec(instruction.target),
      resolvedTargets: targetDescriptions,
    });
  }

  if (targets.length) {
    const agentUI = useAgentUIStore.getState();
    const ordinalLabels = targets.map((_, idx) => formatOrdinalClip(idx + 1));
    const clipSummary = ordinalLabels.join(", ");
    agentUI.updateMessage(
      instruction.description
        ? `${instruction.description} – ${clipSummary}`
        : `${instruction.type === "trim" ? "Trimming" : "Processing"} ${clipSummary}`
    );
  }

  if (context?.commandId) {
    const commandStore = useTimelineCommandStore.getState();
    commandStore.registerTargets({
      id: context.commandId,
      type: instructionTypeToEffect(instruction),
      description: instruction.description,
      targets,
    });
  }

  if (targets.length > 0) {
    if (instruction.type === "trim") {
      const includeAttachments =
        targets.length > 1 ||
        instruction.target.kind === "clipsOverlappingRange";
      emitTrimHighlights({
        targets,
        includeAttachments,
        ttl: 3200,
        meta: {
          source: "trim",
          phase: "preview",
          description: instruction.description,
        },
        delayBetween: 260,
      });
    } else if (instruction.type === "cut-out") {
      const includeAttachments =
        targets.length > 1 ||
        instruction.target.kind === "clipsOverlappingRange";

      const timelineRange =
        instruction.range.mode === "globalSeconds"
          ? {
              mode: "timeline" as const,
              start: instruction.range.start,
              end: instruction.range.end,
            }
          : null;

      emitCutHighlights({
        items: targets.map((target) => ({
          target,
          includeAttachments,
          range: timelineRange ?? undefined,
        })),
        includeAttachments,
        ttl: 3400,
        meta: {
          source: "cut-out",
          phase: "preview",
          description: instruction.description,
        },
        delayBetween: 300,
      });
    }
  }

  // Push one history entry for the entire batch operation
  // This ensures undo/redo works at the instruction level
  useTimelineStore.getState().pushHistory();

  // Execute the appropriate command based on instruction type
  try {
    switch (instruction.type) {
      case "trim":
        return executeTrimInstruction({ instruction, targets });

      case "cut-out":
        return executeCutOutInstruction({ instruction, targets });

      default: {
        // Exhaustive check - this should never happen with proper typing
        const _exhaustive: never = instruction;
        return {
          success: false,
          error: "Unsupported agent instruction type",
          targetsResolved: targets.length,
        };
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown execution error";
    console.error("Instruction execution failed:", error);
    toast.error(`Execution failed: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
      targetsResolved: targets.length,
    };
  }
}

// =============================================================================
// SPECIFIC INSTRUCTION EXECUTORS
// =============================================================================

/**
 * Execute trim instruction on resolved targets
 */
function executeTrimInstruction({
  instruction,
  targets,
}: {
  instruction: Extract<AgentInstruction, { type: "trim" }>;
  targets: { trackId: string; elementId: string }[];
}): ExecutionOutcome {
  let successCount = 0;
  const errors: string[] = [];

  for (const target of targets) {
    const result = trim({
      plan: {
        type: "trim",
        scope: "element",
        element: target,
        sides: instruction.sides,
        options: {
          ...instruction.options,
          ripple: instruction.options?.ripple ?? true,
          // Ensure we don't push history for individual operations
          pushHistory: false,
          // Always disable individual command toasts - we handle toasts at instruction level
          showToast: false,
        },
      },
    });

    if (result.success) {
      successCount++;
    } else {
      const error = result.error || "Unknown trim error";
      errors.push(`${target.elementId}: ${error}`);
    }
  }

  // Provide user feedback
  if (successCount > 0) {
    const message =
      instruction.description ||
      `Trimmed ${successCount} element${successCount > 1 ? "s" : ""}`;

    // Show success toast unless explicitly disabled
    if (instruction.options?.showToast !== false) {
      toast.success(message);
    }
  }

  // Return result
  if (errors.length === 0) {
    return {
      success: true,
      targetsResolved: targets.length,
      message: instruction.description,
    };
  }
  if (successCount > 0) {
    // Partial success
    const errorMessage = `Partial success: ${errors.length} failed (${errors.join(", ")})`;
    toast.warning(errorMessage);

    return {
      success: true, // Still consider it success if some elements were processed
      targetsResolved: targets.length,
      message: `${instruction.description} (partial)`,
    };
  }
  // Complete failure
  const errorMessage = `All trim operations failed: ${errors.join(", ")}`;
  return {
    success: false,
    error: errorMessage,
    targetsResolved: targets.length,
  };
}

// =============================================================================
// CAPTIONS GENERATION (ASYNC PIPELINE)
// =============================================================================

function executeCaptionsGenerateInstruction({
  language,
  description,
}: {
  language?: string;
  description?: string;
}): ExecutionOutcome {
  (async () => {
    try {
      toast.message(description || "Starting captions generation…");

      // 1) Extract audio from current timeline
      const audioBlob = await extractTimelineAudio();

      // 2) Encrypt with zero-knowledge random key
      const buf = await audioBlob.arrayBuffer();
      const { encryptedData, key, iv } = await encryptWithRandomKey(buf);
      const encryptedBlob = new Blob([encryptedData]);

      // 3) Get presigned R2 URL and upload (direct browser PUT)
      const presign = await fetch("/api/get-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileExtension: "wav" }),
      });
      if (!presign.ok) {
        const e = await presign.json().catch(() => ({}) as any);
        throw new Error(e.message || "Failed to get upload URL");
      }
      const { uploadUrl, fileName } = await presign.json();

      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: encryptedBlob,
      });
      if (!put.ok) {
        throw new Error(`Upload failed: ${put.status}`);
      }

      // 4) Call transcription API with decryption params
      const transcribe = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: fileName,
          language: (language || "auto").toLowerCase(),
          decryptionKey: arrayBufferToBase64(key),
          iv: arrayBufferToBase64(iv),
        }),
      });
      if (!transcribe.ok) {
        const e = await transcribe.json().catch(() => ({}) as any);
        throw new Error(e.message || "Transcription failed");
      }
      const { segments } = await transcribe.json();

      // 5) Convert segments into short caption chunks
      const shortCaptions: Array<{
        text: string;
        startTime: number;
        duration: number;
      }> = [];
      let globalEndTime = 0;
      for (const seg of segments || []) {
        const text = String(seg.text || "").trim();
        if (!text) continue;
        const words = text.split(/\s+/);
        const segDur = Math.max(0.001, (seg.end ?? 0) - (seg.start ?? 0));
        const wps = words.length / segDur;
        let chunkStart = seg.start ?? 0;
        for (let i = 0; i < words.length; i += 3) {
          const chunkText = words.slice(i, i + 3).join(" ");
          const chunkDuration = Math.max(
            0.8,
            Math.ceil((3 / Math.max(wps, 0.001)) * 10) / 10
          );
          let start = chunkStart;
          if (start < globalEndTime) start = globalEndTime;
          shortCaptions.push({
            text: chunkText,
            startTime: start,
            duration: chunkDuration,
          });
          globalEndTime = start + chunkDuration;
          chunkStart += chunkDuration;
        }
      }

      const timeline = useTimelineStore.getState();
      // Ensure captions go to the text track immediately below the main media track
      const trackId = timeline.ensureTextTrackBelowMain();
      const baselineState = useTimelineStore.getState();
      const baselineTrack = baselineState.tracks.find((t) => t.id === trackId);
      const baselineIds = new Set(
        (baselineTrack?.elements ?? []).map((element) => element.id)
      );

      timeline.pushHistory();
      shortCaptions.forEach((cap, idx) => {
        timeline.addElementToTrack(trackId, {
          ...DEFAULT_TEXT_ELEMENT,
          name: `Caption ${idx + 1}`,
          content: cap.text,
          duration: cap.duration,
          startTime: cap.startTime,
          fontSize: 65,
          fontWeight: "bold",
        } as any);
      });

      const updatedState = useTimelineStore.getState();
      const captionTrack = updatedState.tracks.find((t) => t.id === trackId);
      const highlightTargets = (captionTrack?.elements ?? [])
        .filter((element) => !baselineIds.has(element.id))
        .map((element) => ({ trackId, elementId: element.id }));

      if (highlightTargets.length > 0) {
        emitCaptionHighlights({
          targets: highlightTargets,
          meta: { source: "captions.generate" },
        });
      }

      toast.success(`Added ${shortCaptions.length} captions`);
    } catch (e: any) {
      console.error("Agent captions failed:", e);
      toast.error(e?.message || "Captions failed");
    }
  })();

  // Immediate response; actual work continues asynchronously
  return {
    success: true,
    targetsResolved: 0,
    message: description || "Captions started",
  };
}

// =============================================================================
// DEADSPACE TRIM (ASYNC, PER-ELEMENT TRANSCRIPTION)
// =============================================================================

function executeDeadspaceTrimInstruction({
  instruction,
}: {
  instruction: {
    type: "deadspace.trim";
    target: any;
    language?: string;
    description?: string;
  };
}): ExecutionOutcome {
  (async () => {
    const lang = (instruction.language || "auto").toLowerCase();
    const timeline = useTimelineStore.getState();
    try {
      const targets = resolveTargets(instruction.target);
      if (targets.length === 0) {
        toast.error(
          `No targets found for: ${describeTargetSpec(instruction.target)}`
        );
        return;
      }

      // Single history entry for whole batch
      timeline.pushHistory();

      let successCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];

      for (const target of targets) {
        try {
          const fresh = useTimelineStore.getState();
          const track = fresh.tracks.find((t) => t.id === target.trackId);
          const element = track?.elements.find(
            (e) => e.id === target.elementId
          );
          if (!track || !element || element.type !== "media") {
            skippedCount++;
            continue;
          }

          const mediaStore = useMediaStore.getState();
          const mediaFile = mediaStore.mediaFiles.find(
            (m) => m.id === element.mediaId
          );
          if (
            !mediaFile ||
            !(mediaFile.type === "audio" || mediaFile.type === "video")
          ) {
            skippedCount++;
            continue;
          }

          const effectiveDuration = Math.max(
            0,
            element.duration - element.trimStart - element.trimEnd
          );
          if (effectiveDuration <= 0.25) {
            // too short to process
            skippedCount++;
            continue;
          }

          // 1) Extract element-local audio (mono 16k)
          const audioBlob = await extractElementAudio(
            mediaFile.file,
            element.trimStart,
            effectiveDuration
          );

          // 2) Local VAD to find speech window (10 ms precision)
          const arrayBuf = await audioBlob.arrayBuffer();
          const AC: any =
            (window as any).AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AC();
          const audioBuffer: AudioBuffer = await audioCtx.decodeAudioData(
            arrayBuf.slice(0)
          );
          const vad = detectSpeechWindow(audioBuffer);

          let earliestStart: number | null = null;
          let latestEnd: number | null = null;

          if (vad && vad.confidence >= 0.5) {
            earliestStart = vad.start;
            latestEnd = vad.end;
          } else {
            // Optional hybrid fallback: escalate to transcription only when VAD is uncertain
            try {
              const { encryptedData, key, iv } =
                await encryptWithRandomKey(arrayBuf);
              const encryptedBlob = new Blob([encryptedData]);

              const presign = await fetch("/api/get-upload-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileExtension: "wav" }),
              });
              if (!presign.ok) {
                const e = await presign.json().catch(() => ({}) as any);
                throw new Error(e.message || "Failed to get upload URL");
              }
              const { uploadUrl, fileName } = await presign.json();
              const put = await fetch(uploadUrl, {
                method: "PUT",
                body: encryptedBlob,
              });
              if (!put.ok) throw new Error(`Upload failed: ${put.status}`);

              const transcribe = await fetch("/api/transcribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  filename: fileName,
                  language: lang,
                  decryptionKey: arrayBufferToBase64(key),
                  iv: arrayBufferToBase64(iv),
                }),
              });
              if (!transcribe.ok) {
                const e = await transcribe.json().catch(() => ({}) as any);
                throw new Error(e.message || "Transcription failed");
              }
              const { segments } = await transcribe.json();
              const filtered = Array.isArray(segments)
                ? segments.filter((s: any) => {
                    const d = (s.end ?? 0) - (s.start ?? 0);
                    const noSpeech =
                      typeof s.no_speech_prob === "number"
                        ? s.no_speech_prob
                        : 0;
                    return d >= 0.2 && noSpeech < 0.8;
                  })
                : [];
              if (filtered.length) {
                earliestStart = Math.min(
                  ...filtered.map((s: any) => s.start ?? 0)
                );
                latestEnd = Math.max(...filtered.map((s: any) => s.end ?? 0));
              }
            } catch (e) {
              // If fallback also fails, skip this element
            }
          }

          if (earliestStart == null || latestEnd == null) {
            skippedCount++;
            continue;
          }

          // Gentle padding
          const pad = 0.12;
          earliestStart = Math.max(0, earliestStart - pad);
          latestEnd = Math.min(effectiveDuration, latestEnd + pad);
          if (latestEnd <= earliestStart) {
            skippedCount++;
            continue;
          }

          // Convert to absolute local times for trim command
          const leftTime = element.trimStart + earliestStart;
          const rightTime = element.trimStart + latestEnd;

          const result = trim({
            plan: {
              type: "trim",
              scope: "element",
              element: { trackId: target.trackId, elementId: target.elementId },
              sides: {
                left: { mode: "toSeconds", time: leftTime },
                right: { mode: "toSeconds", time: rightTime },
              },
              options: {
                pushHistory: false,
                showToast: false,
                clamp: true,
                precision: 3,
              },
            },
          });

          if (result.success) successCount++;
          else
            errors.push(result.error || `Trim failed on ${target.elementId}`);
        } catch (err: any) {
          errors.push(err?.message || String(err));
        }
      }

      if (successCount > 0 && errors.length === 0) {
        toast.success(
          `Trimmed dead space on ${successCount} clip${successCount > 1 ? "s" : ""}`
        );
      } else if (successCount > 0) {
        toast.warning(
          `Trimmed dead space on ${successCount}, ${skippedCount} skipped, ${errors.length} errors`
        );
      } else {
        toast.error(
          `No clips trimmed. ${skippedCount} skipped${errors.length ? ", errors occurred" : ""}`
        );
      }
    } catch (e: any) {
      console.error("Deadspace trim failed:", e);
      toast.error(e?.message || "Deadspace trim failed");
    }
  })();

  return {
    success: true,
    targetsResolved: 0,
    message: instruction.description || "Trimming dead space…",
  };
}

// -----------------------------------------------------------------------------
// Local VAD (energy-based, 10 ms frames, hysteresis)
// -----------------------------------------------------------------------------
function detectSpeechWindow(
  buffer: AudioBuffer
): { start: number; end: number; confidence: number } | null {
  const channel = buffer.getChannelData(0);
  const sr = buffer.sampleRate || 16_000;
  const frameMs = 10; // 10 ms resolution
  const frameLen = Math.max(1, Math.round((sr * frameMs) / 1000));
  const totalFrames = Math.floor(channel.length / frameLen);
  if (totalFrames < 5) return null;

  const energies: number[] = new Array(totalFrames);
  let idx = 0;
  for (let f = 0; f < totalFrames; f++) {
    let sum = 0;
    const start = f * frameLen;
    for (let i = 0; i < frameLen; i++) {
      const s = channel[start + i] || 0;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / frameLen);
    energies[idx++] = rms;
  }

  // Estimate noise floor as 20th percentile energy
  const sorted = energies.slice().sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const threshold = Math.max(0.003, p20 * 3.0); // dynamic + minimum floor

  // Build active mask
  const active = energies.map((e) => e >= threshold);

  // Hysteresis: require 200 ms active to start, 150 ms inactive to end
  const minActiveFrames = Math.max(1, Math.round(200 / frameMs));
  const minInactiveFrames = Math.max(1, Math.round(150 / frameMs));

  // Find earliest start
  let startFrame: number | null = null;
  let run = 0;
  for (let f = 0; f < active.length; f++) {
    run = active[f] ? run + 1 : 0;
    if (run >= minActiveFrames) {
      startFrame = f - minActiveFrames + 1;
      break;
    }
  }
  if (startFrame == null) return null;

  // Find latest end
  let endFrame: number | null = null;
  run = 0;
  for (let f = active.length - 1; f >= 0; f--) {
    run = active[f] ? 0 : run + 1;
    if (run >= minInactiveFrames) {
      endFrame = f + minInactiveFrames - 1;
      break;
    }
  }
  if (endFrame == null) endFrame = active.length - 1;

  const startSec = (startFrame * frameLen) / sr;
  const endSec = (Math.min(endFrame + 1, active.length) * frameLen) / sr;
  if (endSec <= startSec) return null;

  // Confidence: ratio of active frames within [startFrame, endFrame]
  let act = 0;
  for (let f = startFrame; f <= endFrame; f++) if (active[f]) act++;
  const conf = act / Math.max(1, endFrame - startFrame + 1);

  return { start: startSec, end: endSec, confidence: conf };
}

/**
 * Execute a server-provided TwelveLabs applyCut instruction on matching elements.
 * TwelveLabs provides timestamps in source video coordinates.
 * We need to find elements whose visible source range overlaps with the TwelveLabs range.
 */
function executeTwelveLabsApplyCut(instruction: {
  type: "twelvelabs.applyCut";
  videoId: string;
  start: number;
  end: number;
  description?: string;
  query?: string;
}): ExecutionOutcome {
  const mediaFiles = useMediaStore.getState().mediaFiles;
  const timeline = useTimelineStore.getState();

  // Find mediaIds that map to this TwelveLabs video
  const matchingMediaIds = mediaFiles
    .filter((m) => m.twelveLabsVideoId === instruction.videoId)
    .map((m) => m.id);

  if (matchingMediaIds.length === 0) {
    return {
      success: false,
      error: `No media items found for TwelveLabs video ${instruction.videoId}`,
      targetsResolved: 0,
    };
  }

  // Collect matching elements with full data for range validation
  interface TargetElement {
    trackId: string;
    elementId: string;
    startTime: number;
    trimStart: number;
    trimEnd: number;
    duration: number;
  }

  const targets: TargetElement[] = [];
  for (const track of timeline.tracks) {
    for (const el of track.elements) {
      if (el.type === "media" && matchingMediaIds.includes(el.mediaId)) {
        targets.push({
          trackId: track.id,
          elementId: el.id,
          startTime: el.startTime,
          trimStart: el.trimStart,
          trimEnd: el.trimEnd,
          duration: el.duration,
        });
      }
    }
  }

  if (targets.length === 0) {
    return {
      success: false,
      error: `No timeline elements found for TwelveLabs video ${instruction.videoId}`,
      targetsResolved: 0,
    };
  }

  // Filter targets to only those whose visible source range overlaps with TwelveLabs range
  const validTargets = targets.filter((target) => {
    // Calculate visible source video range for this element
    const sourceStart = target.trimStart;
    const sourceEnd = target.duration - target.trimEnd;

    // Check if TwelveLabs range overlaps with element's visible source range
    // Ranges overlap if: !(rangeEnd <= elementStart || rangeStart >= elementEnd)
    const overlaps = !(
      instruction.end <= sourceStart || instruction.start >= sourceEnd
    );

    return overlaps;
  });

  if (validTargets.length === 0) {
    const targetInfo =
      targets.length === 1
        ? `element (shows source ${targets[0].trimStart.toFixed(2)}-${(targets[0].duration - targets[0].trimEnd).toFixed(2)}s)`
        : `${targets.length} elements`;
    return {
      success: false,
      error: `TwelveLabs range ${instruction.start.toFixed(2)}-${instruction.end.toFixed(2)}s doesn't overlap with ${targetInfo}`,
      targetsResolved: 0,
    };
  }

  // Single history entry for whole operation
  timeline.pushHistory();

  let successCount = 0;
  const errors: string[] = [];
  let totalRemovedDuration = 0;
  let summaryMinStart = Number.POSITIVE_INFINITY;
  let summaryMaxEnd = Number.NEGATIVE_INFINITY;

  for (const target of validTargets) {
    // Convert TwelveLabs source video timestamps to element-relative coordinates
    // TwelveLabs range is in source video time, element coordinates start at 0
    // If element shows source 5-20s and TwelveLabs says "cut 10-15s",
    // element-relative coordinates are: (10-5) to (15-5) = 5s to 10s
    const localStart = instruction.start - target.trimStart;
    const localEnd = instruction.end - target.trimStart;

    // Calculate element's visible duration for bounds validation
    const visibleDuration = target.duration - target.trimStart - target.trimEnd;

    // Clamp to element bounds (with tolerance for edge cases)
    const clampedStart = Math.max(0, localStart);
    const clampedEnd = Math.min(visibleDuration, localEnd);

    // Validate that we have a meaningful range to cut
    if (clampedEnd <= clampedStart || clampedEnd - clampedStart < 0.01) {
      errors.push(
        `Range too small or invalid for ${target.elementId} (${clampedStart.toFixed(2)}-${clampedEnd.toFixed(2)}s)`
      );
      continue;
    }

    // Compute pre-edit global timeline window for summary BEFORE edits
    const preStart = target.startTime + clampedStart;
    const preEnd = target.startTime + clampedEnd;
    if (preStart < summaryMinStart) summaryMinStart = preStart;
    if (preEnd > summaryMaxEnd) summaryMaxEnd = preEnd;

    const result = cutOut({
      plan: {
        type: "cut-out",
        scope: "element",
        element: { trackId: target.trackId, elementId: target.elementId },
        range: { mode: "elementSeconds", start: clampedStart, end: clampedEnd },
        options: { pushHistory: false, showToast: false, clamp: true },
      },
    });

    if (result.success) {
      successCount++;
      if (result.removedDuration)
        totalRemovedDuration += result.removedDuration;
      // already captured pre-edit window above
    } else {
      errors.push(result.error || `Unknown error on ${target.elementId}`);
    }
  }

  if (successCount > 0) {
    const msg =
      instruction.description ||
      `Cut out matched content (${totalRemovedDuration.toFixed(2)}s removed from ${successCount} clip${successCount > 1 ? "s" : ""})`;
    toast.success(msg);
    return {
      success: true,
      targetsResolved: validTargets.length,
      message: msg,
      // Attach meta for summarizer (pre-edit timeline range + query)
      meta: {
        timelineRange:
          Number.isFinite(summaryMinStart) && Number.isFinite(summaryMaxEnd)
            ? { start: summaryMinStart, end: summaryMaxEnd }
            : undefined,
        tlQuery: instruction.query,
      },
    };
  }

  return {
    success: false,
    error: `Failed to apply cut: ${errors.join(", ")}`,
    targetsResolved: validTargets.length,
  };
}

/**
 * Execute cut-out instruction on resolved targets
 */
function executeCutOutInstruction({
  instruction,
  targets,
}: {
  instruction: Extract<AgentInstruction, { type: "cut-out" }>;
  targets: { trackId: string; elementId: string }[];
}): ExecutionOutcome {
  let successCount = 0;
  const errors: string[] = [];
  let totalRemovedDuration = 0;

  // Normalize range for globalSeconds and elementSeconds modes
  const range =
    instruction.range.mode === "globalSeconds" ||
    instruction.range.mode === "elementSeconds"
      ? {
          ...instruction.range,
          ...normalizeTargetRange({
            start: instruction.range.start,
            end: instruction.range.end,
          }),
        }
      : instruction.range;

  for (const target of targets) {
    const result = cutOut({
      plan: {
        type: "cut-out",
        scope: "element",
        element: target,
        range,
        options: {
          ...instruction.options,
          // Ensure we don't push history for individual operations
          pushHistory: false,
          // Always disable individual command toasts - we handle toasts at instruction level
          showToast: false,
        },
      },
    });

    if (result.success) {
      successCount++;
      if (result.removedDuration) {
        totalRemovedDuration += result.removedDuration;
      }
    } else {
      const error = result.error || "Unknown cut-out error";
      errors.push(`${target.elementId}: ${error}`);
    }
  }

  // Provide user feedback
  if (successCount > 0) {
    const durationText =
      totalRemovedDuration > 0
        ? ` (${totalRemovedDuration.toFixed(2)}s removed)`
        : "";

    const message =
      instruction.description ||
      `Cut from ${successCount} element${successCount > 1 ? "s" : ""}${durationText}`;

    // Show success toast unless explicitly disabled
    if (instruction.options?.showToast !== false) {
      toast.success(message);
    }
  }

  // Return result
  if (errors.length === 0) {
    return {
      success: true,
      targetsResolved: targets.length,
      message: instruction.description,
    };
  }
  if (successCount > 0) {
    // Partial success
    const errorMessage = `Partial success: ${errors.length} failed (${errors.join(", ")})`;
    toast.warning(errorMessage);

    return {
      success: true, // Still consider it success if some elements were processed
      targetsResolved: targets.length,
      message: `${instruction.description} (partial)`,
    };
  }
  // Complete failure
  const errorMessage = `All cut-out operations failed: ${errors.join(", ")}`;
  return {
    success: false,
    error: errorMessage,
    targetsResolved: targets.length,
  };
}

// =============================================================================
// POLISH UTILITIES
// =============================================================================

/**
 * Normalize target range values to ensure start <= end
 */
function normalizeTargetRange({ start, end }: { start: number; end: number }): {
  start: number;
  end: number;
} {
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

/**
 * Validate instruction with optional dry-run execution
 */
function validateWithDryRun({
  instruction,
  targets,
}: {
  instruction: AgentInstruction;
  targets: { trackId: string; elementId: string }[];
}): { valid: boolean; issues: string[]; dryRunResults?: any } {
  const issues: string[] = [];
  let dryRunResults;

  // Basic instruction validation
  if (instruction.type === "trim") {
    if (!instruction.sides.left && !instruction.sides.right) {
      issues.push(
        "Trim instruction must specify at least one side (left or right)"
      );
    }
  }

  if (instruction.type === "cut-out") {
    const range = instruction.range;
    if (range.mode === "globalSeconds" || range.mode === "elementSeconds") {
      const normalizedRange = normalizeTargetRange({
        start: range.start,
        end: range.end,
      });
      if (normalizedRange.start === normalizedRange.end) {
        issues.push("Cut-out range must have non-zero duration");
      }
      if (normalizedRange.start < 0) {
        issues.push("Cut-out range times must be non-negative");
      }
    }
  }

  // Dry-run validation if requested
  if (instruction.options?.dryRun) {
    try {
      // Execute with dry-run enabled to check for potential issues
      if (instruction.type === "trim") {
        for (const target of targets) {
          const result = trim({
            plan: {
              type: "trim",
              scope: "element",
              element: target,
              sides: instruction.sides,
              options: { ...instruction.options, dryRun: true },
            },
          });
          if (!result.success) {
            issues.push(
              `Dry-run trim failed for ${target.elementId}: ${result.error}`
            );
          }
        }
      } else if (instruction.type === "cut-out") {
        for (const target of targets) {
          const result = cutOut({
            plan: {
              type: "cut-out",
              scope: "element",
              element: target,
              range: instruction.range,
              options: { ...instruction.options, dryRun: true },
            },
          });
          if (!result.success) {
            issues.push(
              `Dry-run cut-out failed for ${target.elementId}: ${result.error}`
            );
          }
        }
      }
    } catch (error) {
      issues.push(
        `Dry-run execution error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    dryRunResults,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Execute multiple instructions in sequence
 * Useful for testing or batch operations
 */
export function executeInstructionBatch({
  instructions,
  options = {},
}: {
  instructions: AnyInstruction[];
  options?: {
    stopOnError?: boolean;
    showBatchToast?: boolean;
  };
}): {
  results: ExecutionOutcome[];
  totalSuccess: number;
  totalErrors: number;
} {
  const results: ExecutionOutcome[] = [];
  let totalSuccess = 0;
  let totalErrors = 0;

  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];
    console.log(
      `Executing batch instruction ${i + 1}/${instructions.length}:`,
      instruction.type
    );

    const result = executeInstruction({ instruction });
    results.push(result);

    if (result.success) {
      totalSuccess++;
    } else {
      totalErrors++;

      if (options.stopOnError) {
        console.log("Batch execution stopped due to error:", result.error);
        break;
      }
    }
  }

  // Show summary toast if requested
  if (options.showBatchToast) {
    if (totalErrors === 0) {
      toast.success(
        `Batch completed: ${totalSuccess} instructions executed successfully`
      );
    } else if (totalSuccess > 0) {
      toast.warning(
        `Batch completed: ${totalSuccess} success, ${totalErrors} errors`
      );
    } else {
      toast.error(`Batch failed: ${totalErrors} errors`);
    }
  }

  return { results, totalSuccess, totalErrors };
}

/**
 * Validate an instruction before execution (optional safety check)
 */
export function validateInstructionForExecution({
  instruction,
}: {
  instruction: AnyInstruction;
}): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (isAgentInstruction(instruction)) {
    // Check target resolution first
    let targets: { trackId: string; elementId: string }[] = [];
    try {
      targets = resolveTargets(instruction.target);
      if (targets.length === 0) {
        issues.push(
          `No targets found for: ${describeTargetSpec(instruction.target)}`
        );
        return { valid: false, issues }; // Exit early if no targets
      }
    } catch (error) {
      issues.push(
        `Target resolution failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return { valid: false, issues }; // Exit early if resolution fails
    }

    // Use enhanced validation with optional dry-run
    const validation = validateWithDryRun({ instruction, targets });
    issues.push(...validation.issues);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
function getOrdinalSuffix(n: number) {
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

function formatOrdinalClip(index: number) {
  return `${index}${getOrdinalSuffix(index)} clip`;
}
