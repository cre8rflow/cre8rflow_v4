"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";

import { useAgentOrchestrator } from "@/hooks/use-agent-orchestrator";
import { useAgentUIStore, type AgentRunStatus } from "@/stores/agent-ui-store";

const quickSuggestions: { label: string; prompt: string }[] = [
  { label: "Auto-Cut Silence", prompt: "auto-cut silence across the timeline" },
  {
    label: "Highlight Reel",
    prompt: "create a highlight reel of the best moments",
  },
  { label: "Add Subtitles", prompt: "generate subtitles for the video" },
  { label: "Color Grade", prompt: "apply cinematic color grading" },
  { label: "Sync to Music", prompt: "sync cuts to the beat of the music" },
  {
    label: "Cinematic Look",
    prompt: "apply cinematic look and stabilize footage",
  },
  { label: "Vertical Crop", prompt: "vertical crop for 9:16 short" },
];

export function AgentPanel() {
  const runAgent = useAgentOrchestrator();
  const eventSourceRef = useRef<EventSource | null>(null);

  const {
    status,
    message,
    lastPrompt,
    startSession,
    updateMessage,
    markComplete,
    markError,
    reset,
  } = useAgentUIStore();

  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<
    { id: string; type: "log" | "step" | "done" | "error"; message: string }[]
  >([]);

  const isRunning = status === "running";

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const appendLog = (entry: {
    type: "log" | "step" | "done" | "error";
    message: string;
  }) => {
    setLogs((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, ...entry },
    ]);
  };

  const handleStart = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    eventSourceRef.current?.close();
    setLogs([]);

    startSession(trimmed);
    appendLog({ type: "log", message: `Starting: "${trimmed}"` });

    const es = runAgent({ prompt: trimmed });
    eventSourceRef.current = es;

    es.addEventListener("message", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.event === "log" && data.message) {
          updateMessage(data.message);
          appendLog({ type: "log", message: data.message });
        } else if (data.event === "step") {
          const desc =
            data.instruction?.description ||
            `Step ${(data.stepIndex ?? 0) + 1}/${data.totalSteps ?? "?"}`;
          updateMessage(desc);
          appendLog({ type: "step", message: desc });
        } else if (data.event === "done") {
          markComplete("Command processed successfully");
          appendLog({ type: "done", message: "Agent session complete" });
          eventSourceRef.current?.close();
        } else if (data.event === "error") {
          markError(data.message || "Agent error");
          appendLog({ type: "error", message: data.message || "Agent error" });
          eventSourceRef.current?.close();
        }
      } catch {
        // ignore malformed lines
      }
    });

    es.addEventListener("error", () => {
      markError("Stream connection error");
      appendLog({ type: "error", message: "Stream connection error" });
      eventSourceRef.current?.close();
    });
  };

  const submitPrompt = () => {
    if (!prompt.trim()) return;
    handleStart(prompt);
    setPrompt("");
  };

  const handleStop = () => {
    eventSourceRef.current?.close();
    appendLog({ type: "log", message: "Session cancelled" });
    reset();
  };

  const statusMeta = useMemo(() => getStatusMeta(status), [status]);

  return (
    <div className="flex h-full flex-col rounded-3xl border border-border/50 bg-surface-elevated/90 shadow-soft">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-quick-action shadow-soft">
            <Image
              src="/kallio_white_outline.png"
              alt="Kallio"
              width={24}
              height={24}
              className="h-6 w-6 object-contain"
              priority
            />
          </div>
          <div>
            <p className="text-sm font-semibold">Command Console</p>
            <p className="text-xs text-muted-foreground">
              Describe the edit you want—Cre8rFlow will handle the timeline.
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
            statusMeta.pillClass
          )}
        >
          {statusMeta.icon}
          {statusMeta.label}
        </span>
      </div>

      <div className="px-4 pb-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {quickSuggestions.map((suggestion) => (
            <Button
              key={suggestion.label}
              type="button"
              variant="secondary"
              className="justify-between rounded-xl border border-border/40 bg-quick-action/50 px-3 py-4 text-left text-sm font-medium text-foreground shadow-soft transition hover:bg-quick-action"
              onClick={() => handleStart(suggestion.prompt)}
              disabled={isRunning}
            >
              <span>{suggestion.label}</span>
              <Sparkles className="h-4 w-4 opacity-80" />
            </Button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="rounded-2xl border border-border/40 bg-surface-base/70 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Current Command
              </p>
              <p className="mt-1 truncate text-sm font-semibold">
                {lastPrompt ?? "Idle"}
              </p>
              {message && (
                <p className="mt-1 text-xs text-muted-foreground/80">
                  {message}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {status === "running" && (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              {status === "completed" && (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              )}
              {status === "error" && (
                <AlertTriangle className="h-4 w-4 text-red-400" />
              )}
            </div>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-2 pb-4">
          {logs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/40 bg-surface-base/50 p-4 text-sm text-muted-foreground">
              Agent activity will appear here once a command is running.
            </div>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "rounded-lg border border-border/30 bg-surface-elevated px-3 py-2 text-xs font-medium",
                  entry.type === "error" && "border-red-500/40 text-red-300",
                  entry.type === "done" &&
                    "border-emerald-500/40 text-emerald-300"
                )}
              >
                <span className="uppercase tracking-wide text-[0.65rem] opacity-70">
                  {entry.type}
                </span>
                <span className="ml-2 text-foreground/90">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border/40 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Tell Kallio what to do…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitPrompt();
                }
              }}
              disabled={isRunning}
              className="h-11 rounded-xl bg-surface-base/70"
            />
            <ArrowUpRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {isRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl border-border/50"
              onClick={handleStop}
            >
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="rounded-xl px-6"
              onClick={submitPrompt}
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function getStatusMeta(status: AgentRunStatus) {
  switch (status) {
    case "running":
      return {
        label: "Running",
        pillClass: "bg-primary/20 text-primary",
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      };
    case "completed":
      return {
        label: "Completed",
        pillClass: "bg-emerald-500/15 text-emerald-400",
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case "error":
      return {
        label: "Needs attention",
        pillClass: "bg-red-500/15 text-red-400",
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    default:
      return {
        label: "Idle",
        pillClass: "bg-surface-base text-muted-foreground",
        icon: (
          <Image
            src="/kallio_white_outline.png"
            alt="Kallio"
            width={14}
            height={14}
            className="h-3.5 w-3.5 object-contain"
            priority
          />
        ),
      };
  }
}
