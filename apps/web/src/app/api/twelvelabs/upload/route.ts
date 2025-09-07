import { NextRequest, NextResponse } from 'next/server';
import { twelveLabsService } from '@/lib/twelvelabs-service';

/**
 * Twelvelabs Upload API Route
 * POST: Upload a video for indexing
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🎯 Twelvelabs Upload API - Starting request');
    
    const body = await request.json();
    const { videoUrl, language = 'en' } = body;
    
    if (!videoUrl) {
      console.error('❌ Video URL is required');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Video URL is required' 
        },
        { status: 400 }
      );
    }
    
    // For now, we'll use a default user ID since authentication is not fully set up
    // In production, you would extract this from the authenticated session
    const userId = 'default-user'; // TODO: Replace with actual user ID from session
    
    console.log(`📤 Uploading video for user ${userId}: ${videoUrl}`);
    
    // Use the service to upload the video
    const result = await twelveLabsService.uploadVideo(userId, videoUrl, language);
    
    if (!result.success) {
      console.error('❌ Failed to upload video:', result.error);
      return NextResponse.json(
        { 
          success: false, 
          error: result.error 
        },
        { status: 500 }
      );
    }
    
    console.log('✅ Successfully uploaded video, task created:', result.task);
    
    return NextResponse.json({
      success: true,
      task: result.task,
      taskId: result.task?._id,
      message: 'Video upload initiated successfully'
    });
    
  } catch (error) {
    console.error('❌ Twelvelabs Upload API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}