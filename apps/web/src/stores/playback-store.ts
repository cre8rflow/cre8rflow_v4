import { create } from "zustand";
import type { PlaybackState, PlaybackControls } from "@/types/playback";
import { useTimelineStore } from "@/stores/timeline-store";
import { DEFAULT_FPS, useProjectStore } from "./project-store";

interface PlaybackStore extends PlaybackState, PlaybackControls {
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
}

let playbackTimer: number | null = null;

const startTimer = (store: () => PlaybackStore) => {
  if (playbackTimer) cancelAnimationFrame(playbackTimer);

  let lastUpdate = performance.now();

  const updateTime = () => {
    const state = store();
    if (state.isPlaying) {
      const now = performance.now();
      const delta = (now - lastUpdate) / 1000;
      lastUpdate = now;

      const actualContentDuration = useTimelineStore
        .getState()
        .getTotalDuration();
      const effectiveDuration =
        actualContentDuration > 0 ? actualContentDuration : state.duration;

      if (effectiveDuration <= 0) {
        state.pause();
        state.setCurrentTime(0);
        window.dispatchEvent(
          new CustomEvent("playback-seek", { detail: { time: 0 } })
        );
      } else {
        let newTime = state.currentTime + delta * state.speed;
        const projectFps =
          useProjectStore.getState().activeProject?.fps ?? DEFAULT_FPS;
        const frameOffset = 1 / projectFps;

        if (newTime >= effectiveDuration) {
          newTime = newTime % effectiveDuration;
          if (
            effectiveDuration - newTime <= frameOffset ||
            Number.isNaN(newTime)
          ) {
            newTime = 0;
          }

          state.setCurrentTime(newTime);
          window.dispatchEvent(
            new CustomEvent("playback-seek", { detail: { time: newTime } })
          );
          window.dispatchEvent(
            new CustomEvent("playback-update", { detail: { time: newTime } })
          );
          lastUpdate = performance.now();
        } else {
          state.setCurrentTime(newTime);
          window.dispatchEvent(
            new CustomEvent("playback-update", { detail: { time: newTime } })
          );
        }
      }
    }
    playbackTimer = requestAnimationFrame(updateTime);
  };

  playbackTimer = requestAnimationFrame(updateTime);
};

const stopTimer = () => {
  if (playbackTimer) {
    cancelAnimationFrame(playbackTimer);
    playbackTimer = null;
  }
};

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  previousVolume: 1,
  speed: 1.0,

  play: () => {
    const state = get();

    const actualContentDuration = useTimelineStore
      .getState()
      .getTotalDuration();
    const effectiveDuration =
      actualContentDuration > 0 ? actualContentDuration : state.duration;

    if (effectiveDuration > 0) {
      const fps = useProjectStore.getState().activeProject?.fps ?? DEFAULT_FPS;
      const frameOffset = 1 / fps;
      const endThreshold = Math.max(0, effectiveDuration - frameOffset);

      if (state.currentTime >= endThreshold) {
        get().seek(0);
      }
    }

    set({ isPlaying: true });
    startTimer(get);
  },

  pause: () => {
    set({ isPlaying: false });
    stopTimer();
  },

  toggle: () => {
    const { isPlaying } = get();
    if (isPlaying) {
      get().pause();
    } else {
      get().play();
    }
  },

  seek: (time: number) => {
    const { duration } = get();
    const actualContentDuration = useTimelineStore
      .getState()
      .getTotalDuration();
    const effectiveDuration =
      actualContentDuration > 0 ? actualContentDuration : duration;

    const projectFps =
      useProjectStore.getState().activeProject?.fps ?? DEFAULT_FPS;
    const frameOffset = 1 / projectFps;
    const maxTime =
      effectiveDuration > 0
        ? Math.max(0, effectiveDuration - frameOffset)
        : duration;
    const clampedTime = Math.max(0, Math.min(maxTime, time));

    set({ currentTime: clampedTime });

    const event = new CustomEvent("playback-seek", {
      detail: { time: clampedTime },
    });
    window.dispatchEvent(event);
  },

  setVolume: (volume: number) =>
    set((state) => ({
      volume: Math.max(0, Math.min(1, volume)),
      muted: volume === 0,
      previousVolume: volume > 0 ? volume : state.previousVolume,
    })),

  setSpeed: (speed: number) => {
    const newSpeed = Math.max(0.1, Math.min(2.0, speed));
    set({ speed: newSpeed });

    const event = new CustomEvent("playback-speed", {
      detail: { speed: newSpeed },
    });
    window.dispatchEvent(event);
  },

  setDuration: (duration: number) => set({ duration }),
  setCurrentTime: (time: number) => set({ currentTime: time }),

  mute: () => {
    const { volume, previousVolume } = get();
    set({
      muted: true,
      previousVolume: volume > 0 ? volume : previousVolume,
      volume: 0,
    });
  },

  unmute: () => {
    const { previousVolume } = get();
    set({ muted: false, volume: previousVolume ?? 1 });
  },

  toggleMute: () => {
    const { muted } = get();
    if (muted) {
      get().unmute();
    } else {
      get().mute();
    }
  },
}));
