import {
  Input,
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  WrappedCanvas,
} from "mediabunny";

interface VideoSinkData {
  mediaId: string;
  mode: "webcodecs" | "fallback";
  sink?: CanvasSink;
  iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
  currentFrame: WrappedCanvas | null;
  lastTime: number;
  // Fallback state
  fallback?: {
    video: HTMLVideoElement;
    objectUrl: string;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D | null;
    ready: boolean;
    pendingSeek?: Promise<void> | null;
  };
}
export class VideoCache {
  private sinks = new Map<string, VideoSinkData>();
  private initPromises = new Map<string, Promise<void>>();
  private unsupportedWebCodecs = new Set<string>();

  async getFrameAt(
    mediaId: string,
    file: File,
    time: number
  ): Promise<WrappedCanvas | null> {
    await this.ensureSink(mediaId, file);

    const sinkData = this.sinks.get(mediaId);
    if (!sinkData) return null;

    if (sinkData.mode === "fallback") {
      return (await this.getFallbackFrame(sinkData, file, time)) as any;
    }

    if (
      sinkData.currentFrame &&
      this.isFrameValid(sinkData.currentFrame, time)
    ) {
      return sinkData.currentFrame;
    }

    if (
      sinkData.iterator &&
      sinkData.currentFrame &&
      time >= sinkData.lastTime &&
      time < sinkData.lastTime + 2.0
    ) {
      const frame = await this.iterateToTime(sinkData, time, file);
      if (frame) return frame;
    }

    return await this.seekToTime(sinkData, time, file);
  }

  private isFrameValid(frame: WrappedCanvas, time: number): boolean {
    return time >= frame.timestamp && time < frame.timestamp + frame.duration;
  }

  private closeFrame(frame: any) {
    try {
      if (frame && typeof frame.close === "function") frame.close();
    } catch {}
  }

  private async iterateToTime(
    sinkData: VideoSinkData,
    targetTime: number,
    file: File
  ): Promise<WrappedCanvas | null> {
    if (!sinkData.iterator) return null;

    try {
      while (true) {
        const { value: frame, done } = await sinkData.iterator.next();

        if (done || !frame) break;

        // Close previous frame to avoid GPU/CPU buffer leaks
        if (sinkData.currentFrame && sinkData.currentFrame !== frame) {
          this.closeFrame(sinkData.currentFrame);
        }
        sinkData.currentFrame = frame;
        sinkData.lastTime = frame.timestamp;

        if (this.isFrameValid(frame, targetTime)) {
          return frame;
        }

        if (frame.timestamp > targetTime + 1.0) break;
      }
    } catch (error: any) {
      console.warn("Iterator failed, will restart:", error);
      sinkData.iterator = null;
      // Switch to fallback if config unsupported
      if (
        error &&
        typeof error.message === "string" &&
        error.message.includes("Unsupported configuration")
      ) {
        await this.enableFallback(sinkData, targetTime, file);
        return (await this.getFallbackFrame(sinkData, file, targetTime)) as any;
      }
    }

    return null;
  }
  private async seekToTime(
    sinkData: VideoSinkData,
    time: number,
    file: File
  ): Promise<WrappedCanvas | null> {
    try {
      if (sinkData.iterator) {
        await sinkData.iterator.return();
        sinkData.iterator = null;
      }

      if (!sinkData.sink) throw new Error("CanvasSink not initialized");
      sinkData.iterator = sinkData.sink.canvases(time);
      sinkData.lastTime = time;

      const { value: frame } = await sinkData.iterator.next();

      if (frame) {
        if (sinkData.currentFrame && sinkData.currentFrame !== frame) {
          this.closeFrame(sinkData.currentFrame);
        }
        sinkData.currentFrame = frame;
        return frame;
      }
    } catch (error: any) {
      console.warn("Failed to seek video:", error);
      if (
        error &&
        typeof error.message === "string" &&
        error.message.includes("Unsupported configuration")
      ) {
        await this.enableFallback(sinkData, time, file);
        return (await this.getFallbackFrame(sinkData, file, time)) as any;
      }
    }

    return null;
  }
  private async ensureSink(mediaId: string, file: File): Promise<void> {
    if (this.sinks.has(mediaId)) return;

    if (this.initPromises.has(mediaId)) {
      await this.initPromises.get(mediaId);
      return;
    }

    const initPromise = this.initializeSink(mediaId, file);
    this.initPromises.set(mediaId, initPromise);

    try {
      await initPromise;
    } finally {
      this.initPromises.delete(mediaId);
    }
  }
  private async initializeSink(mediaId: string, file: File): Promise<void> {
    try {
      const forceFallback = this.unsupportedWebCodecs.has(mediaId);

      const input = new Input({
        source: new BlobSource(file),
        formats: ALL_FORMATS,
      });

      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        throw new Error("No video track found");
      }

      const canDecode = !forceFallback && (await videoTrack.canDecode());
      if (canDecode) {
        try {
          const sink = new CanvasSink(videoTrack, {
            poolSize: 2,
            fit: "contain",
          });
          this.sinks.set(mediaId, {
            mediaId,
            mode: "webcodecs",
            sink,
            iterator: null,
            currentFrame: null,
            lastTime: -1,
          });
          return;
        } catch (e) {
          console.warn("CanvasSink configure failed, falling back:", e);
          this.unsupportedWebCodecs.add(mediaId);
          // Fall through to fallback
        }
      }
      if (!canDecode) {
        this.unsupportedWebCodecs.add(mediaId);
      }
      // Fallback path: <video> + canvas
      const fallback = await this.createFallback(file);
      this.sinks.set(mediaId, {
        mediaId,
        mode: "fallback",
        iterator: null,
        currentFrame: null,
        lastTime: -1,
        fallback,
      });
    } catch (error) {
      console.error(`Failed to initialize video sink for ${mediaId}:`, error);
      throw error;
    }
  }

  clearVideo(mediaId: string): void {
    const sinkData = this.sinks.get(mediaId);
    if (sinkData) {
      if (sinkData.iterator) {
        sinkData.iterator.return();
      }
      if (sinkData.currentFrame) {
        this.closeFrame(sinkData.currentFrame);
      }
      if (sinkData.fallback) {
        try { sinkData.fallback.video.pause(); } catch {}
        try { sinkData.fallback.video.src = ""; } catch {}
        try { URL.revokeObjectURL(sinkData.fallback.objectUrl); } catch {}
      }

      this.sinks.delete(mediaId);
    }

    this.initPromises.delete(mediaId);
  }

  clearAll(): void {
    for (const [mediaId] of this.sinks) {
      this.clearVideo(mediaId);
    }
  }

  releaseFrame(mediaId: string, frame: WrappedCanvas | null): void {
    if (!frame) return;
    const sinkData = this.sinks.get(mediaId);
    if (!sinkData) {
      this.closeFrame(frame);
      return;
    }

    if (sinkData.currentFrame === frame) {
      sinkData.currentFrame = null;
    }

    this.closeFrame(frame);
  }

  getStats() {
    return {
      totalSinks: this.sinks.size,
      activeSinks: Array.from(this.sinks.values()).filter((s) => s.iterator)
        .length,
      cachedFrames: Array.from(this.sinks.values()).filter(
        (s) => s.currentFrame
      ).length,
    };
  }

  // ---------------------- FALLBACK HELPERS ----------------------
  private async enableFallback(
    sinkData: VideoSinkData,
    time: number,
    file: File
  ) {
    if (sinkData.mode === "fallback" && sinkData.fallback) return;

    try {
      if (sinkData.iterator) {
        await sinkData.iterator.return();
      }
    } catch {}

    sinkData.iterator = null;

    if (sinkData.currentFrame) {
      this.closeFrame(sinkData.currentFrame);
      sinkData.currentFrame = null;
    }

    sinkData.lastTime = -1;
    sinkData.sink = undefined;

    this.unsupportedWebCodecs.add(sinkData.mediaId);

    const fb = await this.createFallback(file);
    sinkData.mode = "fallback";
    sinkData.fallback = fb;
  }

  private async createFallback(file: File) {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.src = objectUrl;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const ready = await new Promise<boolean>((resolve) => {
      const onLoaded = () => resolve(true);
      const onErr = () => resolve(false);
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onErr, { once: true });
    });

    if (ready) {
      // Limit fallback canvas size to reduce RAM (e.g., cap longest side to 1280)
      const w = Math.max(1, video.videoWidth || 640);
      const h = Math.max(1, video.videoHeight || 360);
      const cap = 1280;
      const scale = Math.min(1, cap / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
    } else {
      canvas.width = 640;
      canvas.height = 360;
    }

    return { video, objectUrl, canvas, ctx, ready };
  }

  private async getFallbackFrame(
    sinkData: VideoSinkData,
    _file: File,
    time: number
  ): Promise<{ canvas: HTMLCanvasElement; timestamp: number; duration: number } | null> {
    if (!sinkData.fallback) return null;
    const fb = sinkData.fallback;
    if (!fb.ready) return null;

    // Coalesce seeks
    if (!fb.pendingSeek) {
      fb.pendingSeek = new Promise<void>((resolve) => {
        const onSeeked = () => {
          fb.video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        fb.video.addEventListener("seeked", onSeeked);
        try {
          fb.video.currentTime = Math.max(0, time);
        } catch {
          // Some browsers throw if we set out-of-range; clamp silently
          fb.video.currentTime = 0;
        }
      }).finally(() => {
        fb.pendingSeek = null;
      });
    }
    try {
      await fb.pendingSeek;
    } catch {}

    if (fb.ctx) {
      try {
        fb.ctx.drawImage(fb.video, 0, 0, fb.canvas.width, fb.canvas.height);
      } catch (e) {
        // drawImage can fail transiently; return null to skip frame
        return null;
      }
    }
    return {
      canvas: fb.canvas,
      timestamp: time,
      duration: 1 / 30,
    } as any;
  }
}
export const videoCache = new VideoCache();
