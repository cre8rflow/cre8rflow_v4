/**
 * Agent Starter Component
 * Provides UI for triggering agent-driven editing sessions
 */

"use client";

import { useState } from "react";
import { useAgentOrchestrator } from "@/hooks/use-agent-orchestrator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Simple agent starter with input and run button
 */
export function AgentStarter() {
  const runAgent = useAgentOrchestrator();
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setIsRunning(true);

    // Start agent session
    const eventSource = runAgent({ prompt: trimmedPrompt });

    // Reset running state when session ends
    eventSource.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "done" || data.event === "error") {
          setIsRunning(false);
        }
      } catch {
        // Ignore parsing errors for state management
      }
    });

    eventSource.addEventListener("error", () => {
      setIsRunning(false);
    });

    // Clear prompt after starting
    setPrompt("");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && prompt.trim() && !isRunning) {
      handleRun();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe your edit (e.g., cut out 5–10s...)"
        disabled={isRunning}
        aria-label="Agent prompt"
        className="flex-1"
      />
      <Button
        type="button"
        onClick={handleRun}
        disabled={!prompt.trim() || isRunning}
        aria-label={isRunning ? "Agent running" : "Run agent"}
      >
        {isRunning ? "Running..." : "Run"}
      </Button>
    </div>
  );
}

/**
 * Compact agent starter for toolbar integration
 */
export function CompactAgentStarter() {
  const runAgent = useAgentOrchestrator();
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setIsRunning(true);

    const eventSource = runAgent({ prompt: trimmedPrompt });

    // Reset state on completion
    eventSource.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "done" || data.event === "error") {
          setIsRunning(false);
        }
      } catch {
        // Ignore parsing errors
      }
    });

    eventSource.addEventListener("error", () => {
      setIsRunning(false);
    });

    setPrompt("");
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && prompt.trim() && !isRunning) {
            handleRun();
          }
        }}
        placeholder="Agent prompt..."
        disabled={isRunning}
        aria-label="Agent prompt"
        className="h-8 text-sm"
      />
      <Button
        type="button"
        onClick={handleRun}
        disabled={!prompt.trim() || isRunning}
        size="sm"
        variant="outline"
        aria-label={isRunning ? "Agent running" : "Run agent"}
      >
        {isRunning ? "..." : "AI"}
      </Button>
    </div>
  );
}

/**
 * Agent starter with quick action buttons
 */
export function AgentStarterWithPresets() {
  const runAgent = useAgentOrchestrator();
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = (customPrompt?: string) => {
    const finalPrompt = (customPrompt || prompt).trim();
    if (!finalPrompt) return;

    setIsRunning(true);

    const eventSource = runAgent({ prompt: finalPrompt });

    // Reset state on completion
    eventSource.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "done" || data.event === "error") {
          setIsRunning(false);
        }
      } catch {
        // Ignore parsing errors
      }
    });

    eventSource.addEventListener("error", () => {
      setIsRunning(false);
    });

    if (!customPrompt) setPrompt("");
  };

  const presets = [
    { label: "Cut 5-10s", prompt: "cut out 5–10 seconds" },
    { label: "Trim Last", prompt: "trim the last clip by 2 seconds" },
    { label: "Cut 2-3s", prompt: "cut out 2–3 seconds" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && prompt.trim() && !isRunning) {
              handleRun();
            }
          }}
          placeholder="Describe your edit..."
          disabled={isRunning}
          aria-label="Agent prompt"
          className="flex-1"
        />
        <Button
          type="button"
          onClick={() => handleRun()}
          disabled={!prompt.trim() || isRunning}
          aria-label={isRunning ? "Agent running" : "Run agent"}
        >
          {isRunning ? "Running..." : "Run"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Quick actions:</span>
        {presets.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleRun(preset.prompt)}
            disabled={isRunning}
            aria-label={`Quick action: ${preset.prompt}`}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Agent starter for development/testing
 * Includes debugging features and verbose output
 */
export function DevAgentStarter() {
  const runAgent = useAgentOrchestrator();
  const [prompt, setPrompt] = useState(
    "cut out 5–10 seconds and trim the last clip by 5 seconds"
  );
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogs((prev) => [
      ...prev.slice(-4),
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  const handleRun = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setIsRunning(true);
    setLogs([]);
    addLog(`Starting: "${trimmedPrompt}"`);

    const eventSource = runAgent({ prompt: trimmedPrompt });

    // Enhanced logging for development
    eventSource.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        addLog(
          `${data.event}: ${data.message || data.instruction?.description || "Unknown"}`
        );

        if (data.event === "done" || data.event === "error") {
          setIsRunning(false);
        }
      } catch (error) {
        addLog(`Parse error: ${error}`);
      }
    });

    eventSource.addEventListener("error", () => {
      setIsRunning(false);
      addLog("Connection error");
    });
  };

  return (
    <div className="space-y-4 p-4 border rounded">
      <div className="flex items-center gap-2">
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && prompt.trim() && !isRunning) {
              handleRun();
            }
          }}
          placeholder="Agent prompt for testing..."
          disabled={isRunning}
          aria-label="Agent prompt"
          className="flex-1 font-mono text-sm"
        />
        <Button
          type="button"
          onClick={handleRun}
          disabled={!prompt.trim() || isRunning}
        >
          {isRunning ? "Running..." : "Test"}
        </Button>
      </div>

      {logs.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Logs:</h4>
          <div className="bg-muted p-2 rounded text-xs font-mono space-y-1 max-h-32 overflow-y-auto">
            {logs.map((log, index) => (
              <div key={index}>{log}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
