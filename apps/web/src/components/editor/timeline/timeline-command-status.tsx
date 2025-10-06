"use client";

import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import {
  useActiveTimelineCommands,
  type CommandEntry,
} from "@/stores/timeline-command-store";

interface TimelineCommandStatusBarProps {
  commands?: CommandEntry[];
}

function summarizeCommands(commands: CommandEntry[]) {
  if (!commands.length) return null;

  const primary =
    commands.find((command) => command.phase === "executing") ?? commands[0];

  const totals = commands.reduce(
    (acc, command) => {
      const hasSteps = command.totalSteps && command.totalSteps > 0;
      const capacity = hasSteps ? command.totalSteps : 1;
      const completed = hasSteps
        ? Math.min(command.currentStep, command.totalSteps)
        : Math.max(0, Math.min(1, command.progress));

      acc.capacity += capacity;
      acc.completed += completed;

      const sample = hasSteps
        ? command.totalSteps > 0
          ? Math.max(0, Math.min(1, command.currentStep / command.totalSteps))
          : 0
        : Math.max(0, Math.min(1, command.progress));

      acc.progressSamples.push(sample);
      acc.activeCount += 1;
      return acc;
    },
    {
      capacity: 0,
      completed: 0,
      progressSamples: [] as number[],
      activeCount: 0,
    }
  );

  const aggregateProgress = totals.capacity
    ? Math.max(0, Math.min(1, totals.completed / totals.capacity))
    : totals.progressSamples.length
      ? totals.progressSamples.reduce((sum, value) => sum + value, 0) /
        totals.progressSamples.length
      : 0;

  const completedOps = totals.capacity
    ? Math.min(totals.capacity, Math.round(totals.completed))
    : Math.round(aggregateProgress * totals.activeCount);
  const totalOps = totals.capacity || totals.activeCount || 1;

  return {
    primary,
    aggregateProgress,
    completedOps,
    totalOps,
  };
}

export function TimelineCommandStatusBar({
  commands,
}: TimelineCommandStatusBarProps) {
  const active = commands ?? useActiveTimelineCommands();

  const summary = useMemo(() => summarizeCommands(active), [active]);

  if (!summary) {
    return null;
  }

  const { primary, aggregateProgress, completedOps, totalOps } = summary;
  const percent = Math.max(0, Math.min(1, aggregateProgress));
  const roundedPercent = Math.round(percent * 100);

  const effectLabel = primary.theme?.label ?? "PROCESSING";
  const detailText =
    primary.description ||
    (effectLabel
      ? `Applying ${effectLabel.toLowerCase()} edits`
      : "Applying timeline changes");

  const operationsLabel = `${Math.min(
    completedOps,
    totalOps
  )} of ${totalOps} operation${totalOps === 1 ? "" : "s"}`;

  return (
    <div className="timeline-processing-overlay">
      <div
        className="timeline-processing-card"
        style={{
          // Provide CSS variables for accent/highlight usage
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore CSS custom property typing
          "--command-frame-color": primary.theme.color,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore CSS custom property typing
          "--command-frame-highlight": primary.theme.highlight,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore CSS custom property typing
          "--command-frame-fill": primary.theme.fill,
        }}
      >
        <div className="timeline-processing-card__header">
          <Loader2 className="timeline-processing-spinner animate-spin" />
          <div className="timeline-processing-card__titles">
            <span className="timeline-processing-card__title">
              Processing Timeline
            </span>
            <span className="timeline-processing-card__subtitle">
              {detailText}
            </span>
          </div>
        </div>
        <span className="timeline-processing-label">{effectLabel}</span>
        <div className="timeline-processing-progress" aria-hidden>
          <div
            className="timeline-processing-progress__bar"
            style={{ width: `${percent * 100}%` }}
          />
        </div>
        <div className="timeline-processing-meta">
          <div className="timeline-processing-meta__operations">
            <span className="timeline-processing-meta__primary">
              {operationsLabel}
            </span>
            <span className="timeline-processing-meta__secondary">
              {active.length} active task{active.length === 1 ? "" : "s"}
            </span>
          </div>
          <span className="timeline-processing-meta__primary">
            {roundedPercent}%
          </span>
        </div>
      </div>
    </div>
  );
}
