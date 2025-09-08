import { NextRequest, NextResponse } from "next/server";
import { twelveLabsService } from "@/lib/twelvelabs-service";

/**
 * Twelvelabs Analyze API Route
 * POST: Analyze a video or search videos in an index
 */
export async function POST(request: NextRequest) {
  try {
    console.log("🎯 Twelvelabs Analyze API - Starting request");

    const body = await request.json();
    const { action, videoUrl, query, language = "en", searchOptions } = body;

    // For now, we'll use a default user ID since authentication is not fully set up
    // In production, you would extract this from the authenticated session
    const userId = "default-user"; // TODO: Replace with actual user ID from session

    if (action === "analyze") {
      if (!videoUrl) {
        console.error("❌ Video URL is required for analysis");
        return NextResponse.json(
          {
            success: false,
            error: "Video URL is required for analysis",
          },
          { status: 400 }
        );
      }

      console.log(`🔍 Analyzing video for user ${userId}: ${videoUrl}`);

      // Use the service to analyze the video
      const result = await twelveLabsService.analyzeVideo(
        userId,
        videoUrl,
        language
      );

      if (!result.success) {
        console.error("❌ Failed to analyze video:", result.error);
        return NextResponse.json(
          {
            success: false,
            error: result.error,
          },
          { status: 500 }
        );
      }

      console.log("✅ Successfully started video analysis:", result.task);

      return NextResponse.json({
        success: true,
        task: result.task,
        taskId: result.task?._id,
        message: "Video analysis initiated successfully",
      });
    } else if (action === "search") {
      if (!query) {
        console.error("❌ Query is required for search");
        return NextResponse.json(
          {
            success: false,
            error: "Query is required for search",
          },
          { status: 400 }
        );
      }

      console.log(`🔍 Searching videos for user ${userId}: "${query}"`);

      // Use the service to search videos
      const result = await twelveLabsService.searchVideos(
        userId,
        query,
        searchOptions
      );

      if (!result.success) {
        console.error("❌ Failed to search videos:", result.error);
        return NextResponse.json(
          {
            success: false,
            error: result.error,
          },
          { status: 500 }
        );
      }

      console.log("✅ Successfully searched videos:", result.results);

      return NextResponse.json({
        success: true,
        results: result.results,
        message: "Video search completed successfully",
      });
    } else {
      console.error("❌ Invalid action specified");
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid action. Must be "analyze" or "search"',
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("❌ Twelvelabs Analyze API error:", error);
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
