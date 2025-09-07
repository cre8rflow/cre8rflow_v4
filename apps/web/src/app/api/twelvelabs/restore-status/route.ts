import { NextRequest, NextResponse } from 'next/server';
import { getTwelveLabsMetadata } from '@/lib/supabase';

/**
 * Twelvelabs Restore Status API Route
 * GET: Restore Twelvelabs indexing status from persistent storage
 */
export async function GET(request: NextRequest) {
  try {
    console.log('🎯 Twelvelabs Restore Status API - Starting request');
    
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const mediaIdsParam = searchParams.get('media_ids');
    
    if (!projectId) {
      console.error('❌ Project ID is required');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Project ID is required' 
        },
        { status: 400 }
      );
    }
    
    let mediaIds: string[] | undefined;
    if (mediaIdsParam) {
      try {
        mediaIds = JSON.parse(mediaIdsParam);
        if (!Array.isArray(mediaIds)) {
          throw new Error('Media IDs must be an array');
        }
      } catch (error) {
        console.error('❌ Invalid media_ids format:', error);
        return NextResponse.json(
          { 
            success: false, 
            error: 'Invalid media_ids format. Must be a JSON array of strings' 
          },
          { status: 400 }
        );
      }
    }
    
    console.log(`📋 Restoring status for project ${projectId}`, mediaIds ? `with media IDs: ${mediaIds.join(', ')}` : '(all media)');
    
    // Get metadata from Supabase
    const metadata = await getTwelveLabsMetadata(projectId, mediaIds);
    
    // Transform the data into a more convenient format
    const restoredStatus: Record<string, any> = {};
    
    for (const item of metadata) {
      restoredStatus[item.media_id] = {
        mediaId: item.media_id,
        projectId: item.project_id,
        twelveLabsVideoId: item.twelve_labs_video_id,
        twelveLabsTaskId: item.twelve_labs_task_id,
        status: item.indexing_status,
        progress: item.indexing_progress,
        error: item.error_message,
        metadata: item.metadata,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      };
    }
    
    console.log(`✅ Successfully restored status for ${metadata.length} media items`);
    
    return NextResponse.json({
      success: true,
      restoredStatus,
      count: metadata.length,
      message: 'Status restored successfully'
    });
    
  } catch (error) {
    console.error('❌ Twelvelabs Restore Status API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}