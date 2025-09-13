"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentOrchestrator } from "@/hooks/use-agent-orchestrator";
import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";

const suggestions: { label: string; prompt: string }[] = [
  { label: "Auto-Cut Silence", prompt: "auto-cut silence across the timeline" },
  { label: "Highlight Reel", prompt: "create a highlight reel of the best moments" },
  { label: "Add Subtitles", prompt: "generate subtitles for the video" },
  { label: "Color Grade", prompt: "apply cinematic color grading" },
  { label: "Sync to Music", prompt: "sync cuts to the beat of the music" },
  { label: "Cinematic Look", prompt: "apply cinematic look and stabilize footage" },
  { label: "Vertical Crop", prompt: "vertical crop for 9:16 short" },
];

export function AgentPanel() {
  const runAgent = useAgentOrchestrator();
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [logs, setLogs] = useState<
    { id: string; type: "log" | "step" | "done" | "error"; message: string }[]
  >([]);

  const appendLog = (
    entry: { type: "log" | "step" | "done" | "error"; message: string },
  ) => {
    setLogs((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, ...entry },
    ]);
  };

  const startSession = (p: string) => {
    // Close prior session if any
    eventSourceRef.current?.close();

    setIsRunning(true);
    appendLog({ type: "log", message: `Starting: "${p}"` });

    const es = runAgent({ prompt: p });
    eventSourceRef.current = es;

    es.addEventListener("message", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.event === "log" && data.message) {
          appendLog({ type: "log", message: data.message });
        } else if (data.event === "step") {
          const desc = data.instruction?.description ||
            `Step ${(data.stepIndex ?? 0) + 1}/${data.totalSteps ?? "?"}`;
          appendLog({ type: "step", message: desc });
        } else if (data.event === "done") {
          appendLog({ type: "done", message: "Agent session complete" });
          setIsRunning(false);
        } else if (data.event === "error") {
          appendLog({ type: "error", message: data.message || "Agent error" });
          setIsRunning(false);
        }
      } catch {
        // ignore malformed lines
      }
    });

    es.addEventListener("error", () => {
      appendLog({ type: "error", message: "Stream connection error" });
      setIsRunning(false);
    });
  };

  const submit = () => {
    const p = prompt.trim();
    if (!p) return;
    startSession(p);
    setPrompt("");
  };

  return (
    <div className="h-full w-full bg-panel rounded-sm flex flex-col">
      <div className="px-4 py-3 border-b border-input flex items-center gap-2">
        <div className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent/60 text-foreground/80" aria-hidden>
          <Bot className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            Tell me what edits to apply to your video
          </div>
          <div className="text-xs text-muted-foreground truncate">
            Multi-track timeline ready. Try: "cut out 10–20", "add audio track", or "move title".
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Live session log */}
          {logs.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Live activity</div>
              <div className="rounded-md border border-input bg-muted/40 p-2 text-xs font-mono space-y-1">
                {logs.map((l) => (
                  <div key={l.id} className={cn(
                    l.type === "error" && "text-red-500",
                    l.type === "done" && "text-emerald-600",
                  )}>
                    {l.type.toUpperCase()}: {l.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick suggestions */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {suggestions.map((s) => (
              <Button
                key={s.label}
                type="button"
                variant="secondary"
                className={cn("justify-start px-3 py-5 text-left")}
                onClick={() => startSession(s.prompt)}
                disabled={isRunning}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-input">
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Tell me what edits to apply to your video... (Press Enter to send)"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="Agent prompt"
          containerClassName=""
          disabled={isRunning}
        />
        <div className="mt-2 flex justify-end">
          {isRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                eventSourceRef.current?.close();
                setIsRunning(false);
                appendLog({ type: "log", message: "Session cancelled" });
              }}
            >
              Stop
            </Button>
          ) : (
            <Button type="button" variant="primary" size="sm" onClick={submit}>
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

