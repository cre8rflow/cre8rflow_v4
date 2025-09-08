import { create } from "zustand";
import { storageService } from "@/lib/storage/storage-service";
import { useTimelineStore } from "./timeline-store";
import { generateUUID } from "@/lib/utils";
import { MediaType, MediaFile, IndexingStatus } from "@/types/media";
import { videoCache } from "@/lib/video-cache";
import { twelveLabsClient } from "@/lib/twelvelabs-client";
import { saveTwelveLabsMetadata, updateTwelveLabsStatus, getTwelveLabsMetadata } from "@/lib/supabase";

interface MediaStore {
  mediaFiles: MediaFile[];
  isLoading: boolean;

  // Actions
  addMediaFile: (
    projectId: string,
    file: Omit<MediaFile, "id">
  ) => Promise<void>;
  removeMediaFile: (projectId: string, id: string) => Promise<void>;
  loadProjectMedia: (projectId: string) => Promise<void>;
  clearProjectMedia: (projectId: string) => Promise<void>;
  clearAllMedia: () => void;
  
  // V3 Integration: Twelvelabs status management
  updateMediaIndexingStatus: (
    mediaId: string, 
    status: Partial<Pick<MediaFile, 'indexingStatus' | 'indexingProgress' | 'indexingError' | 'twelveLabsVideoId' | 'twelveLabsTaskId'>>
  ) => void;
}

// Helper function to determine file type
export const getFileType = (file: File): MediaType | null => {
  const { type } = file;

  if (type.startsWith("image/")) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type.startsWith("audio/")) {
    return "audio";
  }

  return null;
};

// Helper function to get image dimensions
export const getImageDimensions = (
  file: File
): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();

    img.addEventListener("load", () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      resolve({ width, height });
      img.remove();
    });

    img.addEventListener("error", () => {
      reject(new Error("Could not load image"));
      img.remove();
    });

    img.src = URL.createObjectURL(file);
  });
};

// Helper function to generate video thumbnail and get dimensions
export const generateVideoThumbnail = (
  file: File
): Promise<{ thumbnailUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video") as HTMLVideoElement;
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    video.addEventListener("loadedmetadata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Seek to 1 second or 10% of duration, whichever is smaller
      video.currentTime = Math.min(1, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
      const width = video.videoWidth;
      const height = video.videoHeight;

      resolve({ thumbnailUrl, width, height });

      // Cleanup
      video.remove();
      canvas.remove();
    });

    video.addEventListener("error", () => {
      reject(new Error("Could not load video"));
      video.remove();
      canvas.remove();
    });

    video.src = URL.createObjectURL(file);
    video.load();
  });
};

// Helper function to get media duration
export const getMediaDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const element = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio"
    ) as HTMLVideoElement;

    element.addEventListener("loadedmetadata", () => {
      resolve(element.duration);
      element.remove();
    });

    element.addEventListener("error", () => {
      reject(new Error("Could not load media"));
      element.remove();
    });

    element.src = URL.createObjectURL(file);
    element.load();
  });
};

export const getMediaAspectRatio = (item: MediaFile): number => {
  if (item.width && item.height) {
    return item.width / item.height;
  }
  return 16 / 9; // Default aspect ratio
};

export const useMediaStore = create<MediaStore>((set, get) => ({
  mediaFiles: [],
  isLoading: false,

  addMediaFile: async (projectId, file) => {
    const newItem: MediaFile = {
      ...file,
      id: generateUUID(),
      // Initialize Twelvelabs fields for videos
      ...(file.type === 'video' ? {
        indexingStatus: 'pending' as IndexingStatus,
        indexingProgress: 0,
      } : {}),
    };

    // Add to local state immediately for UI responsiveness
    set((state) => ({
      mediaFiles: [...state.mediaFiles, newItem],
    }));

    // Existing workflow: Save to persistent storage in background
    try {
      await storageService.saveMediaFile({ projectId, mediaItem: newItem });
    } catch (error) {
      console.error("Failed to save media item:", error);
      // Remove from local state if save failed
      set((state) => ({
        mediaFiles: state.mediaFiles.filter((media) => media.id !== newItem.id),
      }));
      return; // Don't proceed with Twelvelabs if storage failed
    }

    // V3 Integration: Start Twelvelabs indexing for videos (parallel operation)
    if (file.type === 'video' && newItem.file) {
      console.log(`🎬 Starting Twelvelabs indexing for video: ${newItem.name}`);
      
      // This runs in the background and doesn't block the main workflow
      twelveLabsClient.startBackgroundIndexing(
        newItem.file,
        async (statusUpdate) => {
          console.log(`📊 Twelvelabs status update for ${newItem.id}:`, statusUpdate);
          
          // Update local state with new status
          const { updateMediaIndexingStatus } = get();
          updateMediaIndexingStatus(newItem.id, {
            indexingStatus: statusUpdate.status,
            indexingProgress: statusUpdate.progress,
            indexingError: statusUpdate.error,
            twelveLabsVideoId: statusUpdate.task?.video_id,
            twelveLabsTaskId: statusUpdate.task?._id,
          });
          
          // Persist status via server: trigger API to both fetch and persist
          try {
            if (statusUpdate.task?._id) {
              const params = new URLSearchParams({
                task_id: statusUpdate.task._id,
                project_id: projectId,
                media_id: newItem.id,
              });
              await fetch(`/api/twelvelabs/status?${params.toString()}`);
            }
          } catch (persistError) {
            console.error(`❌ Failed to persist Twelvelabs status for ${newItem.id}:`, persistError);
          }
        }
      , 'en', { projectId, mediaId: newItem.id }).catch((error) => {
        console.error(`❌ Failed to start Twelvelabs indexing for ${newItem.id}:`, error);
        // Update status to failed
        const { updateMediaIndexingStatus } = get();
        updateMediaIndexingStatus(newItem.id, {
          indexingStatus: 'failed',
          indexingError: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }
  },

  removeMediaFile: async (projectId: string, id: string) => {
    const state = get();
    const item = state.mediaFiles.find((media) => media.id === id);

    videoCache.clearVideo(id);

    // Cleanup object URLs to prevent memory leaks
    if (item?.url) {
      URL.revokeObjectURL(item.url);
      if (item.thumbnailUrl) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    }

    // 1) Remove from local state immediately
    set((state) => ({
      mediaFiles: state.mediaFiles.filter((media) => media.id !== id),
    }));

    // 2) Cascade into the timeline: remove any elements using this media ID
    const timeline = useTimelineStore.getState();
    const { tracks, deleteSelected, setSelectedElements } = timeline;

    // Find all elements that reference this media
    const elementsToRemove: Array<{ trackId: string; elementId: string }> = [];
    for (const track of tracks) {
      for (const el of track.elements) {
        if (el.type === "media" && el.mediaId === id) {
          elementsToRemove.push({ trackId: track.id, elementId: el.id });
        }
      }
    }

    // If there are elements to remove, use unified delete function
    if (elementsToRemove.length > 0) {
      setSelectedElements(elementsToRemove);
      deleteSelected();
    }

    // 3) Remove from persistent storage
    try {
      await storageService.deleteMediaFile({ projectId, id });
    } catch (error) {
      console.error("Failed to delete media item:", error);
    }

    // V3 Integration: Clean up Twelvelabs metadata if it was a video
    if (item?.type === 'video') {
      try {
        const { deleteTwelveLabsMetadata } = await import('@/lib/supabase');
        await deleteTwelveLabsMetadata(id, projectId);
        console.log(`🗑️ Cleaned up Twelvelabs metadata for ${id}`);
      } catch (error) {
        console.error(`❌ Failed to clean up Twelvelabs metadata for ${id}:`, error);
        // Don't throw - this is cleanup
      }
    }
  },

  loadProjectMedia: async (projectId) => {
    set({ isLoading: true });

    try {
      const mediaItems = await storageService.loadAllMediaFiles({ projectId });

      // Regenerate thumbnails for video items
      const updatedMediaItems = await Promise.all(
        mediaItems.map(async (item) => {
          if (item.type === "video" && item.file) {
            try {
              const { thumbnailUrl, width, height } =
                await generateVideoThumbnail(item.file);
              return {
                ...item,
                thumbnailUrl,
                width: width || item.width,
                height: height || item.height,
              };
            } catch (error) {
              console.error(
                `Failed to regenerate thumbnail for video ${item.id}:`,
                error
              );
              return item;
            }
          }
          return item;
        })
      );

      // V3 Integration: Restore Twelvelabs status for videos (parallel operation)
      try {
        const videoItems = updatedMediaItems.filter(item => item.type === 'video');
        if (videoItems.length > 0) {
          console.log(`🔄 Restoring Twelvelabs status for ${videoItems.length} videos via API`);

          const videoIds = videoItems.map(item => item.id);
          const params = new URLSearchParams({ project_id: projectId, media_ids: JSON.stringify(videoIds) });
          const resp = await fetch(`/api/twelvelabs/restore-status?${params.toString()}`);
          if (resp.ok) {
            const json = await resp.json();
            const restored = (json.restoredStatus || {}) as Record<string, any>;

            let mediaItemsWithStatus = updatedMediaItems.map(item => {
              if (item.type === 'video' && restored[item.id]) {
                const s = restored[item.id];
                return {
                  ...item,
                  twelveLabsVideoId: s.twelveLabsVideoId,
                  twelveLabsTaskId: s.twelveLabsTaskId,
                  indexingStatus: s.status as IndexingStatus,
                  indexingProgress: s.progress,
                  indexingError: s.error,
                };
              }
              return item;
            });

            set({ mediaFiles: mediaItemsWithStatus });
            console.log(`✅ Successfully restored Twelvelabs status for ${Object.keys(restored).length} videos`);

            // Immediately re-check any in-flight tasks to avoid stale pending/processing after refresh
            const inflight = mediaItemsWithStatus.filter(
              (item) => item.type === 'video' &&
                (item.indexingStatus === 'pending' || item.indexingStatus === 'processing') &&
                !!item.twelveLabsTaskId
            );

            if (inflight.length > 0) {
              console.log(`🔄 Verifying ${inflight.length} in-flight Twelvelabs tasks after restore`);
              await Promise.all(
                inflight.map(async (item) => {
                  try {
                    const params = new URLSearchParams({
                      task_id: String(item.twelveLabsTaskId),
                      project_id: projectId,
                      media_id: item.id,
                    });
                    const r = await fetch(`/api/twelvelabs/status?${params.toString()}`);
                    if (!r.ok) return;
                    const data = await r.json();
                    const raw = String(data.status ?? 'pending');
                    const mapped: IndexingStatus = raw === 'ready' ? 'completed' : raw === 'failed' ? 'failed' : raw === 'indexing' ? 'processing' : 'pending';
                    get().updateMediaIndexingStatus(item.id, {
                      indexingStatus: mapped,
                      indexingProgress: typeof data.progress === 'number' ? data.progress : item.indexingProgress,
                      twelveLabsVideoId: data.task?.video_id ?? item.twelveLabsVideoId,
                      twelveLabsTaskId: data.task?._id ?? item.twelveLabsTaskId,
                    });
                  } catch (e) {
                    // Ignore transient errors; status will be refreshed on next poll anyway
                  }
                })
              );
              // Refresh mediaFiles from state after updates
              mediaItemsWithStatus = get().mediaFiles;
            }
          } else {
            set({ mediaFiles: updatedMediaItems });
          }
        } else {
          set({ mediaFiles: updatedMediaItems });
        }
      } catch (twelveLabsError) {
        console.error("Failed to restore Twelvelabs status:", twelveLabsError);
        set({ mediaFiles: updatedMediaItems });
      }
    } catch (error) {
      console.error("Failed to load media items:", error);
    } finally {
      set({ isLoading: false });
    }
  },

  clearProjectMedia: async (projectId) => {
    const state = get();

    // Cleanup all object URLs
    state.mediaFiles.forEach((item) => {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
      if (item.thumbnailUrl) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    });

    // Clear local state
    set({ mediaFiles: [] });

    // Clear persistent storage
    try {
      const mediaIds = state.mediaFiles.map((item) => item.id);
      await Promise.all(
        mediaIds.map((id) => storageService.deleteMediaFile({ projectId, id }))
      );
    } catch (error) {
      console.error("Failed to clear media items from storage:", error);
    }
  },

  clearAllMedia: () => {
    const state = get();

    videoCache.clearAll();

    // Cleanup all object URLs
    state.mediaFiles.forEach((item) => {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
      if (item.thumbnailUrl) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    });

    // Clear local state
    set({ mediaFiles: [] });
  },

  // V3 Integration: Update media indexing status
  updateMediaIndexingStatus: (mediaId, status) => {
    set((state) => ({
      mediaFiles: state.mediaFiles.map((media) =>
        media.id === mediaId
          ? { ...media, ...status }
          : media
      ),
    }));
  },
}));
