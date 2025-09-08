import { NextRequest, NextResponse } from "next/server";
import { getTwelveLabsMetadata, getMediaIndexJobs } from "@/lib/supabase";

/**
 * Twelvelabs Restore Status API Route
 * GET: Restore Twelvelabs indexing status from persistent storage
 */
export async function GET(request: NextRequest) {
  try {
    console.log("🎯 Twelvelabs Restore Status API - Starting request");

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id");
    const mediaIdsParam = searchParams.get("media_ids");

    if (!projectId) {
      console.error("❌ Project ID is required");
      return NextResponse.json(
        {
          success: false,
          error: "Project ID is required",
        },
        { status: 400 }
      );
    }

    let mediaIds: string[] | undefined;
    if (mediaIdsParam) {
      try {
        mediaIds = JSON.parse(mediaIdsParam);
        if (!Array.isArray(mediaIds)) {
          throw new Error("Media IDs must be an array");
        }
      } catch (error) {
        console.error("❌ Invalid media_ids format:", error);
        return NextResponse.json(
          {
            success: false,
            error: "Invalid media_ids format. Must be a JSON array of strings",
          },
          { status: 400 }
        );
      }
    }

    console.log(
      `📋 Restoring status for project ${projectId}`,
      mediaIds ? `with media IDs: ${mediaIds.join(", ")}` : "(all media)"
    );

    // Get metadata from Supabase (legacy table) and index jobs (new table)
    const [legacy, jobs] = await Promise.all([
      getTwelveLabsMetadata(projectId, mediaIds),
      getMediaIndexJobs(projectId, mediaIds ?? undefined),
    ]);

    // Transform the data into a more convenient format, merging by media_id
    const restoredStatus: Record<string, any> = {};

    // Seed from legacy table
    for (const item of legacy) {
      restoredStatus[item.media_id] = {
        mediaId: item.media_id,
        projectId: item.project_id,
        twelveLabsVideoId: item.twelve_labs_video_id ?? item.video_id,
        twelveLabsTaskId: item.twelve_labs_task_id ?? item.task_id,
        status: item.indexing_status ?? item.status,
        progress: item.indexing_progress,
        error: item.error_message,
        metadata: item.metadata,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      };
    }

    // Merge/override from jobs table (prefer freshest info)
    for (const job of jobs) {
      const mappedStatus =
        job.status === "ready"
          ? "completed"
          : job.status === "indexing"
            ? "processing"
            : job.status === "failed"
              ? "failed"
              : "pending";

      const current = restoredStatus[job.media_id] ?? {};
      restoredStatus[job.media_id] = {
        ...current,
        mediaId: job.media_id,
        projectId: job.project_id,
        twelveLabsVideoId: job.video_id ?? current.twelveLabsVideoId,
        twelveLabsTaskId: job.task_id ?? current.twelveLabsTaskId,
        status: mappedStatus,
        progress:
          typeof job.progress === "number" ? job.progress : current.progress,
        error: job.error_message ?? current.error,
        metadata: job.metadata ?? current.metadata,
        updatedAt: current.updatedAt, // keep if present; jobs doesn't store updatedAt in our helper
      };
    }

    const count = Object.keys(restoredStatus).length;
    console.log(`✅ Successfully restored status for ${count} media items`);

    return NextResponse.json({
      success: true,
      restoredStatus,
      count,
      message: "Status restored successfully",
    });
  } catch (error) {
    console.error("❌ Twelvelabs Restore Status API error:", error);
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
