import { NextRequest, NextResponse } from 'next/server';
import { twelveLabsService } from '@/lib/twelvelabs-service';

/**
 * Twelvelabs Status API Route
 * GET: Check the status of a Twelvelabs task
 */
export async function GET(request: NextRequest) {
  try {
    console.log('🎯 Twelvelabs Status API - Starting request');
    
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');
    
    if (!taskId) {
      console.error('❌ Task ID is required');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Task ID is required' 
        },
        { status: 400 }
      );
    }
    
    console.log(`📊 Checking task status: ${taskId}`);
    
    // Use the service to check task status
    const result = await twelveLabsService.checkTaskStatus(taskId);
    
    if (!result.success) {
      console.error('❌ Failed to check task status:', result.error);
      return NextResponse.json(
        { 
          success: false, 
          error: result.error 
        },
        { status: 500 }
      );
    }
    
    console.log('✅ Successfully retrieved task status:', result.task);
    
    return NextResponse.json({
      success: true,
      task: result.task,
      status: result.task?.status,
      progress: result.task?.progress,
      message: 'Task status retrieved successfully'
    });
    
  } catch (error) {
    console.error('❌ Twelvelabs Status API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}