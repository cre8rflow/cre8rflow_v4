"use client";

import { create } from "zustand";

export type AgentRunStatus = "idle" | "running" | "completed" | "error";

type AgentUIState = {
  status: AgentRunStatus;
  lastPrompt: string | null;
  message: string | null;
  progress: number | null;
  updatedAt: number | null;
  startSession: (prompt: string) => void;
  updateMessage: (message: string) => void;
  updateProgress: (progress: number | null) => void;
  markComplete: (message?: string) => void;
  markError: (message: string) => void;
  reset: () => void;
};

export const useAgentUIStore = create<AgentUIState>((set) => ({
  status: "idle",
  lastPrompt: null,
  message: null,
  progress: null,
  updatedAt: null,
  startSession: (prompt) =>
    set({
      status: "running",
      lastPrompt: prompt,
      message: "Analyzing clip content…",
      progress: null,
      updatedAt: Date.now(),
    }),
  updateMessage: (message) =>
    set({
      message,
      updatedAt: Date.now(),
    }),
  updateProgress: (progress) =>
    set({
      progress,
      updatedAt: Date.now(),
    }),
  markComplete: (message) =>
    set({
      status: "completed",
      message: message ?? "Command processed successfully",
      progress: 1,
      updatedAt: Date.now(),
    }),
  markError: (message) =>
    set({
      status: "error",
      message,
      updatedAt: Date.now(),
    }),
  reset: () =>
    set({
      status: "idle",
      message: null,
      progress: null,
      lastPrompt: null,
      updatedAt: Date.now(),
    }),
}));

