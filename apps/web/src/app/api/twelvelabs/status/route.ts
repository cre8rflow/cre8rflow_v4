import { NextRequest, NextResponse } from "next/server";
import { twelveLabsService } from "@/lib/twelvelabs-service";
import { updateTwelveLabsStatus, updateMediaIndexJob } from "@/lib/supabase";

/**
 * Twelvelabs Status API Route
 * GET: Check the status of a Twelvelabs task
 */
export async function GET(request: NextRequest) {
  try {
    console.log("🎯 Twelvelabs Status API - Starting request");

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("task_id");
    const projectId = searchParams.get("project_id");
    const mediaId = searchParams.get("media_id");

    if (!taskId) {
      console.error("❌ Task ID is required");
      return NextResponse.json(
        {
          success: false,
          error: "Task ID is required",
        },
        { status: 400 }
      );
    }

    console.log(`📊 Checking task status: ${taskId}`);

    // Use the service to check task status
    const result = await twelveLabsService.checkTaskStatus(taskId);

    if (!result.success) {
      console.error("❌ Failed to check task status:", result.error);
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 500 }
      );
    }

    console.log("✅ Successfully retrieved task status:", result.task);

    // Persist status update if identifiers are provided (mirror V3 behavior)
    try {
      if (projectId && mediaId && result.task) {
        const status =
          result.task.status === "ready"
            ? "completed"
            : result.task.status === "failed"
              ? "failed"
              : result.task.status === "indexing"
                ? "processing"
                : "pending";
        // Upsert semantics: ensure row exists then update
        await updateTwelveLabsStatus(mediaId, projectId, {
          // V4 fields
          indexing_status: status as any,
          indexing_progress: result.task.progress ?? undefined,
          twelve_labs_video_id: result.task.video_id,
          twelve_labs_task_id: result.task._id,
          // V3 fields
          status,
          video_id: result.task.video_id,
          task_id: result.task._id,
          metadata: { task: result.task },
        });
        await updateMediaIndexJob(projectId, mediaId, {
          status: (result.task.status === "ready"
            ? "ready"
            : result.task.status === "indexing"
              ? "indexing"
              : result.task.status === "failed"
                ? "failed"
                : "pending") as any,
          progress: result.task.progress ?? undefined,
          task_id: result.task._id,
          video_id: result.task.video_id,
          metadata: { task: result.task },
        });
        console.log("💾 Persisted Twelvelabs status update");
      }
    } catch (persistError) {
      console.error(
        "❌ Failed to persist Twelvelabs status update:",
        persistError
      );
      // Non-fatal
    }

    return NextResponse.json({
      success: true,
      task: result.task,
      status: result.task?.status,
      progress: result.task?.progress,
      message: "Task status retrieved successfully",
    });
  } catch (error) {
    console.error("❌ Twelvelabs Status API error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
