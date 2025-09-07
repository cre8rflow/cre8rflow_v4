import { create } from "zustand";
import { storageService } from "@/lib/storage/storage-service";
import { useTimelineStore } from "./timeline-store";
import { generateUUID } from "@/lib/utils";
import { MediaType, MediaFile, IndexingStatus } from "@/types/media";
import { videoCache } from "@/lib/video-cache";
import { twelveLabsService } from "@/lib/twelvelabs-service";
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
    if (file.type === 'video' && newItem.url) {
      console.log(`🎬 Starting Twelvelabs indexing for video: ${newItem.name}`);
      
      // This runs in the background and doesn't block the main workflow
      twelveLabsService.startBackgroundIndexing(
        'default-user', // TODO: Replace with actual user ID
        newItem.url,
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
          
          // Persist status to Supabase (runs in background)
          try {
            const supabaseData = {
              media_id: newItem.id,
              project_id: projectId,
              twelve_labs_video_id: statusUpdate.task?.video_id,
              twelve_labs_task_id: statusUpdate.task?._id,
              indexing_status: statusUpdate.status,
              indexing_progress: statusUpdate.progress,
              error_message: statusUpdate.error,
              metadata: statusUpdate.task ? { task: statusUpdate.task } : undefined,
            };
            
            await saveTwelveLabsMetadata(supabaseData);
            console.log(`💾 Saved Twelvelabs status to Supabase for ${newItem.id}`);
          } catch (supabaseError) {
            console.error(`❌ Failed to save Twelvelabs status to Supabase for ${newItem.id}:`, supabaseError);
            // Don't throw - this is a background operation
          }
        }
      ).catch((error) => {
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
          console.log(`🔄 Restoring Twelvelabs status for ${videoItems.length} videos`);
          
          const videoIds = videoItems.map(item => item.id);
          const twelveLabsMetadata = await getTwelveLabsMetadata(projectId, videoIds);
          
          // Create a map for quick lookup
          const statusMap = new Map(
            twelveLabsMetadata.map(metadata => [
              metadata.media_id,
              {
                twelveLabsVideoId: metadata.twelve_labs_video_id,
                twelveLabsTaskId: metadata.twelve_labs_task_id,
                indexingStatus: metadata.indexing_status as IndexingStatus,
                indexingProgress: metadata.indexing_progress,
                indexingError: metadata.error_message,
              }
            ])
          );
          
          // Merge Twelvelabs status with media items
          const mediaItemsWithStatus = updatedMediaItems.map(item => {
            if (item.type === 'video' && statusMap.has(item.id)) {
              const status = statusMap.get(item.id)!;
              console.log(`📋 Restored Twelvelabs status for ${item.name}:`, status);
              return { ...item, ...status };
            }
            return item;
          });
          
          set({ mediaFiles: mediaItemsWithStatus });
          console.log(`✅ Successfully restored Twelvelabs status for ${statusMap.size} videos`);
        } else {
          set({ mediaFiles: updatedMediaItems });
        }
      } catch (twelveLabsError) {
        console.error("Failed to restore Twelvelabs status:", twelveLabsError);
        // Don't fail the entire load operation, just use items without status
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
