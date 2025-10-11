"use client";

import { useEffect, useRef } from "react";
import type {
  ChatMessage,
  ChatIcon,
  AgentProgressStatus,
} from "@/stores/agent-ui-store";
import { useAgentUIStore } from "@/stores/agent-ui-store";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  BadgeCheck,
  MessageCircleX,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function renderLogIcon(icon?: ChatIcon, status?: AgentProgressStatus) {
  if (!icon) return null;
  if (icon === "badge-check") {
    const isPending = status === "pending";
    return (
      <BadgeCheck
        className={cn(
          "h-4 w-4 shrink-0",
          isPending ? "text-emerald-200/70" : "text-emerald-400"
        )}
      />
    );
  }
  if (icon === "message-circle-x") {
    return (
      <MessageCircleX className="h-4 w-4 shrink-0 text-red-400" />
    );
  }
  return null;
}

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

        if (isThought) {
          const collapsed = Boolean(m.collapsed);
          const autoCollapsed = Boolean(m.autoCollapsed);
          const label = m.title || "Thought";
          const toggleThought = () =>
            updateMessageById(m.id, {
              collapsed: !collapsed,
              autoCollapsed: true,
            });

          // Auto-collapse once streaming finishes so it shows just "Thought"
          if (!m.streaming && !collapsed && !autoCollapsed) {
            queueMicrotask(() =>
              updateMessageById(m.id, { collapsed: true, autoCollapsed: true })
            );
          }

          const arrowIcon = collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          );

          return (
            <div key={m.id} className="flex w-full justify-start">
              <div
              className={cn(
                "group relative max-w-[95%] rounded-2xl border px-4 pr-10 py-2.5 text-[16px] leading-6",
                  "whitespace-pre-wrap break-words transition-colors",
                  collapsed
                    ? "border-primary/30 bg-primary/5 text-primary-200/90"
                    : "border-primary/40 bg-primary/10 text-primary-100"
                )}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={toggleThought}
                  aria-expanded={!collapsed}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      toggleThought();
                    }
                  }}
                >
                  {!collapsed && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12px] uppercase tracking-wide text-primary-200/75">
                        {label.toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="mt-1 text-[15px] leading-6 text-primary-100/90">
                    {collapsed ? (
                      <span className="font-semibold text-primary-200/85">
                        {label}
                      </span>
                    ) : (
                      m.content
                    )}
                  </div>
                </button>
                <Button
                  type="button"
                  variant="text"
                  size="icon"
                  aria-label={collapsed ? "Expand thought" : "Collapse thought"}
                  aria-expanded={!collapsed}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleThought();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleThought();
                    }
                  }}
                  className="absolute right-2 top-3 h-6 w-6 rounded-full text-primary-200 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  {arrowIcon}
                </Button>
              </div>
            </div>
          );
        }

        const systemContent =
          isSystem && m.icon ? (
            <div className="flex items-center gap-2">
              <span className="flex-1">{m.content}</span>
              {renderLogIcon(m.icon, m.status)}
            </div>
          ) : (
            m.content
          );

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
                  "border-primary/40 bg-primary text-foreground shadow-soft",
                isAgent &&
                  "border-border/30 bg-foreground/5 text-foreground shadow-soft/50",
                isSystem &&
                  "rounded-xl border-border/30 bg-surface-elevated/70 text-muted-foreground text-[14px] leading-6"
              )}
            >
              {systemContent}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
