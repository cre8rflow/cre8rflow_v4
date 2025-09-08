export type MediaType = "image" | "video" | "audio";

// Twelvelabs indexing status for media files
export type IndexingStatus = "pending" | "processing" | "completed" | "failed";

// What's stored in media library
export interface MediaFile {
  id: string;
  name: string;
  type: MediaType;
  file: File;
  url?: string; // Object URL for preview
  thumbnailUrl?: string; // For video thumbnails
  duration?: number; // For video/audio duration
  width?: number; // For video/image width
  height?: number; // For video/image height
  fps?: number; // For video frame rate
  // Ephemeral items are used by timeline directly and should not appear in the media library or be persisted
  ephemeral?: boolean;

  // V3 Integration: Twelvelabs AI analysis fields (optional - only for videos)
  twelveLabsVideoId?: string; // Video ID from Twelvelabs after upload
  twelveLabsTaskId?: string; // Task ID for tracking indexing progress
  indexingStatus?: IndexingStatus; // Current status of AI indexing
  indexingProgress?: number; // Percentage completion (0-100)
  indexingError?: string; // Error message if indexing failed
}
