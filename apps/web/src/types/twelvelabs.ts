/**
 * Twelvelabs Type Definitions
 * Ported from V3 for type safety in Twelvelabs integration
 */

export type IndexingStatus =
  | "pending"
  | "uploading"
  | "validating"
  | "queued"
  | "indexing"
  | "ready"
  | "failed";

export interface TwelveLabsIndex {
  id: string;
  name: string;
  models: string[];
  created_at: string;
  updated_at: string;
}

export interface TwelveLabsTask {
  video_id: string;
  index_id: string;
  id: string;
  status: IndexingStatus;
  created_at: string;
  updated_at: string;
  system_metadata?: {
    video_url?: string;
    filename?: string;
  };
  hls?: {
    video_url?: string;
    thumbnail_urls?: string[];
  };
}

export interface TwelveLabsVideoMetadata {
  video_id: string;
  task_id: string;
  index_id: string;
  status: IndexingStatus;
  error?: string;
  progress?: number;
  created_at: string;
  updated_at: string;
}

export interface UserIndexMapping {
  user_id: string;
  index_id: string;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  video_id: string;
  score: number;
  start: number;
  end: number;
  confidence?: "high" | "medium" | "low";
  metadata?: {
    text?: string;
    type?: string;
  }[];
}

export interface AnalysisResult {
  video_id: string;
  title?: string;
  topics?: string[];
  hashtags?: string[];
  summary?: string;
  chapters?: {
    start: number;
    end: number;
    chapter_title: string;
    chapter_summary: string;
  }[];
  highlights?: {
    start: number;
    end: number;
    highlight: string;
  }[];
  created_at: string;
  updated_at: string;
}

// Extended types for V4 integration
export interface MediaTwelveLabsStatus {
  mediaId: string;
  projectId: string;
  twelveLabsVideoId?: string;
  twelveLabsTaskId?: string;
  indexId?: string;
  status: IndexingStatus;
  progress?: number;
  error?: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

// API Response types for better type safety
export interface TwelveLabsApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface IndexCreationRequest {
  name: string;
  options: string[];
  engine_id: string;
}

export interface VideoUploadRequest {
  index_id: string;
  language?: string;
  url?: string;
  file?: File;
  metadata?: Record<string, any>;
}

export interface SearchRequest {
  query: string;
  index_id: string;
  search_options: string[];
  page_limit?: number;
  sort_option?: "score" | "clip_count";
  threshold?: "high" | "medium" | "low";
}

export interface SearchResponse {
  query: string;
  pool: {
    total_count: number;
    total_duration: number;
  };
  data: SearchResult[];
  page_info?: {
    limit_per_page: number;
    total_page: number;
    page_expired_at: string;
    next_page_token?: string;
  };
}
