import { NextResponse } from "next/server";
import { env } from "@/env";

/**
 * Health check endpoint for V3 integration
 * Tests environment variable access and basic connectivity
 */
export async function GET() {
  try {
    // Test environment variable access
    const hasSupabase = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
    const hasTwelvelabs = !!env.TWELVELABS_API_KEY;
    
    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      v3Integration: {
        supabaseConfigured: hasSupabase,
        twelvelabsConfigured: hasTwelvelabs,
        environmentVariablesLoaded: true,
      }
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}