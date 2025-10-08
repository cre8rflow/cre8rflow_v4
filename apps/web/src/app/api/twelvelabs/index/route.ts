import { NextRequest, NextResponse } from "next/server";
import { twelveLabsService } from "@/lib/twelvelabs-service";

/**
 * Twelvelabs Index API Route
 * GET: Get or create an index for the current user
 */
export async function GET(request: NextRequest) {
  try {
    console.log("🎯 Twelvelabs Index API - Starting request");

    // For now, we'll use a default user ID since authentication is not fully set up
    // In production, you would extract this from the authenticated session
    const userId = "default-user"; // TODO: Replace with actual user ID from session

    console.log(`📋 Getting index for user: ${userId}`);

    // Use the service to get or create user index
    const result = await twelveLabsService.getUserIndex(userId);

    if (!result.success) {
      console.error("❌ Failed to get/create user index:", result.error);
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 500 }
      );
    }

    console.log("✅ Successfully retrieved/created index:", result.index);

    return NextResponse.json({
      success: true,
      index: result.index,
      message: "Index retrieved successfully",
    });
  } catch (error) {
    console.error("❌ Twelvelabs Index API error:", error);
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
