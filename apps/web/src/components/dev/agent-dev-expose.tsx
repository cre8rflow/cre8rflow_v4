"use client";

import { useEffect } from "react";
import { useAgentOrchestrator } from "@/hooks/use-agent-orchestrator";

/**
 * Development-only helper to expose a global `runAgent(prompt)`
 * in the browser console for quick manual testing.
 */
export function AgentDevExpose() {
  const runAgent = useAgentOrchestrator();

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const globalWindow = window as unknown as {
      runAgent?: (prompt: string) => void;
    };

    globalWindow.runAgent = (prompt: string) => {
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        // eslint-disable-next-line no-console
        console.warn("runAgent requires a non-empty string prompt");
        return;
      }
      runAgent({ prompt: prompt.trim() });
    };

    // eslint-disable-next-line no-console
    console.info(
      "Agent console helper attached. Use runAgent('<your prompt>') to start an agent session."
    );

    return () => {
      // Avoid using delete; set to undefined on cleanup
      globalWindow.runAgent = undefined;
    };
  }, [runAgent]);

  return null;
}
