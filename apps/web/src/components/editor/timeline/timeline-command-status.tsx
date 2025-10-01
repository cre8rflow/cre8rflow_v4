"use client";

import { useMemo } from "react";
import { useActiveTimelineCommands } from "@/stores/timeline-command-store";
import { cn } from "@/lib/utils";

export function TimelineCommandStatusBar() {
  const active = useActiveTimelineCommands();
  const currentCommand = useMemo(() => {
    if (!active.length) return null;
    // Prefer commands still executing; fall back to the first in list
    return active.find((command) => command.phase === "executing") ?? active[0];
  }, [active]);

  if (!currentCommand) {
    return null;
  }

  const { description, progress, currentStep, totalSteps, type, phase, theme } =
    currentCommand;

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const label =
    description ||
    (type === "trim"
      ? "Applying trims"
      : type === "cut"
        ? "Cutting clips"
        : type === "caption"
          ? "Generating captions"
          : "Processing timeline");

  return (
    <div className="pointer-events-none absolute left-4 right-4 top-2 z-[60] flex flex-col gap-1 text-xs">
      <div
        className="flex items-center justify-between rounded-xl border bg-surface-elevated/95 px-3 py-2 shadow-lg/40"
        style={{
          borderColor: theme.color,
          boxShadow: `0 0 0 1px color-mix(in srgb, ${theme.color} 20%, transparent), 0 10px 35px -20px color-mix(in srgb, ${theme.color} 35%, transparent)`,
        }}
      >
        <div className="flex flex-col">
          <span className="font-medium text-foreground/90">{label}</span>
          <span className="text-foreground/60 text-[11px]">
            {phase === "complete"
              ? "Completed"
              : phase === "error"
                ? "Encountered an error"
                : totalSteps > 0
                  ? `Step ${Math.min(currentStep, totalSteps)} of ${totalSteps}`
                  : "Working"}
          </span>
        </div>
        <span className="text-foreground/70 text-[11px]">
          {Math.round(clampedProgress * 100)}%
        </span>
      </div>
      <div
        className="relative h-[5px] rounded-full overflow-hidden"
        style={{ background: theme.fill }}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all",
            phase === "error" ? "bg-destructive" : undefined
          )}
          style={{
            width: `${clampedProgress * 100}%`,
            background:
              phase === "error"
                ? undefined
                : `linear-gradient(90deg, ${theme.color}, rgba(255,255,255,0.65))`,
          }}
        />
      </div>
    </div>
  );
}
