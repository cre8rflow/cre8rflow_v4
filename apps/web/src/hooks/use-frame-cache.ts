import { useCallback, useRef } from "react";
import {
  TimelineTrack,
  TimelineElement,
  MediaElement,
  TextElement,
} from "@/types/timeline";
import { MediaFile } from "@/types/media";
import { TProject } from "@/types/project";

type FrameCachePayload =
  | {
      kind: "bitmap";
      bitmap: ImageBitmap;
      width: number;
      height: number;
      approxBytes: number;
    }
  | {
      kind: "imageData";
      imageData: ImageData;
      width: number;
      height: number;
      approxBytes: number;
    };

interface CachedFrame {
  payload: FrameCachePayload | null;
  timelineHash: string;
  timestamp: number;
  status: "pending" | "ready" | "failed";
  token: symbol;
}

interface FrameCacheOptions {
  maxCacheSize?: number; // Maximum number of cached entries (failsafe)
  cacheResolution?: number; // Frames per second to cache at
  maxMemoryBytes?: number; // Approximate memory budget for cached frames
}

export type FrameHandle =
  | {
      type: "bitmap";
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }
  | {
      type: "imageData";
      imageData: ImageData;
      width: number;
      height: number;
    };

// Shared singleton cache across hook instances (HMR-safe)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __frameCacheGlobal: any = globalThis as any;
const __sharedFrameCache: Map<number, CachedFrame> =
  __frameCacheGlobal.__sharedFrameCache ?? new Map<number, CachedFrame>();
__frameCacheGlobal.__sharedFrameCache = __sharedFrameCache;

const __sharedFrameCacheMemory: { usage: number } =
  __frameCacheGlobal.__sharedFrameCacheMemory ?? { usage: 0 };
__frameCacheGlobal.__sharedFrameCacheMemory = __sharedFrameCacheMemory;

const hasWindow = typeof window !== "undefined";
const createBitmapFn: (typeof window)["createImageBitmap"] | null =
  hasWindow && typeof window.createImageBitmap === "function"
    ? window.createImageBitmap.bind(window)
    : null;

const supportsOffscreenCanvas =
  typeof OffscreenCanvas !== "undefined" && OffscreenCanvas !== undefined;

export function useFrameCache(options: FrameCacheOptions = {}) {
  const {
    maxCacheSize = 90,
    cacheResolution = 30,
    maxMemoryBytes = 48 * 1024 * 1024, // ~48MB default budget
  } = options;

  const frameCacheRef = useRef(__sharedFrameCache);
  const memoryUsageStore = useRef(__sharedFrameCacheMemory);
  const scratchCanvasRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(
    null
  );

  const approximateBytes = useCallback((width: number, height: number) => {
    return Math.max(width * height * 4, 0);
  }, []);

  const releasePayload = useCallback((payload: FrameCachePayload | null) => {
    if (!payload) return;
    if (payload.kind === "bitmap") {
      try {
        payload.bitmap.close();
      } catch {}
    }
  }, []);

  const ensureScratchCanvas = useCallback(
    (width: number, height: number) => {
      let canvas = scratchCanvasRef.current;
      if (!canvas) {
        canvas = supportsOffscreenCanvas
          ? new OffscreenCanvas(width, height)
          : document.createElement("canvas");
        scratchCanvasRef.current = canvas;
      }

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      return canvas;
    },
    []
  );

  const updateMemoryUsage = useCallback((delta: number) => {
    const next = memoryUsageStore.current.usage + delta;
    memoryUsageStore.current.usage = Math.max(0, next);
  }, []);

  const evictUntilWithinBudget = useCallback(
    (bytesNeeded: number) => {
      const cache = frameCacheRef.current;
      if (memoryUsageStore.current.usage + bytesNeeded <= maxMemoryBytes) {
        return;
      }

      const entries = Array.from(cache.entries());
      if (entries.length === 0) return;
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      for (const [key, value] of entries) {
        if (memoryUsageStore.current.usage + bytesNeeded <= maxMemoryBytes) {
          break;
        }
        if (value.status === "ready" && value.payload) {
          updateMemoryUsage(-value.payload.approxBytes);
        }
        releasePayload(value.payload);
        cache.delete(key);
      }
    },
    [maxMemoryBytes, releasePayload, updateMemoryUsage]
  );

  const readDimensions = useCallback((imageData: ImageData) => {
    return { width: imageData.width, height: imageData.height };
  }, []);

  // Generate a hash of the timeline state that affects rendering
  const getTimelineHash = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): string => {
      const activeElements: Array<{
        id: string;
        type: string;
        startTime: number;
        duration: number;
        trimStart: number;
        trimEnd: number;
        mediaId?: string;
        content?: string;
        fontSize?: number;
        fontFamily?: string;
        color?: string;
        backgroundColor?: string;
        x?: number;
        y?: number;
        rotation?: number;
        opacity?: number;
      }> = [];

      for (const track of tracks) {
        if (track.muted) continue;

        for (const element of track.elements) {
          const isHidden = "hidden" in element ? element.hidden : false;
          if (isHidden) continue;

          const elementStart = element.startTime;
          const elementEnd =
            element.startTime +
            (element.duration - element.trimStart - element.trimEnd);

          if (time >= elementStart && time < elementEnd) {
            if (element.type === "media") {
              const mediaElement = element as MediaElement;
              activeElements.push({
                id: element.id,
                type: element.type,
                startTime: element.startTime,
                duration: element.duration,
                trimStart: element.trimStart,
                trimEnd: element.trimEnd,
                mediaId: mediaElement.mediaId,
              });
            } else if (element.type === "text") {
              const textElement = element as TextElement;
              activeElements.push({
                id: element.id,
                type: element.type,
                startTime: element.startTime,
                duration: element.duration,
                trimStart: element.trimStart,
                trimEnd: element.trimEnd,
                content: textElement.content,
                fontSize: textElement.fontSize,
                fontFamily: textElement.fontFamily,
                color: textElement.color,
                backgroundColor: textElement.backgroundColor,
                x: textElement.x,
                y: textElement.y,
                rotation: textElement.rotation,
                opacity: textElement.opacity,
              });
            }
          }
        }
      }

      const projectState = {
        backgroundColor: activeProject?.backgroundColor,
        backgroundType: activeProject?.backgroundType,
        blurIntensity: activeProject?.blurIntensity,
        canvasSize: activeProject?.canvasSize,
      };

      const hash = {
        activeElements,
        projectState,
        sceneId,
        time: Math.floor(time * cacheResolution) / cacheResolution,
      };

      return JSON.stringify(hash);
    },
    [cacheResolution]
  );

  const isFrameCached = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): boolean => {
      const frameKey = Math.floor(time * cacheResolution);
      const cached = frameCacheRef.current.get(frameKey);
      if (!cached || cached.status !== "ready" || !cached.payload) {
        return false;
      }

      const currentHash = getTimelineHash(
        time,
        tracks,
        mediaFiles,
        activeProject,
        sceneId
      );
      return cached.timelineHash === currentHash;
    },
    [cacheResolution, getTimelineHash]
  );

  const getCachedFrameHandle = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): FrameHandle | null => {
      const frameKey = Math.floor(time * cacheResolution);
      const cached = frameCacheRef.current.get(frameKey);
      if (!cached || cached.status !== "ready" || !cached.payload) {
        return null;
      }

      const currentHash = getTimelineHash(
        time,
        tracks,
        mediaFiles,
        activeProject,
        sceneId
      );
      if (cached.timelineHash !== currentHash) {
        if (cached.payload) {
          updateMemoryUsage(-cached.payload.approxBytes);
          releasePayload(cached.payload);
        }
        frameCacheRef.current.delete(frameKey);
        return null;
      }

      if (cached.payload.kind === "bitmap") {
        return {
          type: "bitmap",
          bitmap: cached.payload.bitmap,
          width: cached.payload.width,
          height: cached.payload.height,
        };
      }

      return {
        type: "imageData",
        imageData: cached.payload.imageData,
        width: cached.payload.width,
        height: cached.payload.height,
      };
    },
    [cacheResolution, getTimelineHash, releasePayload, updateMemoryUsage]
  );

  const getCachedFrame = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): ImageData | null => {
      const handle = getCachedFrameHandle(
        time,
        tracks,
        mediaFiles,
        activeProject,
        sceneId
      );
      if (!handle) return null;

      if (handle.type === "imageData") {
        return handle.imageData;
      }

      const { width, height, bitmap } = handle;
      const scratchCanvas = ensureScratchCanvas(width, height);
      const ctx = scratchCanvas.getContext("2d");
      if (!ctx) {
        return null;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      return ctx.getImageData(0, 0, width, height);
    },
    [ensureScratchCanvas, getCachedFrameHandle]
  );

  const cacheFrame = useCallback(
    (
      time: number,
      imageData: ImageData,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): void => {
      const frameKey = Math.floor(time * cacheResolution);
      const timelineHash = getTimelineHash(
        time,
        tracks,
        mediaFiles,
        activeProject,
        sceneId
      );

      const { width, height } = readDimensions(imageData);
      const approxBytes = approximateBytes(width, height);

      evictUntilWithinBudget(approxBytes);

      if (frameCacheRef.current.size >= maxCacheSize) {
        const entries = Array.from(frameCacheRef.current.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toRemove = Math.max(1, Math.floor(entries.length * 0.25));
        for (let i = 0; i < toRemove; i++) {
          const [key, cached] = entries[i];
          if (cached.status === "ready" && cached.payload) {
            updateMemoryUsage(-cached.payload.approxBytes);
          }
          releasePayload(cached.payload);
          frameCacheRef.current.delete(key);
        }
      }

      const existing = frameCacheRef.current.get(frameKey);
      if (existing) {
        if (existing.status === "ready" && existing.payload) {
          updateMemoryUsage(-existing.payload.approxBytes);
        }
        releasePayload(existing.payload);
      }

      const token = Symbol("frame-cache-entry");
      const baseEntry: CachedFrame = {
        payload: null,
        timelineHash,
        timestamp: Date.now(),
        status: "pending",
        token,
      };

      frameCacheRef.current.set(frameKey, baseEntry);

      if (!createBitmapFn) {
        baseEntry.payload = {
          kind: "imageData",
          imageData,
          width,
          height,
          approxBytes,
        };
        baseEntry.status = "ready";
        updateMemoryUsage(approxBytes);
        return;
      }

      (async () => {
        try {
          const bitmap = await createBitmapFn(imageData);
          const payload: FrameCachePayload = {
            kind: "bitmap",
            bitmap,
            width,
            height,
            approxBytes,
          };

          const current = frameCacheRef.current.get(frameKey);
          if (!current || current.token !== token) {
            releasePayload(payload);
            return;
          }

          baseEntry.payload = payload;
          baseEntry.status = "ready";
          baseEntry.timestamp = Date.now();
          updateMemoryUsage(approxBytes);
          evictUntilWithinBudget(0);
        } catch (error) {
          console.warn("Failed to create ImageBitmap for cached frame", error);
          const fallbackPayload: FrameCachePayload = {
            kind: "imageData",
            imageData,
            width,
            height,
            approxBytes,
          };

          const current = frameCacheRef.current.get(frameKey);
          if (!current || current.token !== token) {
            return;
          }

          baseEntry.payload = fallbackPayload;
          baseEntry.status = "ready";
          baseEntry.timestamp = Date.now();
          updateMemoryUsage(approxBytes);
          evictUntilWithinBudget(0);
        }
      })().catch((error) => {
        console.warn("Frame caching promise rejected", error);
        const current = frameCacheRef.current.get(frameKey);
        if (current && current.token === token) {
          baseEntry.payload = null;
          baseEntry.status = "failed";
        }
      });
    },
    [
      cacheResolution,
      getTimelineHash,
      readDimensions,
      approximateBytes,
      evictUntilWithinBudget,
      maxCacheSize,
      releasePayload,
      updateMemoryUsage,
    ]
  );

  const invalidateCache = useCallback(() => {
    for (const [, cached] of frameCacheRef.current.entries()) {
      if (cached.payload) {
        updateMemoryUsage(-cached.payload.approxBytes);
        releasePayload(cached.payload);
      }
    }
    frameCacheRef.current.clear();
  }, [releasePayload, updateMemoryUsage]);

  const getRenderStatus = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): "cached" | "not-cached" => {
      return isFrameCached(time, tracks, mediaFiles, activeProject, sceneId)
        ? "cached"
        : "not-cached";
    },
    [isFrameCached]
  );

  const preRenderNearbyFrames = useCallback(
    async (
      currentTime: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      renderFunction: (time: number) => Promise<ImageData | null>,
      sceneId?: string,
      options?: { range?: number; shouldAbort?: () => boolean }
    ) => {
      const range = options?.range ?? 0.75;
      const framesToPreRender: number[] = [];

      for (
        let offset = -range;
        offset <= range;
        offset += 1 / cacheResolution
      ) {
        const time = currentTime + offset;
        if (time < 0) continue;

        if (!isFrameCached(time, tracks, mediaFiles, activeProject, sceneId)) {
          framesToPreRender.push(time);
        }
      }

      const expandedTimes = framesToPreRender.slice();
      expandedTimes.sort((a, b) => {
        const da = a >= currentTime ? a - currentTime : currentTime - a + 1e6;
        const db = b >= currentTime ? b - currentTime : currentTime - b + 1e6;
        return da - db;
      });

      const cap = Math.max(8, Math.min(30, Math.round(cacheResolution)));
      const toSchedule = expandedTimes.slice(0, cap);

      for (const time of toSchedule) {
        requestIdleCallback(async () => {
          if (options?.shouldAbort?.()) {
            return;
          }
          try {
            const imageData = await renderFunction(time);
            if (!imageData) {
              return;
            }
            if (options?.shouldAbort?.()) {
              return;
            }
            cacheFrame(
              time,
              imageData,
              tracks,
              mediaFiles,
              activeProject,
              sceneId
            );
          } catch (error) {
            console.warn(`Pre-render failed for time ${time}:`, error);
          }
        });
      }
    },
    [
      cacheFrame,
      cacheResolution,
      isFrameCached,
    ]
  );

  return {
    isFrameCached,
    getCachedFrame,
    getCachedFrameHandle,
    cacheFrame,
    invalidateCache,
    getRenderStatus,
    preRenderNearbyFrames,
    cacheSize: frameCacheRef.current.size,
    approxMemoryUsage: memoryUsageStore.current.usage,
  };
}
