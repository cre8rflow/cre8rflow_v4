"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { CSSProperties } from "react";
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

  return (
    <AnimatePresence initial={false}>
      {summary ? (
        <Banner summary={summary} activeCount={active.length} key={summary.primary.id} />
      ) : null}
    </AnimatePresence>
  );
}

interface BannerProps {
  summary: NonNullable<ReturnType<typeof summarizeCommands>>;
  activeCount: number;
}

function Banner({ summary, activeCount }: BannerProps) {
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

  const styleVars: CSSProperties = {
    "--command-banner-accent": primary.theme?.color ?? "var(--command-generic-color)",
    "--command-banner-highlight":
      primary.theme?.highlight ?? "var(--command-generic-highlight)",
    "--command-banner-fill": primary.theme?.fill ?? "var(--command-generic-fill)",
  };

  return (
    <motion.div
      className="timeline-command-banner"
      style={styleVars}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      layout
    >
      <div className="timeline-command-banner__top">
        <motion.span
          className="timeline-command-banner__spinner"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
        >
          <Loader2 className="h-4 w-4" />
        </motion.span>
        <div className="timeline-command-banner__copy">
          <span className="timeline-command-banner__title">{detailText}</span>
          <span className="timeline-command-banner__subtitle">
            {operationsLabel} · {activeCount} active command
            {activeCount === 1 ? "" : "s"}
          </span>
        </div>
        <span className="timeline-command-banner__label">{effectLabel}</span>
      </div>
      <div className="timeline-command-banner__progress" aria-hidden>
        <motion.div
          className="timeline-command-banner__progress-fill"
          initial={{ width: 0 }}
          animate={{ width: `${percent * 100}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        />
      </div>
      <div className="timeline-command-banner__footer">
        <span className="timeline-command-banner__footer-primary">
          Timeline command in progress
        </span>
        <span className="timeline-command-banner__footer-secondary">
          {roundedPercent}%
        </span>
      </div>
    </motion.div>
  );
}
