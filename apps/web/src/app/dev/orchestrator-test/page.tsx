/**
 * Development page for testing the agentic edit system
 * Navigate to /dev/orchestrator-test to test the agent system with hardcoded instructions
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

// Agent system imports
import type { AgentInstruction } from "@/types/agent";
import {
  executeInstruction,
  executeInstructionBatch,
  validateInstructionForExecution,
} from "@/lib/agent-executor";
import {
  resolveTargets,
  describeTargetSpec,
  describeTargets,
} from "@/lib/agent-resolver";
import {
  EXAMPLE_TRIM_INSTRUCTIONS,
  EXAMPLE_CUT_OUT_INSTRUCTIONS,
  testTargetResolution,
  testInstructionValidation,
  testPlannedExample,
  debugTimelineState,
  enableConsoleTests,
} from "@/lib/agent-test";
import {
  AgentStarter,
  DevAgentStarter,
} from "@/components/editor/agent/AgentStarter";

export default function OrchestratorTestPage() {
  const [selectedInstruction, setSelectedInstruction] =
    useState<AgentInstruction | null>(null);
  const [executionResults, setExecutionResults] = useState<string[]>([]);

  const addResult = (result: string) => {
    setExecutionResults((prev) => [...prev.slice(-4), result]); // Keep last 5 results
  };

  const handleExecuteInstruction = (instruction: AgentInstruction) => {
    console.log("Executing instruction:", instruction);

    const validation = validateInstructionForExecution({ instruction });
    if (!validation.valid) {
      const issues = validation.issues.join(", ");
      toast.error(`Validation failed: ${issues}`);
      addResult(`❌ Validation failed: ${issues}`);
      return;
    }

    const result = executeInstruction({ instruction });
    const resultText = result.success
      ? `✅ ${instruction.description || instruction.type} (${result.targetsResolved} targets)`
      : `❌ ${instruction.description || instruction.type}: ${"error" in result ? result.error : "Unknown error"}`;

    addResult(resultText);
  };

  const handleBatchTest = () => {
    const instructions = [
      ...EXAMPLE_TRIM_INSTRUCTIONS.slice(0, 2),
      ...EXAMPLE_CUT_OUT_INSTRUCTIONS.slice(0, 1),
    ];

    const batchResult = executeInstructionBatch({
      instructions,
      options: {
        stopOnError: false,
        showBatchToast: true,
      },
    });

    addResult(
      `📦 Batch: ${batchResult.totalSuccess} success, ${batchResult.totalErrors} errors`
    );
  };

  const handleTestResolution = () => {
    testTargetResolution();
    addResult("🎯 Target resolution test completed (check console)");
  };

  const enableConsoleTestsHandler = () => {
    enableConsoleTests();
    toast.success("Console tests enabled! Try window.testAgent.quickTest()");
    addResult("🔧 Console tests enabled (window.testAgent)");
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Agent System Test Page</h1>
          <p className="text-lg text-muted-foreground">
            Test the complete agent system with SSE streaming and instruction
            execution
          </p>
          <div className="flex gap-2 justify-center">
            <Badge variant="outline">SSE Streaming</Badge>
            <Badge variant="outline">Target Resolution</Badge>
            <Badge variant="outline">Command Execution</Badge>
            <Badge variant="outline">Batch Processing</Badge>
          </div>
        </div>

        {/* SSE Agent Interface */}
        <Card>
          <CardHeader>
            <CardTitle>🤖 Live Agent Interface</CardTitle>
            <CardDescription>
              Type natural language prompts to trigger real-time timeline edits
              via SSE streaming
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AgentStarter />
            <div className="text-sm text-muted-foreground">
              <p className="font-semibold mb-2">Try these prompts:</p>
              <ul className="space-y-1">
                <li>
                  • "cut out 5–10 seconds and trim the last clip by 5 seconds"
                </li>
                <li>• "trim the 2nd clip by 0.5s on the right"</li>
                <li>• "cut out 2–3 seconds"</li>
                <li>• "do something random" (fallback behavior)</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Development Interface */}
        <Card>
          <CardHeader>
            <CardTitle>🔧 Development Interface</CardTitle>
            <CardDescription>
              Enhanced agent interface with detailed logging for development and
              debugging
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DevAgentStarter />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Instruction Selection */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Test Instructions</CardTitle>
              <CardDescription>
                Click on an instruction to execute it. Make sure you have media
                elements in your timeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Trim Instructions */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                  Trim Instructions
                </h3>
                <div className="grid gap-2">
                  {EXAMPLE_TRIM_INSTRUCTIONS.map((instruction, index) => (
                    <Button
                      key={`trim-${index}`}
                      variant={
                        selectedInstruction === instruction
                          ? "default"
                          : "outline"
                      }
                      className="justify-start h-auto p-4"
                      onClick={() => {
                        setSelectedInstruction(instruction);
                        handleExecuteInstruction(instruction);
                      }}
                    >
                      <div className="text-left">
                        <div className="font-medium">
                          {instruction.description}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Target: {describeTargetSpec(instruction.target)}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>

              {/* Cut-Out Instructions */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                  Cut-Out Instructions
                </h3>
                <div className="grid gap-2">
                  {EXAMPLE_CUT_OUT_INSTRUCTIONS.map((instruction, index) => (
                    <Button
                      key={`cutout-${index}`}
                      variant={
                        selectedInstruction === instruction
                          ? "default"
                          : "outline"
                      }
                      className="justify-start h-auto p-4"
                      onClick={() => {
                        setSelectedInstruction(instruction);
                        handleExecuteInstruction(instruction);
                      }}
                    >
                      <div className="text-left">
                        <div className="font-medium">
                          {instruction.description}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Target: {describeTargetSpec(instruction.target)}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Controls & Results */}
          <div className="space-y-6">
            {/* Test Controls */}
            <Card>
              <CardHeader>
                <CardTitle>Test Controls</CardTitle>
                <CardDescription>
                  Run various tests and utilities
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={testPlannedExample}
                  className="w-full"
                  variant="default"
                >
                  Run Planned Example
                </Button>
                <Button
                  onClick={handleBatchTest}
                  className="w-full"
                  variant="outline"
                >
                  Run Batch Test
                </Button>
                <Button
                  onClick={handleTestResolution}
                  className="w-full"
                  variant="outline"
                >
                  Test Target Resolution
                </Button>
                <Button
                  onClick={debugTimelineState}
                  className="w-full"
                  variant="outline"
                >
                  Debug Timeline State
                </Button>
                <Button
                  onClick={enableConsoleTestsHandler}
                  className="w-full"
                  variant="secondary"
                >
                  Enable Console Tests
                </Button>
              </CardContent>
            </Card>

            {/* Execution Results */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Results</CardTitle>
                <CardDescription>Last few execution results</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {executionResults.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No executions yet. Click an instruction above to test.
                    </p>
                  ) : (
                    executionResults.map((result, index) => (
                      <div
                        key={index}
                        className="text-sm p-2 rounded bg-muted/50 font-mono"
                      >
                        {result}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Usage Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Usage Instructions</CardTitle>
            <CardDescription>How to test the agent system</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-semibold">Prerequisites</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Have an active project with timeline elements</li>
                  <li>• Add some media clips to test with</li>
                  <li>
                    • Position playhead at different times to test
                    "clipAtPlayhead"
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold">Console Testing</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Click "Enable Console Tests" button</li>
                  <li>• Open browser console (F12)</li>
                  <li>
                    • Try:{" "}
                    <code className="bg-muted px-1 rounded">
                      window.testAgent.quickTest()
                    </code>
                  </li>
                  <li>
                    • Explore other methods on{" "}
                    <code className="bg-muted px-1 rounded">
                      window.testAgent
                    </code>
                  </li>
                </ul>
              </div>
            </div>

            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-semibold mb-2">Expected Behavior</h4>
              <p className="text-sm text-muted-foreground">
                Instructions should resolve abstract targets (like "lastClip",
                "clipAtPlayhead") to concrete timeline elements, then execute
                trim/cut-out operations using the existing command system. Each
                instruction creates one undo/redo entry. Check the browser
                console for detailed execution logs.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
