"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AgentChatThread } from "./agent-chat-thread";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  Scissors,
  Music2,
  Palette,
  Captions,
  Clapperboard,
  StretchVertical,
  Wand2,
  ArrowUp,
  type LucideIcon,
} from "lucide-react";

import { useAgentOrchestrator } from "@/hooks/use-agent-orchestrator";
import {
  useAgentUIStore,
  type AgentRunStatus,
  type ChatMessage,
} from "@/stores/agent-ui-store";

const quickSuggestions: {
  label: string;
  prompt: string;
  icon: LucideIcon;
}[] = [
  {
    label: "Auto-Cut Silence",
    prompt: "auto-cut silence across the timeline",
    icon: Scissors,
  },
  {
    label: "Highlight Reel",
    prompt: "create a highlight reel of the best moments",
    icon: Wand2,
  },
  {
    label: "Add Subtitles",
    prompt: "generate subtitles for the video",
    icon: Captions,
  },
  {
    label: "Color Grade",
    prompt: "apply cinematic color grading",
    icon: Palette,
  },
  {
    label: "Sync to Music",
    prompt: "sync cuts to the beat of the music",
    icon: Music2,
  },
  {
    label: "Cinematic Look",
    prompt: "apply cinematic look and stabilize footage",
    icon: Clapperboard,
  },
  {
    label: "Vertical Crop",
    prompt: "vertical crop for 9:16 short",
    icon: StretchVertical,
  },
];

export function AgentPanel() {
  const runAgent = useAgentOrchestrator();
  const eventSourceRef = useRef<EventSource | null>(null);
  const thinkingLogIdRef = useRef<string | null>(null);

  const {
    status,
    message,
    lastPrompt,
    startSession,
    updateMessage,
    markComplete,
    markError,
    reset,
    // chat state
    hasStarted,
    messages,
    setHasStarted,
    addUserMessage,
    addAgentMessage,
    addLogMessage,
    appendThoughtDelta,
    finalizeThought,
    clearMessages,
    createThinkingMessage,
    updateMessageById,
  } = useAgentUIStore();

  const [prompt, setPrompt] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const isRunning = status === "running";
  const isPromptEmpty = prompt.trim().length === 0;

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleStart = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    // Prevent double-firing
    if (isRunning) return;

    eventSourceRef.current?.close();
    thinkingLogIdRef.current = null;

    // Chat UX: add user's message and mark started
    addUserMessage(trimmed);
    setHasStarted(true);
    startSession(trimmed);

    // Optimistic thinking row immediately
    thinkingLogIdRef.current = createThinkingMessage();
    updateMessage("Thinking…");

    const es = runAgent({ prompt: trimmed });
    eventSourceRef.current = es;

    es.addEventListener("message", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.event === "log" && data.message) {
          // Filter logs from chat; keep header status only
          updateMessage(data.message);
        } else if (data.event === "thought" && data.delta) {
          // Stream thought text into a single message
          const id = appendThoughtDelta(thinkingLogIdRef.current, data.delta);
          thinkingLogIdRef.current = id;
        } else if (data.event === "thought_done") {
          const currentThinkingId = thinkingLogIdRef.current;
          if (currentThinkingId) {
            finalizeThought(currentThinkingId);
          }
          thinkingLogIdRef.current = null;
        } else if (data.event === "step") {
          const desc = data.instruction?.description;
          if (desc) {
            // Update header only; don't add chat bubble since we'll show a final AI summary
            updateMessage(desc);
          }
        } else if (data.event === "done") {
          markComplete("Command processed successfully");
          // Insert a placeholder while summarizing
          const placeholderId = addAgentMessage("");
          updateMessageById(placeholderId, { streaming: true });
          // Summarize after all async tasks (e.g., captions) have completed
          (async () => {
            try {
              const exec = await import("@/lib/agent-executor");
              await exec.whenAsyncIdle();

              const mod = await import("@/lib/agent-client");
              const actions = mod.getAndClearExecutedActions();

              let accumulated = "";
              await mod.summarizeExecutedActions(actions, (delta) => {
                accumulated += delta;
                updateMessageById(placeholderId, {
                  content: accumulated,
                  streaming: true,
                });
              });

              if (!actions.length && !accumulated) {
                updateMessageById(placeholderId, {
                  content: "Completed edits.",
                  streaming: false,
                });
                return;
              }

              // Finalize streaming
              updateMessageById(placeholderId, { streaming: false });
            } catch {
              updateMessageById(placeholderId, {
                content: "Made timeline adjustments.",
                streaming: false,
              });
            }
          })();
          eventSourceRef.current?.close();
        } else if (data.event === "error") {
          markError(data.message || "Agent error");
          addAgentMessage(data.message || "Agent error");
          eventSourceRef.current?.close();
        }
      } catch {
        // ignore malformed lines
      }
    });

    es.addEventListener("error", () => {
      markError("Stream connection error");
      addAgentMessage("Stream connection error");
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
    addLogMessage("Session cancelled");
    reset();
  };

  const handleNewSession = () => {
    eventSourceRef.current?.close();
    thinkingLogIdRef.current = null;
    clearMessages();
    reset();
    setHasStarted(false);
  };

  const statusMeta = useMemo(() => getStatusMeta(status), [status]);

  return (
      <div className="flex h-full flex-col rounded-3xl border border-border/40 bg-panel-surface shadow-soft">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-brand-gradient shadow-soft">
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
            <p className="text-lg font-semibold tracking-tight">
              Kallio
            </p>
            <p className="text-[14px] text-muted-foreground leading-5">
              Describe edits you want. Kallio will handle it for you.
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

      {!hasStarted && (
        <div className="px-4 pb-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {quickSuggestions.map(({ label, prompt, icon: Icon }) => (
              <button
                key={label}
                type="button"
                className={cn(
                  "group relative overflow-hidden rounded-2xl border border-border/35 bg-surface-elevated/90 text-left shadow-soft transition",
                  "hover:border-border/20 hover:bg-surface-elevated/95 disabled:cursor-not-allowed disabled:opacity-60"
                )}
                onClick={() => handleStart(prompt)}
                disabled={isRunning}
              >
                <div className="flex w-full items-center justify-between gap-3 rounded-[calc(var(--radius)*1.1)] bg-surface-elevated/95 px-4 py-3 transition group-hover:bg-surface-elevated/85">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-soft">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="flex-1 text-[15px] font-semibold text-foreground">
                    {label}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-foreground/70 transition group-hover:text-white" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

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
        <AgentChatThread messages={messages} />
      </ScrollArea>

      <div className="border-t border-border/40 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 group">
              <span className="pointer-events-none absolute inset-0 rounded-2xl border-5 border-border/50 transition-colors duration-200 group-hover:border-primary/60 group-focus-within:border-primary" />
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
                className="relative h-11 rounded-2xl border-0 bg-surface-base/95 px-4 text-[16px] shadow-none focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-hidden"
              />
            </div>
            <button
              type="button"
              onClick={submitPrompt}
              disabled={isRunning || isPromptEmpty}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-soft transition hover:shadow-medium",
                (isRunning || isPromptEmpty) && "opacity-40 cursor-not-allowed"
              )}
            >
              <ArrowUp className="h-4 w-4" />
              <span className="sr-only">Send command</span>
            </button>
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
            <></>
          )}
          {!isRunning && hasStarted && (
            <Button
              type="button"
              variant="text"
              size="lg"
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={handleNewSession}
              title="Start a new session"
            >
              New session
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
