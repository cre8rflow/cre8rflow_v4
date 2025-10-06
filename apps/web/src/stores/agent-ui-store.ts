"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";

export type AgentRunStatus = "idle" | "running" | "completed" | "error";

export type ChatRole = "user" | "agent" | "log" | "thought" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  ts: number;
  streaming?: boolean;
  collapsed?: boolean;
  title?: string;
};

type AgentUIState = {
  status: AgentRunStatus;
  lastPrompt: string | null;
  message: string | null;
  progress: number | null;
  updatedAt: number | null;
  // Chat state
  hasStarted: boolean;
  messages: ChatMessage[];
  startSession: (prompt: string) => void;
  updateMessage: (message: string) => void;
  updateProgress: (progress: number | null) => void;
  markComplete: (message?: string) => void;
  markError: (message: string) => void;
  reset: () => void;
  // Chat actions
  setHasStarted: (started: boolean) => void;
  clearMessages: () => void;
  addUserMessage: (content: string) => string; // returns id
  addAgentMessage: (content: string) => string; // returns id
  addLogMessage: (content: string) => string; // returns id
  createThinkingMessage: () => string; // optimistic thinking row
  updateMessageById: (id: string, patch: Partial<ChatMessage>) => void;
  appendThoughtDelta: (id: string | null, delta: string) => string; // returns id used
  finalizeThought: (id: string) => void;
};

export const useAgentUIStore = create<AgentUIState>((set, get) => ({
  status: "idle",
  lastPrompt: null,
  message: null,
  progress: null,
  updatedAt: null,
  hasStarted: false,
  messages: [],
  startSession: (prompt) =>
    set({
      status: "running",
      lastPrompt: prompt,
      message: "Analyzing clip content…",
      progress: null,
      updatedAt: Date.now(),
      hasStarted: true,
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
  setHasStarted: (started) => set({ hasStarted: started }),
  clearMessages: () => set({ messages: [] }),
  addUserMessage: (content) => {
    const id = nanoid();
    const msg: ChatMessage = {
      id,
      role: "user",
      content,
      ts: Date.now(),
    };
    set({ messages: [...get().messages, msg] });
    return id;
  },
  addAgentMessage: (content) => {
    const id = nanoid();
    const msg: ChatMessage = {
      id,
      role: "agent",
      content,
      ts: Date.now(),
    };
    set({ messages: [...get().messages, msg] });
    return id;
  },
  addLogMessage: (content) => {
    const id = nanoid();
    const msg: ChatMessage = {
      id,
      role: "log",
      content,
      ts: Date.now(),
    };
    set({ messages: [...get().messages, msg] });
    return id;
  },
  createThinkingMessage: () => {
    const id = nanoid();
    const msg: ChatMessage = {
      id,
      role: "thought",
      content: "Thinking…",
      ts: Date.now(),
      streaming: true,
      collapsed: false,
      title: "Thought",
    };
    set({ messages: [...get().messages, msg] });
    return id;
  },
  updateMessageById: (id, patch) => {
    const updated = get().messages.map((m) =>
      m.id === id ? { ...m, ...patch, ts: Date.now() } : m
    );
    set({ messages: updated });
  },
  appendThoughtDelta: (id, delta) => {
    let thoughtId = id;
    if (!thoughtId) {
      thoughtId = nanoid();
      const msg: ChatMessage = {
        id: thoughtId,
        role: "thought",
        content: delta,
        ts: Date.now(),
        streaming: true,
        collapsed: false,
        title: "Thought",
      };
      set({ messages: [...get().messages, msg] });
      return thoughtId;
    }
    const updated = get().messages.map((m) => {
      if (m.id !== thoughtId) return m;
      const replaceInitialThinking =
        m.streaming === true && m.content === "Thinking…";
      return {
        ...m,
        content: replaceInitialThinking ? delta : m.content + delta,
        ts: Date.now(),
      };
    });
    set({ messages: updated });
    return thoughtId;
  },
  finalizeThought: (id) => {
    const updated = get().messages.map((m) =>
      m.id === id
        ? { ...m, streaming: false, collapsed: true, ts: Date.now() }
        : m
    );
    set({ messages: updated });
  },
}));
