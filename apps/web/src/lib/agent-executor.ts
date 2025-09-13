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

// =============================================================================
// RESULT TYPES
// =============================================================================

export interface ExecutionResult {
  success: true;
  targetsResolved: number;
  message?: string;
}

export interface ExecutionError {
  success: false;
  error: string;
  targetsResolved?: number;
}

export type ExecutionOutcome = ExecutionResult | ExecutionError;

// =============================================================================
// MAIN EXECUTOR FUNCTION
// =============================================================================

/**
 * Execute any instruction (agent or server-side)
 * This is the main entry point for instruction execution
 */
export function executeInstruction({
  instruction,
}: {
  instruction: AnyInstruction;
}): ExecutionOutcome {
  // Handle server-side instructions
  if (isServerInstruction(instruction)) {
    return executeServerInstruction({ instruction });
  }

  // Handle client-side agent instructions
  if (isAgentInstruction(instruction)) {
    return executeAgentInstruction({ instruction });
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
  instruction: Extract<AnyInstruction, { type: "twelvelabs.analyze" }>;
}): ExecutionOutcome {
  // For V1, we just acknowledge server instructions
  // In future versions, this could trigger API calls or other operations
  console.log("Server instruction received:", instruction);

  return {
    success: true,
    targetsResolved: 0,
    message: `Server instruction completed: ${instruction.type}`,
  };
}

/**
 * Execute client-side agent instructions (edit operations)
 */
function executeAgentInstruction({
  instruction,
}: {
  instruction: AgentInstruction;
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
