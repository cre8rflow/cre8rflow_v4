/**
 * Client-side Twelvelabs API wrapper
 * Calls server-side API routes instead of accessing environment variables directly
 * Fixes the client-side environment variable access issue
 */

// Response types for API calls
export interface ClientIndexResponse {
  success: boolean;
  index?: {
    _id: string;
    index_name: string;
    models: Array<{
      model_name: string;
      model_options: string[];
      finetuned?: boolean;
    }>;
    created_at: string;
    updated_at: string;
    expires_at?: string;
    addons?: string[];
    video_count?: number;
    total_duration?: number;
  };
  error?: string;
}

export interface ClientUploadResponse {
  success: boolean;
  task?: {
    _id: string;
    status: string;
    video_id?: string;
    progress?: number;
  };
  taskId?: string;
  error?: string;
}

export interface ClientStatusResponse {
  success: boolean;
  task?: {
    _id: string;
    status: string;
    video_id?: string;
    progress?: number;
    message?: string;
  };
  status?: string;
  progress?: number;
  error?: string;
}

export interface ClientStatusUpdate {
  task?: {
    _id: string;
    status: string;
    video_id?: string;
    progress?: number;
  };
  progress: number;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

/**
 * Client-side service for Twelvelabs operations
 * Routes all requests through server-side API endpoints
 */
export class TwelveLabsClient {
  private baseUrl = "/api/twelvelabs";

  /**
   * Get or create an index for the current user
   */
  async getUserIndex(): Promise<ClientIndexResponse> {
    try {
      console.log("🔄 Getting user index via API...");

      const response = await fetch(`${this.baseUrl}/index`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      console.log("✅ Got user index:", result);
      return result;
    } catch (error) {
      console.error("❌ Failed to get user index:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Upload a video file for indexing using FormData
   */
  async uploadVideoFile(
    videoFile: File,
    language = "en",
    options?: { projectId?: string; mediaId?: string }
  ): Promise<ClientUploadResponse> {
    try {
      console.log("🎬 Uploading video file via API:", videoFile.name);

      const formData = new FormData();
      formData.append("videoFile", videoFile);
      formData.append("language", language);
      if (options?.projectId) formData.append("projectId", options.projectId);
      if (options?.mediaId) formData.append("mediaId", options.mediaId);

      const response = await fetch(`${this.baseUrl}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      console.log("✅ Video file upload initiated:", result);
      return result;
    } catch (error) {
      console.error("❌ Failed to upload video file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Upload a video for indexing (URL-based, kept for backward compatibility)
   */
  async uploadVideo(
    videoUrl: string,
    language = "en"
  ): Promise<ClientUploadResponse> {
    try {
      console.log("🎬 Uploading video via API:", videoUrl);

      const response = await fetch(`${this.baseUrl}/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoUrl,
          language,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      console.log("✅ Video upload initiated:", result);
      return result;
    } catch (error) {
      console.error("❌ Failed to upload video:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Check the status of a task
   */
  async checkTaskStatus(
    taskId: string,
    options?: { projectId?: string; mediaId?: string }
  ): Promise<ClientStatusResponse> {
    try {
      console.log("📊 Checking task status via API:", taskId);

      const params = new URLSearchParams({ task_id: taskId });
      if (options?.projectId) params.set("project_id", options.projectId);
      if (options?.mediaId) params.set("media_id", options.mediaId);
      const response = await fetch(
        `${this.baseUrl}/status?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      console.log("✅ Got task status:", result);
      return result;
    } catch (error) {
      console.error("❌ Failed to check task status:", error);
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
    videoUrl: string,
    language = "en"
  ): Promise<ClientUploadResponse> {
    return this.uploadVideo(videoUrl, language);
  }

  /**
   * Poll task status until completion or failure
   */
  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (statusUpdate: ClientStatusUpdate) => void,
    maxAttempts = 60,
    intervalMs = 5000,
    options?: { projectId?: string; mediaId?: string }
  ): Promise<ClientStatusResponse> {
    console.log(`🔄 Starting to poll task ${taskId} for completion`);

    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const statusResponse = await this.checkTaskStatus(taskId, options);

        if (!statusResponse.success || !statusResponse.task) {
          return statusResponse;
        }

        const task = statusResponse.task;

        // Convert to our status update format
        if (onProgress) {
          let status: "pending" | "processing" | "completed" | "failed";
          let progress = task.progress || 0;

          switch (task.status) {
            case "queued":
              status = "pending";
              progress = Math.max(1, progress);
              break;
            case "uploading":
              status = "pending";
              progress = Math.max(2, progress);
              break;
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

          onProgress({
            task,
            progress,
            status,
          });
        }

        // Check if task is complete
        if (task.status === "ready") {
          console.log(`✅ Task ${taskId} completed successfully`);
          return statusResponse;
        }

        // Check if task failed
        if (task.status === "failed") {
          console.error(`❌ Task ${taskId} failed:`, task.message);
          return {
            success: false,
            error: task.message || "Task failed",
            task,
          };
        }

        // Task is still in progress
        console.log(
          `⏳ Task ${taskId} status: ${task.status}, progress: ${task.progress || 0}%`
        );

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        attempts++;
      } catch (error) {
        console.error(`❌ Error polling task ${taskId}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Polling failed",
        };
      }
    }

    // Max attempts reached
    console.warn(
      `⏰ Task ${taskId} polling timed out after ${maxAttempts} attempts`
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
    videoFile: File,
    onStatusUpdate?: (statusUpdate: ClientStatusUpdate) => void,
    language = "en",
    options?: { projectId?: string; mediaId?: string }
  ): Promise<{ success: boolean; taskId?: string; error?: string }> {
    try {
      console.log(`🎬 Starting background indexing via API: ${videoFile.name}`);

      // Start the upload/analysis
      const uploadResponse = await this.uploadVideoFile(videoFile, language, {
        projectId: options?.projectId,
        mediaId: options?.mediaId,
      });

      if (!uploadResponse.success || !uploadResponse.taskId) {
        return {
          success: false,
          error: uploadResponse.error,
        };
      }

      const taskId = uploadResponse.taskId;

      // Start polling in the background (don't await)
      this.pollTaskUntilComplete(taskId, onStatusUpdate, 60, 5000, {
        projectId: options?.projectId,
        mediaId: options?.mediaId,
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
          console.error("❌ Background polling failed:", error);
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
      console.error("❌ Failed to start background indexing:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Restore indexing status from server-side storage
   */
  async restoreIndexingStatus(
    projectId: string,
    mediaIds?: string[]
  ): Promise<{
    success: boolean;
    restoredStatus?: Record<string, any>;
    error?: string;
  }> {
    try {
      console.log("🔄 Restoring indexing status via API...");

      const params = new URLSearchParams({ project_id: projectId });
      if (mediaIds) {
        params.set("media_ids", JSON.stringify(mediaIds));
      }

      const response = await fetch(
        `${this.baseUrl}/restore-status?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      console.log("✅ Restored indexing status:", result);
      return result;
    } catch (error) {
      console.error("❌ Failed to restore indexing status:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

// Export singleton instance
export const twelveLabsClient = new TwelveLabsClient();
