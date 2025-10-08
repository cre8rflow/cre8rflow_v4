import {
  findExistingIndex,
  createUserIndex,
  uploadVideoToIndex,
  uploadVideoFileToIndex,
  getTaskStatus,
  analyzeVideo,
  searchVideos,
  type Index,
  type Task,
  type SearchResult,
} from "./twelvelabs";

/**
 * Twelvelabs Service - Client orchestration layer for Twelvelabs operations
 * Ported from V3 for managing video indexing workflows
 */

export interface GetUserIndexResponse {
  success: boolean;
  index?: Index;
  error?: string;
}

export interface UploadVideoResponse {
  success: boolean;
  task?: Task;
  error?: string;
}

export interface TaskStatusResponse {
  success: boolean;
  task?: Task;
  error?: string;
}

export interface AnalyzeVideoResponse {
  success: boolean;
  task?: Task;
  error?: string;
}

export interface SearchVideosResponse {
  success: boolean;
  results?: SearchResult;
  error?: string;
}

export class TwelveLabsService {
  private readonly DEFAULT_MODEL_NAME = "marengo2.7";

  /**
   * Get or create an index for a user/project
   */
  async getUserIndex(userId: string): Promise<GetUserIndexResponse> {
    try {
      console.log(`Getting index for user: ${userId}`);

      const indexName = `user_${userId}_index`;

      // First, try to find existing index
      let index = await findExistingIndex(indexName);

      // If no index exists, create one
      if (!index) {
        console.log(`Creating new index for user: ${userId}`);
        index = await createUserIndex(indexName, this.DEFAULT_MODEL_NAME);
      }

      return {
        success: true,
        index,
      };
    } catch (error) {
      console.error("Failed to get user index:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Upload a video to the user's index
   */
  async uploadVideo(
    userId: string,
    videoUrl: string,
    language = "en"
  ): Promise<UploadVideoResponse> {
    try {
      console.log(`Uploading video for user ${userId}: ${videoUrl}`);

      // Get the user's index
      const indexResponse = await this.getUserIndex(userId);
      if (!indexResponse.success || !indexResponse.index) {
        return {
          success: false,
          error: indexResponse.error || "Failed to get user index",
        };
      }

      // Upload video to index
      const task = await uploadVideoToIndex(
        indexResponse.index._id,
        videoUrl,
        language
      );

      return {
        success: true,
        task,
      };
    } catch (error) {
      console.error("Failed to upload video:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Upload a video file for indexing
   * @param userId User ID
   * @param videoFile Video file to upload
   * @param language Language for transcription
   */
  async uploadVideoFile(
    userId: string,
    videoFile: File,
    language = "en"
  ): Promise<{ success: boolean; task?: any; error?: string }> {
    try {
      console.log(`Uploading video file for user ${userId}: ${videoFile.name}`);

      // Get the user's index
      const indexResponse = await this.getUserIndex(userId);
      if (!indexResponse.success || !indexResponse.index) {
        return {
          success: false,
          error: indexResponse.error || "Failed to get user index",
        };
      }

      // Upload video file to index
      const task = await uploadVideoFileToIndex(
        indexResponse.index._id,
        videoFile,
        language
      );

      return {
        success: true,
        task,
      };
    } catch (error) {
      console.error("Failed to upload video file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Check the status of a task
   */
  async checkTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    try {
      console.log(`Checking task status: ${taskId}`);

      const task = await getTaskStatus(taskId);

      return {
        success: true,
        task,
      };
    } catch (error) {
      console.error("Failed to check task status:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Analyze a video (alias for uploadVideo for clarity)
   */
  async analyzeVideo(
    userId: string,
    videoUrl: string,
    language = "en"
  ): Promise<AnalyzeVideoResponse> {
    const result = await this.uploadVideo(userId, videoUrl, language);
    return result;
  }

  /**
   * Search videos in the user's index
   */
  async searchVideos(
    userId: string,
    query: string,
    searchOptions?: {
      page_limit?: number;
      sort_option?: "score" | "clip_count";
      threshold?: "high" | "medium" | "low";
    },
    videoIds?: string[]
  ): Promise<SearchVideosResponse> {
    try {
      console.log(`Searching videos for user ${userId}: "${query}"`);

      // Get the user's index
      const indexResponse = await this.getUserIndex(userId);
      if (!indexResponse.success || !indexResponse.index) {
        return {
          success: false,
          error: indexResponse.error || "Failed to get user index",
        };
      }

      // Determine supported search options from index configuration
      const supported = new Set<string>();
      for (const model of indexResponse.index.models || []) {
        for (const opt of model.model_options || []) supported.add(opt);
      }
      const domains: ("audio" | "visual")[] = [];
      if (supported.has("visual")) domains.push("visual");
      if (supported.has("audio")) domains.push("audio");
      const finalOptions = {
        ...searchOptions,
        search_options: domains.length ? domains : ["visual"],
      } as any;

      // Search videos in index (optionally restricted to videoIds)
      const results = await searchVideos(
        indexResponse.index._id,
        query,
        finalOptions,
        videoIds
      );

      return {
        success: true,
        results,
      };
    } catch (error) {
      console.error("Failed to search videos:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Poll task status until completion or failure
   * Useful for tracking indexing progress
   */
  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (task: Task) => void,
    maxAttempts = 60,
    intervalMs = 5000
  ): Promise<TaskStatusResponse> {
    console.log(`Starting to poll task ${taskId} for completion`);

    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const statusResponse = await this.checkTaskStatus(taskId);

        if (!statusResponse.success || !statusResponse.task) {
          return statusResponse;
        }

        const task = statusResponse.task;

        // Call progress callback if provided
        if (onProgress) {
          onProgress(task);
        }

        // Check if task is complete
        if (task.status === "ready") {
          console.log(`Task ${taskId} completed successfully`);
          return statusResponse;
        }

        // Check if task failed
        if (task.status === "failed") {
          console.error(`Task ${taskId} failed:`, task.message);
          return {
            success: false,
            error: task.message || "Task failed",
            task,
          };
        }

        // Task is still in progress
        console.log(
          `Task ${taskId} status: ${task.status}, progress: ${task.progress || 0}%`
        );

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        attempts++;
      } catch (error) {
        console.error(`Error polling task ${taskId}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Polling failed",
        };
      }
    }

    // Max attempts reached
    console.warn(
      `Task ${taskId} polling timed out after ${maxAttempts} attempts`
    );
    return {
      success: false,
      error: `Task polling timed out after ${maxAttempts} attempts`,
    };
  }

  /**
   * Start background indexing for a video with status updates
   * This integrates with the media store for automatic status tracking
   */
  async startBackgroundIndexing(
    userId: string,
    videoUrl: string,
    onStatusUpdate?: (status: {
      task?: Task;
      progress: number;
      status: "pending" | "processing" | "completed" | "failed";
      error?: string;
    }) => void,
    language = "en"
  ): Promise<{ success: boolean; taskId?: string; error?: string }> {
    try {
      console.log(
        `Starting background indexing for user ${userId}: ${videoUrl}`
      );

      // Start the upload/analysis
      const uploadResponse = await this.uploadVideo(userId, videoUrl, language);

      if (!uploadResponse.success || !uploadResponse.task) {
        return {
          success: false,
          error: uploadResponse.error,
        };
      }

      const taskId = uploadResponse.task._id;

      // Start polling in the background (don't await)
      this.pollTaskUntilComplete(taskId, (task) => {
        if (onStatusUpdate) {
          let status: "pending" | "processing" | "completed" | "failed";
          let progress = task.progress || 0;

          switch (task.status) {
            case "pending":
            case "validating":
              status = "pending";
              progress = Math.max(5, progress);
              break;
            case "indexing":
              status = "processing";
              progress = Math.max(10, progress);
              break;
            case "ready":
              status = "completed";
              progress = 100;
              break;
            case "failed":
              status = "failed";
              break;
            default:
              status = "processing";
          }

          onStatusUpdate({
            task,
            progress,
            status,
          });
        }
      })
        .then((finalResult) => {
          if (onStatusUpdate) {
            onStatusUpdate({
              task: finalResult.task,
              progress: finalResult.success ? 100 : 0,
              status: finalResult.success ? "completed" : "failed",
              error: finalResult.error,
            });
          }
        })
        .catch((error) => {
          console.error("Background polling failed:", error);
          if (onStatusUpdate) {
            onStatusUpdate({
              progress: 0,
              status: "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Background processing failed",
            });
          }
        });

      return {
        success: true,
        taskId,
      };
    } catch (error) {
      console.error("Failed to start background indexing:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

// Export singleton instance
export const twelveLabsService = new TwelveLabsService();
