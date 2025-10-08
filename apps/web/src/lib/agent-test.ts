/**
 * Test utilities for the agentic edit system
 * Used for smoke testing with hardcoded instructions
 */

import type {
  AgentInstruction,
  TrimInstruction,
  CutOutInstruction,
} from "@/types/agent";
import {
  executeInstruction,
  executeInstructionBatch,
  validateInstructionForExecution,
} from "./agent-executor";
import {
  resolveTargets,
  describeTargetSpec,
  describeTargets,
} from "./agent-resolver";
import { toast } from "sonner";

// =============================================================================
// EXAMPLE INSTRUCTIONS FOR TESTING
// =============================================================================

/**
 * Example trim instructions for testing different scenarios
 */
export const EXAMPLE_TRIM_INSTRUCTIONS: TrimInstruction[] = [
  // Trim 5 seconds from the right side of the last media clip
  {
    type: "trim",
    target: { kind: "lastClip", track: "media" },
    sides: {
      right: { mode: "deltaSeconds", delta: 5 },
    },
    description: "Trim 5s from end of last media clip",
  },

  // Trim current clip to playhead on the left side
  {
    type: "trim",
    target: { kind: "clipAtPlayhead" },
    sides: {
      left: { mode: "toPlayhead" },
    },
    description: "Trim clip at playhead to start at playhead",
  },

  // Trim first clip to exactly 10 seconds duration from the start
  {
    type: "trim",
    target: { kind: "nthClip", index: 1, track: "media" },
    sides: {
      right: { mode: "toSeconds", time: 10 },
    },
    description: "Trim first media clip to 10 seconds",
  },

  // Trim 2 seconds from both sides of clips between 10-20 seconds
  {
    type: "trim",
    target: {
      kind: "clipsOverlappingRange",
      start: 10,
      end: 20,
      track: "media",
    },
    sides: {
      left: { mode: "deltaSeconds", delta: 2 },
      right: { mode: "deltaSeconds", delta: 2 },
    },
    description: "Trim 2s from both sides of clips in 10-20s range",
  },
];

/**
 * Example cut-out instructions for testing different scenarios
 */
export const EXAMPLE_CUT_OUT_INSTRUCTIONS: CutOutInstruction[] = [
  // Cut out 5-10 seconds globally across all media clips
  {
    type: "cut-out",
    target: {
      kind: "clipsOverlappingRange",
      start: 5,
      end: 10,
      track: "media",
    },
    range: { mode: "globalSeconds", start: 5, end: 10 },
    description: "Cut out 5-10s globally from media clips",
  },

  // Cut out middle 3 seconds from the last clip
  {
    type: "cut-out",
    target: { kind: "lastClip", track: "media" },
    range: { mode: "elementSeconds", start: 3, end: 6 },
    description: "Cut out 3-6s from last media clip",
  },

  // Cut out 1 second around current playhead
  {
    type: "cut-out",
    target: { kind: "clipAtPlayhead" },
    range: { mode: "aroundPlayhead", left: 0.5, right: 0.5 },
    description: "Cut out 1s around playhead",
  },

  // Cut out first 2 seconds of second clip
  {
    type: "cut-out",
    target: { kind: "nthClip", index: 2 },
    range: { mode: "elementSeconds", start: 0, end: 2 },
    description: "Cut out first 2s of second clip",
  },
];

/**
 * Combined example instruction set mixing trim and cut-out operations
 */
export const EXAMPLE_MIXED_INSTRUCTIONS: AgentInstruction[] = [
  ...EXAMPLE_TRIM_INSTRUCTIONS.slice(0, 2),
  ...EXAMPLE_CUT_OUT_INSTRUCTIONS.slice(0, 1),
  ...EXAMPLE_TRIM_INSTRUCTIONS.slice(2, 3),
];

// =============================================================================
// TEST FUNCTIONS
// =============================================================================

/**
 * Test target resolution without executing commands
 * Useful for debugging target specs
 */
export function testTargetResolution(): void {
  console.log("=== Testing Target Resolution ===");

  const testSpecs = [
    { kind: "lastClip" as const, track: "media" as const },
    { kind: "clipAtPlayhead" as const },
    { kind: "nthClip" as const, index: 1, track: "media" as const },
    { kind: "clipsOverlappingRange" as const, start: 5, end: 15 },
  ];

  for (const spec of testSpecs) {
    const description = describeTargetSpec(spec);
    const targets = resolveTargets(spec);
    const targetDescriptions = describeTargets(targets);

    console.log(`Target: ${description}`);
    console.log(`Resolved: ${targets.length} elements`);
    if (targetDescriptions.length > 0) {
      targetDescriptions.forEach((desc) => console.log(`  - ${desc}`));
    }
    console.log("");
  }

  toast.success("Target resolution test completed (check console)");
}

/**
 * Test instruction validation without execution
 */
export function testInstructionValidation(): void {
  console.log("=== Testing Instruction Validation ===");

  const testInstructions = [
    ...EXAMPLE_TRIM_INSTRUCTIONS.slice(0, 2),
    ...EXAMPLE_CUT_OUT_INSTRUCTIONS.slice(0, 2),
  ];

  for (const instruction of testInstructions) {
    const validation = validateInstructionForExecution({ instruction });
    console.log(`Instruction: ${instruction.description || instruction.type}`);
    console.log(`Valid: ${validation.valid}`);
    if (!validation.valid) {
      validation.issues.forEach((issue) => console.log(`  Issue: ${issue}`));
    }
    console.log("");
  }

  toast.success("Instruction validation test completed (check console)");
}

/**
 * Execute a single example instruction for testing
 */
export function testSingleInstruction(index = 0): void {
  const allInstructions = [
    ...EXAMPLE_TRIM_INSTRUCTIONS,
    ...EXAMPLE_CUT_OUT_INSTRUCTIONS,
  ];

  if (index >= allInstructions.length) {
    toast.error(
      `Invalid instruction index: ${index} (max: ${allInstructions.length - 1})`
    );
    return;
  }

  const instruction = allInstructions[index];
  console.log("=== Executing Single Test Instruction ===");
  console.log("Instruction:", instruction);

  const result = executeInstruction({ instruction });
  console.log("Result:", result);

  if (result.success) {
    toast.success(
      `Test instruction completed: ${instruction.description || instruction.type}`
    );
  } else {
    const errorMessage = "error" in result ? result.error : "Unknown error";
    toast.error(`Test instruction failed: ${errorMessage}`);
  }
}

/**
 * Execute a batch of example instructions for testing
 */
export function testInstructionBatch(stopOnError = false): void {
  console.log("=== Executing Test Instruction Batch ===");

  const batchResult = executeInstructionBatch({
    instructions: EXAMPLE_MIXED_INSTRUCTIONS,
    options: {
      stopOnError,
      showBatchToast: true,
    },
  });

  console.log("Batch results:", batchResult);
}

/**
 * Simulate the planned example: "cut out 5–10 seconds and trim the last clip by 5 seconds"
 */
export function testPlannedExample(): void {
  console.log("=== Testing Planned Example ===");
  console.log(
    'Simulating: "cut out 5–10 seconds and trim the last clip by 5 seconds"'
  );

  const instructions: AgentInstruction[] = [
    {
      type: "cut-out",
      target: {
        kind: "clipsOverlappingRange",
        start: 5,
        end: 10,
        track: "media",
      },
      range: { mode: "globalSeconds", start: 5, end: 10 },
      description: "Cut out 5–10s across media clips",
    },
    {
      type: "trim",
      target: { kind: "lastClip", track: "media" },
      sides: { right: { mode: "deltaSeconds", delta: 5 } },
      description: "Trim 5s off the end of the last media clip",
    },
  ];

  const batchResult = executeInstructionBatch({
    instructions,
    options: {
      stopOnError: false,
      showBatchToast: true,
    },
  });

  console.log("Planned example results:", batchResult);
}

// =============================================================================
// DEBUGGING UTILITIES
// =============================================================================

/**
 * Get current timeline state for debugging
 */
export function debugTimelineState(): void {
  const { useTimelineStore } = require("@/stores/timeline-store");
  const { usePlaybackStore } = require("@/stores/playback-store");

  const timeline = useTimelineStore.getState();
  const playback = usePlaybackStore.getState();

  console.log("=== Timeline Debug Info ===");
  console.log("Current time:", playback.currentTime);
  console.log("Total duration:", timeline.getTotalDuration());
  console.log("Tracks:", timeline.tracks.length);

  timeline.tracks.forEach((track: any, i: number) => {
    console.log(
      `Track ${i + 1} (${track.type}): ${track.elements.length} elements`
    );
    track.elements.forEach((element: any, j: number) => {
      const effectiveDuration =
        element.duration - element.trimStart - element.trimEnd;
      const endTime = element.startTime + effectiveDuration;
      console.log(
        `  Element ${j + 1}: "${element.name}" ${element.startTime}s-${endTime}s (${effectiveDuration}s)`
      );
    });
  });

  toast.success("Timeline state logged to console");
}

/**
 * Quick test function that can be called from browser console
 * Usage: window.testAgent?.quickTest()
 */
export function quickTest(): void {
  console.log("Running quick agent system test...");
  testTargetResolution();
  setTimeout(() => testPlannedExample(), 1000);
}

// =============================================================================
// BROWSER CONSOLE INTEGRATION
// =============================================================================

/**
 * Expose test functions to browser console for development
 * Call this once to enable window.testAgent
 */
export function enableConsoleTests(): void {
  if (typeof window !== "undefined") {
    (window as any).testAgent = {
      quickTest,
      testTargetResolution,
      testInstructionValidation,
      testSingleInstruction,
      testInstructionBatch,
      testPlannedExample,
      debugTimelineState,
      // Example data
      exampleTrimInstructions: EXAMPLE_TRIM_INSTRUCTIONS,
      exampleCutOutInstructions: EXAMPLE_CUT_OUT_INSTRUCTIONS,
      exampleMixedInstructions: EXAMPLE_MIXED_INSTRUCTIONS,
    };

    console.log("Agent test functions available at window.testAgent");
    console.log("Try: window.testAgent.quickTest()");
  }
}
