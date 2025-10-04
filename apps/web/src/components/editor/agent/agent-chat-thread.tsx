"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/stores/agent-ui-store";
import { useAgentUIStore } from "@/stores/agent-ui-store";
import { cn } from "@/lib/utils";

export function AgentChatThread({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const updateMessageById = useAgentUIStore((s) => s.updateMessageById);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!messages.length) {
    return (
      <div className="rounded-xl border border-dashed border-border/40 bg-surface-base/50 p-4 text-sm text-muted-foreground">
        Agent activity will appear here once a command is running.
      </div>
    );
  }

  return (
    <div className="space-y-2.5 pb-4" aria-live="polite" aria-atomic>
      {messages.map((m) => {
        const isUser = m.role === "user";
        const isAgent = m.role === "agent";
        const isSystem = m.role === "log" || m.role === "system";
        const isThought = m.role === "thought";

        if (isThought && !m.streaming && m.collapsed) {
          // Collapsed thought row with toggle
          return (
            <div key={m.id} className="flex w-full justify-start">
              <button
                type="button"
                aria-expanded="false"
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[13px] text-primary-300",
                  "hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1"
                )}
                onClick={() => updateMessageById(m.id, { collapsed: false })}
                title={m.title || "Thought"}
              >
                <span className="i-lucide-chevron-down rotate-[-90deg]" aria-hidden />
                <span>{m.title || "Thought"}</span>
              </button>
            </div>
          );
        }

        return (
          <div
            key={m.id}
            className={cn(
              "flex w-full",
              isUser ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[88%] rounded-2xl border px-3.5 py-2.5 text-[16px] leading-6",
                "whitespace-pre-wrap break-words",
                isUser &&
                  "border-primary/30 bg-primary/15 text-foreground shadow-soft",
                isAgent &&
                  "border-border/30 bg-surface-elevated text-foreground shadow-soft/50",
                isSystem &&
                  "rounded-xl border-border/30 bg-surface-elevated/70 text-muted-foreground text-[14px] leading-6",
                isThought &&
                  "rounded-xl border-primary/40 bg-primary/5 text-primary-300 italic text-[14px] leading-6"
              )}
            >
              {isThought && !m.streaming && !m.collapsed ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[12px] uppercase tracking-wide opacity-70">
                      {m.title || "Thought"}
                    </span>
                    <button
                      type="button"
                      className="text-[12px] text-primary-300 hover:text-primary-200"
                      onClick={() => updateMessageById(m.id, { collapsed: true })}
                      aria-label="Collapse thought"
                    >
                      Hide
                    </button>
                  </div>
                  <div>{m.content}</div>
                </div>
              ) : (
                <>
                  {m.content}
                  {isThought && m.streaming && (
                    <span className="ml-1 animate-pulse">…</span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}


