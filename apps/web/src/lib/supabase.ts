import { env } from "@/env";

/**
 * Supabase integration for persistent storage of Twelvelabs indexing status
 * Ported from V3 for persistent tracking of AI video analysis
 */

export interface MediaTwelveLabsRow {
  id?: string;
  media_id: string;
  project_id: string;
  // V4 naming (kept for compatibility)
  twelve_labs_video_id?: string;
  twelve_labs_task_id?: string;
  indexing_status?: "pending" | "processing" | "completed" | "failed";
  indexing_progress?: number;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: any;
  // V3 naming (per your existing dataset)
  index_id?: string;
  video_id?: string;
  task_id?: string;
  status?: string;
  duration?: number | string | null;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Helper function for making authenticated requests to Supabase
 */
async function supabaseFetch(url: string, options: RequestInit = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error(
      "Supabase configuration missing. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY."
    );
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${url}`, {
    ...options,
    headers: {
      "apikey": env.SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Supabase request failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return response;
}

/**
 * Save or update TwelveLabs metadata for a media item
 */
export async function saveTwelveLabsMetadata(
  data: MediaTwelveLabsRow
): Promise<MediaTwelveLabsRow[]> {
  console.log("Saving TwelveLabs metadata:", data);

  try {
    const response = await supabaseFetch(
      "media_twelvelabs?on_conflict=media_id,project_id",
      {
        method: "POST",
        headers: {
          // Upsert semantics: merge on (media_id, project_id)
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          ...data,
          // Mirror fields across V3/V4 schemas for compatibility
          video_id: data.video_id ?? data.twelve_labs_video_id,
          task_id: data.task_id ?? data.twelve_labs_task_id,
          status: data.status ?? data.indexing_status,
          twelve_labs_video_id: data.twelve_labs_video_id ?? data.video_id,
          twelve_labs_task_id: data.twelve_labs_task_id ?? data.task_id,
          indexing_status: (data.indexing_status ?? data.status) as any,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    const result = await response.json();
    console.log("Successfully saved TwelveLabs metadata:", result);
    return result;
  } catch (error) {
    console.error("Failed to save TwelveLabs metadata:", error);
    throw error;
  }
}

/**
 * Update specific fields for a TwelveLabs media entry
 */
export async function updateTwelveLabsStatus(
  mediaId: string,
  projectId: string,
  updates: Partial<MediaTwelveLabsRow>
): Promise<MediaTwelveLabsRow[]> {
  console.log(
    `Updating TwelveLabs status for media ${mediaId} in project ${projectId}:`,
    updates
  );

  try {
    const response = await supabaseFetch(
      `media_twelvelabs?media_id=eq.${mediaId}&project_id=eq.${projectId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          ...updates,
          // Keep both naming schemes updated
          video_id: updates.video_id ?? updates.twelve_labs_video_id,
          task_id: updates.task_id ?? updates.twelve_labs_task_id,
          status: updates.status ?? updates.indexing_status,
          twelve_labs_video_id:
            updates.twelve_labs_video_id ?? updates.video_id,
          twelve_labs_task_id: updates.twelve_labs_task_id ?? updates.task_id,
          indexing_status: (updates.indexing_status ?? updates.status) as any,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    const result = await response.json();
    console.log("Successfully updated TwelveLabs status:", result);
    return result;
  } catch (error) {
    console.error("Failed to update TwelveLabs status:", error);
    throw error;
  }
}

/**
 * Get TwelveLabs metadata for multiple media IDs in a project
 */
export async function getTwelveLabsMetadata(
  projectId: string,
  mediaIds?: string[]
): Promise<MediaTwelveLabsRow[]> {
  console.log(
    `Getting TwelveLabs metadata for project ${projectId}`,
    mediaIds ? `with media IDs: ${mediaIds.join(", ")}` : "(all media)"
  );

  try {
    let url = `media_twelvelabs?project_id=eq.${projectId}`;

    if (mediaIds && mediaIds.length > 0) {
      const mediaIdFilter = mediaIds.map((id) => `"${id}"`).join(",");
      url += `&media_id=in.(${mediaIdFilter})`;
    }

    const response = await supabaseFetch(url, {
      method: "GET",
    });

    const result = await response.json();
    console.log("Successfully retrieved TwelveLabs metadata:", result);
    return result;
  } catch (error) {
    console.error("Failed to get TwelveLabs metadata:", error);
    throw error;
  }
}

/**
 * Delete TwelveLabs metadata for a media item
 */
export async function deleteTwelveLabsMetadata(
  mediaId: string,
  projectId: string
): Promise<void> {
  console.log(
    `Deleting TwelveLabs metadata for media ${mediaId} in project ${projectId}`
  );

  try {
    await supabaseFetch(
      `media_twelvelabs?media_id=eq.${mediaId}&project_id=eq.${projectId}`,
      {
        method: "DELETE",
      }
    );

    console.log("Successfully deleted TwelveLabs metadata");
  } catch (error) {
    console.error("Failed to delete TwelveLabs metadata:", error);
    throw error;
  }
}

// ==================== NEW: media_index_jobs helpers ====================

export interface MediaIndexJobRow {
  id?: string;
  project_id: string;
  media_id: string;
  storage_key?: string | null;
  index_id?: string | null;
  task_id?: string | null;
  video_id?: string | null;
  status?: "pending" | "indexing" | "ready" | "failed";
  progress?: number | null;
  error_message?: string | null;
  metadata?: any;
  created_at?: string;
  updated_at?: string;
}

export async function upsertMediaIndexJob(
  row: MediaIndexJobRow
): Promise<MediaIndexJobRow[]> {
  const response = await supabaseFetch(
    "media_index_jobs?on_conflict=project_id,media_id",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        ...row,
        updated_at: new Date().toISOString(),
      }),
    }
  );
  return response.json();
}

export async function updateMediaIndexJob(
  projectId: string,
  mediaId: string,
  updates: Partial<MediaIndexJobRow>
): Promise<MediaIndexJobRow[]> {
  const response = await supabaseFetch(
    `media_index_jobs?project_id=eq.${projectId}&media_id=eq.${mediaId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...updates,
        updated_at: new Date().toISOString(),
      }),
    }
  );
  return response.json();
}

export async function getMediaIndexJobs(
  projectId: string,
  mediaIds?: string[]
): Promise<MediaIndexJobRow[]> {
  let url = `media_index_jobs?project_id=eq.${projectId}`;
  if (mediaIds?.length) {
    const filter = mediaIds.map((id) => `"${id}"`).join(",");
    url += `&media_id=in.(${filter})`;
  }
  const response = await supabaseFetch(url, { method: "GET" });
  return response.json();
}

/**
 * Helper functions for common operations
 */

export async function supabaseSelectOne<T>(
  table: string,
  filters: Record<string, string | number>
): Promise<T | null> {
  const filterParams = Object.entries(filters)
    .map(([key, value]) => `${key}=eq.${value}`)
    .join("&");

  try {
    const response = await supabaseFetch(`${table}?${filterParams}&limit=1`, {
      method: "GET",
    });

    const result = await response.json();
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error(`Failed to select from ${table}:`, error);
    throw error;
  }
}

export async function supabaseSelect<T>(
  table: string,
  filters?: Record<string, string | number>
): Promise<T[]> {
  let url = table;

  if (filters) {
    const filterParams = Object.entries(filters)
      .map(([key, value]) => `${key}=eq.${value}`)
      .join("&");
    url += `?${filterParams}`;
  }

  try {
    const response = await supabaseFetch(url, {
      method: "GET",
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Failed to select from ${table}:`, error);
    throw error;
  }
}

export async function supabaseUpsert<T>(
  table: string,
  data: any
): Promise<T[]> {
  try {
    const response = await supabaseFetch(table, {
      method: "POST",
      body: JSON.stringify({
        ...data,
        updated_at: new Date().toISOString(),
      }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Failed to upsert to ${table}:`, error);
    throw error;
  }
}

export async function supabaseUpdate<T>(
  table: string,
  filters: Record<string, string | number>,
  updates: any
): Promise<T[]> {
  const filterParams = Object.entries(filters)
    .map(([key, value]) => `${key}=eq.${value}`)
    .join("&");

  try {
    const response = await supabaseFetch(`${table}?${filterParams}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...updates,
        updated_at: new Date().toISOString(),
      }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Failed to update ${table}:`, error);
    throw error;
  }
}
