/**
 * Shared types for the agentic edit system
 * Defines abstract target specifications and instruction types that map to existing commands
 */

import { z } from "zod";
import type { TrimPlan, CutOutPlan } from "@/lib/commands/types";

// =============================================================================
// TARGET SPECIFICATION TYPES
// =============================================================================

// Track filtering helper for targets
export type TrackFilter = "media" | "audio" | "text" | "all" | { id: string };

// Abstract target specs so the server doesn't need concrete element IDs
export type TargetSpec =
  | { kind: "clipAtPlayhead" }
  | { kind: "clipAtTime"; time: number }
  | { kind: "lastClip"; track?: TrackFilter }
  | { kind: "nthClip"; index: number; track?: TrackFilter } // 1-based indexing
  | {
      kind: "clipsOverlappingRange";
      start: number;
      end: number;
      track?: TrackFilter;
    };

// =============================================================================
// INSTRUCTION TYPES
// =============================================================================

// Edit instructions that map 1:1 to existing command plans
export interface TrimInstruction {
  type: "trim";
  target: TargetSpec;
  sides: TrimPlan["sides"];
  options?: TrimPlan["options"];
  description?: string;
}

export interface CutOutInstruction {
  type: "cut-out";
  target: TargetSpec;
  range: CutOutPlan["range"];
  options?: CutOutPlan["options"];
  description?: string;
}

// Non-edit, server-side steps (extensible for future features)
export interface TLAnalyzeInstruction {
  type: "twelvelabs.analyze";
  videoUrl: string;
  language?: string;
  description?: string;
}

// Ask backend to search TwelveLabs for semantic query; backend will respond with applyCut
export interface TLSearchInstruction {
  type: "twelvelabs.search";
  query: string;
  // Optional hint fields
  projectId?: string;
  description?: string;
}

// Server-computed instruction: apply a cut based on TwelveLabs match
export interface TLApplyCutInstruction {
  type: "twelvelabs.applyCut";
  videoId: string;
  start: number; // source video start in seconds
  end: number;   // source video end in seconds
  description?: string;
}

// Non-edit server-side instructions
export type ServerInstruction =
  | TLAnalyzeInstruction
  | TLSearchInstruction
  | TLApplyCutInstruction;

// Union types for instruction handling
export type AgentInstruction = TrimInstruction | CutOutInstruction;
// New: captions generation (client-side async operation)
export interface CaptionsGenerateInstruction {
  type: "captions.generate";
  language?: string; // e.g., "auto", "en", "es"
  description?: string;
}

export type AnyInstruction =
  | AgentInstruction
  | ServerInstruction
  | CaptionsGenerateInstruction;

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

// Initial planning payload (no video files, just metadata snapshot)
export interface AgentRequestPayload {
  prompt: string;
  metadata: {
    projectId?: string;
    duration?: number;
    fps?: number;
    playheadTime?: number;
    tracks?: Array<{
      id: string;
      type: "media" | "audio" | "text";
      elements: number;
    }>;
  };
}

// Streamed event over SSE for future implementation
export interface AgentStreamEvent {
  event: "step" | "log" | "error" | "done";
  stepIndex?: number;
  totalSteps?: number;
  instruction?: AnyInstruction;
  message?: string;
}

// =============================================================================
// ZOD SCHEMAS FOR RUNTIME VALIDATION
// =============================================================================

// Track filter schema
export const TrackFilterSchema = z.union([
  z.enum(["media", "audio", "text", "all"]),
  z.object({ id: z.string() }),
]);

// Target specification schemas
export const TargetSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clipAtPlayhead") }),
  z.object({
    kind: z.literal("clipAtTime"),
    time: z.number().min(0, "Time must be non-negative"),
  }),
  z.object({
    kind: z.literal("lastClip"),
    track: TrackFilterSchema.optional(),
  }),
  z.object({
    kind: z.literal("nthClip"),
    index: z.number().int().positive("Index must be a positive integer"),
    track: TrackFilterSchema.optional(),
  }),
  z.object({
    kind: z.literal("clipsOverlappingRange"),
    start: z.number().min(0, "Start time must be non-negative"),
    end: z.number().min(0, "End time must be non-negative"),
    track: TrackFilterSchema.optional(),
  }),
]);

// Instruction schemas
export const TrimInstructionSchema = z.object({
  type: z.literal("trim"),
  target: TargetSpecSchema,
  sides: z.object({
    left: z
      .object({
        mode: z.enum(["toSeconds", "toPlayhead", "deltaSeconds"]),
        time: z.number().optional(),
        delta: z.number().optional(),
      })
      .optional(),
    right: z
      .object({
        mode: z.enum(["toSeconds", "toPlayhead", "deltaSeconds"]),
        time: z.number().optional(),
        delta: z.number().optional(),
      })
      .optional(),
  }),
  options: z
    .object({
      pushHistory: z.boolean().optional(),
      showToast: z.boolean().optional(),
      clamp: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      precision: z.number().optional(),
    })
    .optional(),
  description: z.string().optional(),
});

export const CutOutInstructionSchema = z.object({
  type: z.literal("cut-out"),
  target: TargetSpecSchema,
  range: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("elementSeconds"),
      start: z.number().min(0),
      end: z.number().min(0),
    }),
    z.object({
      mode: z.literal("globalSeconds"),
      start: z.number().min(0),
      end: z.number().min(0),
    }),
    z.object({
      mode: z.literal("aroundPlayhead"),
      left: z.number().min(0),
      right: z.number().min(0),
    }),
  ]),
  options: z
    .object({
      pushHistory: z.boolean().optional(),
      showToast: z.boolean().optional(),
      clamp: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      precision: z.number().optional(),
      ripple: z.boolean().optional(),
    })
    .optional(),
  description: z.string().optional(),
});

export const AgentInstructionSchema = z.union([
  TrimInstructionSchema,
  CutOutInstructionSchema,
]);

export const ServerInstructionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("twelvelabs.analyze"),
    videoUrl: z.string().url("Must be a valid URL"),
    language: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal("twelvelabs.search"),
    query: z.string().min(1),
    projectId: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal("twelvelabs.applyCut"),
    videoId: z.string().min(1),
    start: z.number().min(0),
    end: z.number().min(0),
    description: z.string().optional(),
  }),
]);

export const AnyInstructionSchema = z.union([
  AgentInstructionSchema,
  ServerInstructionSchema,
  z.object({
    type: z.literal("captions.generate"),
    language: z.string().optional(),
    description: z.string().optional(),
  }),
]);

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Validates a target specification at runtime
 */
export function validateTargetSpec(target: unknown): target is TargetSpec {
  try {
    TargetSpecSchema.parse(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an instruction at runtime
 */
export function validateInstruction(
  instruction: unknown
): instruction is AnyInstruction {
  try {
    AnyInstructionSchema.parse(instruction);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type guard for agent instructions (client-executable)
 */
export function isAgentInstruction(
  instruction: AnyInstruction
): instruction is AgentInstruction {
  return instruction.type === "trim" || instruction.type === "cut-out";
}

/**
 * Type guard for server instructions
 */
export function isServerInstruction(
  instruction: AnyInstruction
): instruction is ServerInstruction {
  return (
    instruction.type === "twelvelabs.analyze" ||
    instruction.type === "twelvelabs.search" ||
    instruction.type === "twelvelabs.applyCut"
  );
}
