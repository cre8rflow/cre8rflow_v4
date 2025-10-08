import { NextRequest, NextResponse } from "next/server";
import { twelveLabsService } from "@/lib/twelvelabs-service";
import { saveTwelveLabsMetadata, upsertMediaIndexJob } from "@/lib/supabase";

/**
 * Twelvelabs Upload API Route
 * POST: Upload a video for indexing
 */
export async function POST(request: NextRequest) {
  try {
    console.log("🎯 Twelvelabs Upload API - Starting request");

    const contentType = request.headers.get("content-type") || "";
    let videoUrl: string | undefined;
    let videoFile: File | undefined;
    let language = "en";
    // Optional identifiers to allow server-side persistence
    let projectId: string | undefined;
    let mediaId: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      // Handle FormData (file upload)
      const formData = await request.formData();
      videoFile = formData.get("videoFile") as File;
      language = (formData.get("language") as string) || "en";
      projectId = (formData.get("projectId") as string) || undefined;
      mediaId = (formData.get("mediaId") as string) || undefined;

      if (!videoFile) {
        console.error("❌ Video file is required");
        return NextResponse.json(
          {
            success: false,
            error: "Video file is required",
          },
          { status: 400 }
        );
      }
    } else {
      // Handle JSON (URL upload)
      const body = await request.json();
      videoUrl = body.videoUrl;
      language = body.language || "en";
      projectId = body.projectId;
      mediaId = body.mediaId;

      if (!videoUrl) {
        console.error("❌ Video URL is required");
        return NextResponse.json(
          {
            success: false,
            error: "Video URL is required",
          },
          { status: 400 }
        );
      }
    }

    // For now, we'll use a default user ID since authentication is not fully set up
    // In production, you would extract this from the authenticated session
    const userId = "default-user"; // TODO: Replace with actual user ID from session

    let result;

    if (videoFile) {
      console.log(
        `📤 Uploading video file for user ${userId}: ${videoFile.name}`
      );
      // Use the service to upload the file
      result = await twelveLabsService.uploadVideoFile(
        userId,
        videoFile,
        language
      );
    } else if (videoUrl) {
      console.log(`📤 Uploading video URL for user ${userId}: ${videoUrl}`);
      // Use the service to upload the URL
      result = await twelveLabsService.uploadVideo(userId, videoUrl, language);
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "Either video file or video URL is required",
        },
        { status: 400 }
      );
    }

    if (!result.success) {
      console.error("❌ Failed to upload video:", result.error);
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 500 }
      );
    }

    console.log("✅ Successfully uploaded video, task created:", result.task);

    // Persist initial metadata if identifiers are provided (even if task details are not yet available)
    try {
      if (projectId && mediaId) {
        await upsertMediaIndexJob({
          project_id: projectId,
          media_id: mediaId,
          status: "pending",
          progress: result.task?.progress ?? 0,
          task_id: result.task?._id,
          video_id: result.task?.video_id,
          metadata: result.task ? { task: result.task } : undefined,
        });
        await saveTwelveLabsMetadata({
          media_id: mediaId,
          project_id: projectId,
          // V4 fields
          twelve_labs_task_id: result.task?._id,
          twelve_labs_video_id: result.task?.video_id,
          indexing_status: "pending",
          indexing_progress: result.task?.progress ?? 0,
          // V3 fields
          task_id: result.task?._id,
          video_id: result.task?.video_id,
          status: "pending",
          metadata: result.task ? { task: result.task } : undefined,
        });
        console.log("💾 Initial Twelvelabs metadata upserted");
      }
    } catch (persistError) {
      console.error(
        "❌ Failed to persist initial Twelvelabs metadata:",
        persistError
      );
      // Non-fatal
    }

    return NextResponse.json({
      success: true,
      task: result.task,
      taskId: result.task?._id,
      message: "Video upload initiated successfully",
    });
  } catch (error) {
    console.error("❌ Twelvelabs Upload API error:", error);
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
