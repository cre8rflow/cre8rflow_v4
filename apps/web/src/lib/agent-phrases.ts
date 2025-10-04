/**
 * User-facing phrases for agent operations
 * Maps internal instruction types to friendly descriptions
 */

import type { AnyInstruction, CommandEffect } from "@/types/agent";

export const AGENT_OPERATION_PHRASES = {
  // Server operations
  analyzing: "Analyzing your request…",
  planning: "Planning edits…",
  checkingIndex: "Checking indexing status…",
  searching: "Searching your video…",

  // Instruction types
  trim: "Trimming clip(s)…",
  "cut-out": "Cutting section…",
  "captions.generate": "Generating captions…",
  "deadspace.trim": "Removing silence…",
  "twelvelabs.analyze": "Analyzing video…",
  "twelvelabs.search": "Searching video…",
  "twelvelabs.applyCut": "Applying match…",

  // Status messages
  stepComplete: (current: number, total: number) =>
    `Applied step ${current} of ${total}`,
  allComplete: "All edits applied.",
} as const;

/**
 * Get user-friendly phrase for an instruction
 */
export function getInstructionPhrase(
  instruction: AnyInstruction
): string | undefined {
  return AGENT_OPERATION_PHRASES[instruction.type];
}

/**
 * Get user-friendly phrase for a command effect type
 */
export function getCommandEffectPhrase(effect: CommandEffect): string {
  switch (effect) {
    case "trim":
      return "Trimming clip(s)…";
    case "cut":
      return "Cutting section…";
    case "caption":
      return "Generating captions…";
    case "deadspace":
      return "Removing silence…";
    case "analysis":
      return "Analyzing…";
    case "generic":
      return "Processing…";
    default:
      return "Processing…";
  }
}
