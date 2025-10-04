"use client";

import { create } from "zustand";

interface ThoughtState {
  text: string;
  visible: boolean;
  startedAt: number | null;
  append: (delta: string) => void;
  hide: () => void;
  clear: () => void;
}

export const useAgentThoughtStore = create<ThoughtState>((set) => ({
  text: "",
  visible: false,
  startedAt: null,
  append: (delta) =>
    set((state) => ({
      text: state.text + delta,
      visible: true,
      startedAt: state.startedAt ?? Date.now(),
    })),
  hide: () => set((state) => ({ ...state, visible: false })),
  clear: () => set({ text: "", visible: false, startedAt: null }),
}));
