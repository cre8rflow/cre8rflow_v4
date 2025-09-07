import { env } from "@/env";

/**
 * Supabase integration for persistent storage of Twelvelabs indexing status
 * Ported from V3 for persistent tracking of AI video analysis
 */

export interface MediaTwelveLabsRow {
  id?: string;
  media_id: string;
  project_id: string;
  twelve_labs_video_id?: string;
  twelve_labs_task_id?: string;
  indexing_status: 'pending' | 'processing' | 'completed' | 'failed';
  indexing_progress?: number;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: any;
}

/**
 * Helper function for making authenticated requests to Supabase
 */
async function supabaseFetch(url: string, options: RequestInit = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error("Supabase configuration missing. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY.");
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${url}`, {
    ...options,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response;
}

/**
 * Save or update TwelveLabs metadata for a media item
 */
export async function saveTwelveLabsMetadata(data: MediaTwelveLabsRow): Promise<MediaTwelveLabsRow[]> {
  console.log('Saving TwelveLabs metadata:', data);

  try {
    const response = await supabaseFetch('media_twelvelabs', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        updated_at: new Date().toISOString(),
      }),
    });

    const result = await response.json();
    console.log('Successfully saved TwelveLabs metadata:', result);
    return result;
  } catch (error) {
    console.error('Failed to save TwelveLabs metadata:', error);
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
  console.log(`Updating TwelveLabs status for media ${mediaId} in project ${projectId}:`, updates);

  try {
    const response = await supabaseFetch(
      `media_twelvelabs?media_id=eq.${mediaId}&project_id=eq.${projectId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...updates,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    const result = await response.json();
    console.log('Successfully updated TwelveLabs status:', result);
    return result;
  } catch (error) {
    console.error('Failed to update TwelveLabs status:', error);
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
  console.log(`Getting TwelveLabs metadata for project ${projectId}`, mediaIds ? `with media IDs: ${mediaIds.join(', ')}` : '(all media)');

  try {
    let url = `media_twelvelabs?project_id=eq.${projectId}`;
    
    if (mediaIds && mediaIds.length > 0) {
      const mediaIdFilter = mediaIds.map(id => `"${id}"`).join(',');
      url += `&media_id=in.(${mediaIdFilter})`;
    }

    const response = await supabaseFetch(url, {
      method: 'GET',
    });

    const result = await response.json();
    console.log('Successfully retrieved TwelveLabs metadata:', result);
    return result;
  } catch (error) {
    console.error('Failed to get TwelveLabs metadata:', error);
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
  console.log(`Deleting TwelveLabs metadata for media ${mediaId} in project ${projectId}`);

  try {
    const response = await supabaseFetch(
      `media_twelvelabs?media_id=eq.${mediaId}&project_id=eq.${projectId}`,
      {
        method: 'DELETE',
      }
    );

    console.log('Successfully deleted TwelveLabs metadata');
  } catch (error) {
    console.error('Failed to delete TwelveLabs metadata:', error);
    throw error;
  }
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
    .join('&');

  try {
    const response = await supabaseFetch(`${table}?${filterParams}&limit=1`, {
      method: 'GET',
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
      .join('&');
    url += `?${filterParams}`;
  }

  try {
    const response = await supabaseFetch(url, {
      method: 'GET',
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
      method: 'POST',
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
    .join('&');

  try {
    const response = await supabaseFetch(`${table}?${filterParams}`, {
      method: 'PATCH',
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