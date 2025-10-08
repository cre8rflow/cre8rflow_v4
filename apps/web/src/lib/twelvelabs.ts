import { env } from "@/env";
import { z } from "zod";

/**
 * Twelvelabs REST API wrapper for video indexing and search operations
 * Ported from V3 for AI video analysis integration
 */

// Custom error class for Twelve Labs API errors
export class TwelveLabsApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: any
  ) {
    super(message);
    this.name = "TwelveLabsApiError";
  }
}

// Zod schemas for API response validation
const IndexSchema = z.object({
  _id: z.string(),
  index_name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  expires_at: z.string().optional(),
  addons: z.array(z.string()).optional(),
  models: z.array(
    z.object({
      model_name: z.string(),
      model_options: z.array(z.string()),
      finetuned: z.boolean().optional(),
    })
  ),
  video_count: z.number().optional(),
  total_duration: z.number().optional(),
});

const TaskSchema = z.object({
  _id: z.string(),
  status: z.enum([
    "queued",
    "pending",
    "validating",
    "uploading",
    "indexing",
    "ready",
    "failed",
  ]),
  type: z.string().optional(), // v1.3 API doesn't always return this field
  message: z.string().optional(),
  progress: z.number().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  video_id: z.string().optional(),
});

const VideoSchema = z.object({
  _id: z.string(),
  metadata: z.object({
    filename: z.string(),
    duration: z.number(),
    fps: z.number(),
    width: z.number(),
    height: z.number(),
    size: z.number(),
  }),
  hls: z
    .object({
      video_url: z.string(),
      thumbnail_urls: z.array(z.string()).optional(),
    })
    .optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const SearchResultSchema = z.object({
  search_pool: z.object({
    total_count: z.number(),
    total_duration: z.number(),
    index_id: z.string(),
  }),
  data: z.array(
    z.object({
      score: z.number().optional(),
      start: z.number(),
      end: z.number(),
      video_id: z.string(),
      metadata: z
        .array(
          z.object({
            type: z.string().optional(),
            text: z.string().optional(),
          })
        )
        .optional(),
    })
  ),
  page_info: z
    .object({
      limit_per_page: z.number().optional(),
      total_results: z.number().optional(),
      page_expires_at: z.string().optional(),
    })
    .optional(),
});

export type Index = z.infer<typeof IndexSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;

// Helper function for making authenticated requests to Twelve Labs API
async function twelveLabsRequest(endpoint: string, options: RequestInit = {}) {
  if (!env.TWELVELABS_API_KEY) {
    throw new TwelveLabsApiError("Twelve Labs API key not configured");
  }

  const url = `https://api.twelvelabs.io/v1.3/${endpoint}`;
  console.log(
    `Making Twelve Labs API request: ${options.method || "GET"} ${url}`
  );

  // Prepare headers - don't set Content-Type for FormData
  const headers: Record<string, string> = {
    "X-API-Key": env.TWELVELABS_API_KEY,
    ...options.headers,
  };

  // Only set Content-Type to application/json if not FormData
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const responseData = await response.json();

  if (!response.ok) {
    console.error("Twelve Labs API error:", {
      status: response.status,
      statusText: response.statusText,
      data: responseData,
    });
    throw new TwelveLabsApiError(
      responseData.message ||
        `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      responseData
    );
  }

  console.log("Twelve Labs API response:", responseData);
  return responseData;
}

/**
 * Find an existing index by name
 */
export async function findExistingIndex(
  indexName: string
): Promise<Index | null> {
  console.log(`Looking for existing index: ${indexName}`);

  try {
    const response = await twelveLabsRequest("indexes");
    const indexes = IndexSchema.array().parse(response.data || []);

    const existingIndex = indexes.find(
      (index) => index.index_name === indexName
    );

    if (existingIndex) {
      console.log("Found existing index:", existingIndex);
      return existingIndex;
    }

    console.log("No existing index found");
    return null;
  } catch (error) {
    console.error("Error finding existing index:", error);
    throw error;
  }
}

/**
 * Create a new index for a user/project
 */
export async function createUserIndex(
  indexName: string,
  modelName = "marengo2.7"
): Promise<Index> {
  console.log(`Creating new index: ${indexName} with model: ${modelName}`);

  try {
    const indexData = {
      index_name: indexName,
      models: [
        {
          model_name: modelName,
          model_options: ["visual", "audio"], // v1.3 uses 'visual' and 'audio' instead of the old options
        },
      ],
      addons: ["thumbnail"], // Enable thumbnail generation
    };

    const response = await twelveLabsRequest("indexes", {
      method: "POST",
      body: JSON.stringify(indexData),
    });

    // The create response only returns _id, so we need to fetch the full index details
    console.log("Index created with ID:", response._id);

    // Fetch the full index details
    const fullIndexResponse = await twelveLabsRequest(
      `indexes/${response._id}`
    );
    const index = IndexSchema.parse(fullIndexResponse);
    console.log("Successfully created and retrieved index:", index);
    return index;
  } catch (error) {
    console.error("Error creating index:", error);
    throw error;
  }
}

/**
 * Upload a video to an index
 */
export async function uploadVideoToIndex(
  indexId: string,
  videoUrl: string,
  language = "en"
): Promise<Task> {
  console.log(`Uploading video to index ${indexId}: ${videoUrl}`);

  try {
    const uploadData = {
      index_id: indexId,
      language,
      url: videoUrl,
    };

    const response = await twelveLabsRequest("tasks", {
      method: "POST",
      body: JSON.stringify(uploadData),
    });

    const task = TaskSchema.parse(response);
    console.log("Video upload task created:", task);
    return task;
  } catch (error) {
    console.error("Error uploading video:", error);
    throw error;
  }
}

/**
 * Upload a video file to an index using FormData
 */
export async function uploadVideoFileToIndex(
  indexId: string,
  videoFile: File,
  language = "en"
): Promise<Task> {
  console.log(`Uploading video file to index ${indexId}: ${videoFile.name}`);

  try {
    const formData = new FormData();
    formData.append("video_file", videoFile);
    formData.append("index_id", indexId);
    formData.append("language", language);

    const response = await twelveLabsRequest("tasks", {
      method: "POST",
      body: formData,
      // Don't set Content-Type header for FormData - let the browser set it with boundary
    });

    // The create response only returns _id and video_id, so we need to fetch the full task details
    console.log("Task created with ID:", response._id);

    // Fetch the full task details
    const fullTaskResponse = await twelveLabsRequest(`tasks/${response._id}`);
    const task = TaskSchema.parse(fullTaskResponse);
    console.log("Video file upload task created and retrieved:", task);
    return task;
  } catch (error) {
    console.error("Error uploading video file:", error);
    throw error;
  }
}

/**
 * Get the status of a task
 */
export async function getTaskStatus(taskId: string): Promise<Task> {
  console.log(`Getting task status: ${taskId}`);

  try {
    const response = await twelveLabsRequest(`tasks/${taskId}`);
    const task = TaskSchema.parse(response);

    console.log("Task status:", task);
    return task;
  } catch (error) {
    console.error("Error getting task status:", error);
    throw error;
  }
}

/**
 * Analyze video content (alias for uploadVideoToIndex for clarity)
 */
export async function analyzeVideo(
  indexId: string,
  videoUrl: string,
  language = "en"
): Promise<Task> {
  return uploadVideoToIndex(indexId, videoUrl, language);
}

/**
 * Search videos in an index
 */
export async function searchVideos(
  indexId: string,
  query: string,
  searchOptions?: {
    page_limit?: number;
    sort_option?: "score" | "clip_count";
    threshold?: "high" | "medium" | "low";
    search_options?: Array<
      "audio" | "visual" | "conversation" | "text_in_video" | "logo"
    >;
  },
  videoIds?: string[]
): Promise<SearchResult> {
  console.log(`Searching videos in index ${indexId}: "${query}"`);

  try {
    const domains =
      searchOptions?.search_options && searchOptions.search_options.length
        ? searchOptions.search_options
        : ["visual"];

    const form = new FormData();
    form.append("query_text", query);
    form.append("index_id", indexId);

    domains.forEach((domain) => form.append("search_options", domain));

    if (searchOptions?.page_limit != null) {
      form.append("page_limit", String(searchOptions.page_limit));
    }
    if (searchOptions?.sort_option) {
      form.append("sort_option", searchOptions.sort_option);
    }
    if (searchOptions?.threshold) {
      form.append("threshold", searchOptions.threshold);
    }
    if (videoIds && videoIds.length) {
      for (const vid of videoIds) {
        form.append("video_ids[]", vid);
      }
    }

    const response = await twelveLabsRequest("search", {
      method: "POST",
      body: form,
    });

    const searchResult = SearchResultSchema.parse(response);
    console.log("Search results:", searchResult);
    return searchResult;
  } catch (error) {
    console.error("Error searching videos:", error);
    throw error;
  }
}

/**
 * Get video details
 */
export async function getVideoDetails(videoId: string): Promise<Video> {
  console.log(`Getting video details: ${videoId}`);

  try {
    const response = await twelveLabsRequest(`videos/${videoId}`);
    const video = VideoSchema.parse(response);

    console.log("Video details:", video);
    return video;
  } catch (error) {
    console.error("Error getting video details:", error);
    throw error;
  }
}

/**
 * List all indexes
 */
export async function listIndexes(): Promise<Index[]> {
  console.log("Listing all indexes");

  try {
    const response = await twelveLabsRequest("indexes");
    const indexes = IndexSchema.array().parse(response.data || []);

    console.log("Retrieved indexes:", indexes);
    return indexes;
  } catch (error) {
    console.error("Error listing indexes:", error);
    throw error;
  }
}

/**
 * Get index details
 */
export async function getIndexDetails(indexId: string): Promise<Index> {
  console.log(`Getting index details: ${indexId}`);

  try {
    const response = await twelveLabsRequest(`indexes/${indexId}`);
    const index = IndexSchema.parse(response);

    console.log("Index details:", index);
    return index;
  } catch (error) {
    console.error("Error getting index details:", error);
    throw error;
  }
}

/**
 * Delete an index
 */
export async function deleteIndex(indexId: string): Promise<void> {
  console.log(`Deleting index: ${indexId}`);

  try {
    await twelveLabsRequest(`indexes/${indexId}`, {
      method: "DELETE",
    });

    console.log("Successfully deleted index");
  } catch (error) {
    console.error("Error deleting index:", error);
    throw error;
  }
}
