"use client";

import { useEffect, useState } from "react";
import { useAgentThoughtStore } from "@/stores/agent-thought-store";
import { cn } from "@/lib/utils";

export function AgentThoughtOverlay() {
  const { text, visible } = useAgentThoughtStore();
  const [fade, setFade] = useState(false);

  useEffect(() => {
    setFade(!visible);
  }, [visible]);

  if (!text) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-4 right-4 top-2 z-[55] transition-opacity duration-300",
        fade ? "opacity-0" : "opacity-100"
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="rounded-xl border border-primary/30 bg-surface-elevated/90 px-4 py-3 italic text-[14px] text-foreground/85 shadow-lg backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-2 w-2 animate-pulse rounded-full bg-primary" />
          <p className="flex-1 leading-relaxed">{text}</p>
        </div>
      </div>
    </div>
  );
}
