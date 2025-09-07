import { NextResponse } from "next/server";
import { env } from "@/env";
import { supabaseSelectOne } from "@/lib/supabase";

/**
 * Health check endpoint for V3 integration
 * Tests environment variable access and Supabase connectivity
 */
export async function GET() {
  const checks: any = {
    environmentVariablesLoaded: true,
    supabaseConfigured: false,
    supabaseConnectivity: false,
    twelvelabsConfigured: false,
  };

  try {
    // Test environment variable access
    const hasSupabase = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
    const hasTwelvelabs = !!env.TWELVELABS_API_KEY;
    
    checks.supabaseConfigured = hasSupabase;
    checks.twelvelabsConfigured = hasTwelvelabs;

    // Test Supabase connectivity if configured
    if (hasSupabase) {
      try {
        // Try to query the media_twelvelabs table to test connectivity
        // This will fail gracefully if the table doesn't exist yet
        await supabaseSelectOne('media_twelvelabs', { project_id: 'health-check-test' });
        checks.supabaseConnectivity = true;
        checks.supabaseMessage = "Connected successfully";
      } catch (supabaseError) {
        checks.supabaseConnectivity = false;
        checks.supabaseMessage = supabaseError instanceof Error ? supabaseError.message : "Connection failed";
        
        // If it's just a table not found error, that's actually OK for setup
        if (checks.supabaseMessage.includes('relation "media_twelvelabs" does not exist')) {
          checks.supabaseMessage = "Connected, but media_twelvelabs table not created yet. Please run the SQL schema.";
          checks.supabaseConnectivity = "table_missing";
        }
      }
    }

    const overallStatus = hasSupabase && (checks.supabaseConnectivity === true || checks.supabaseConnectivity === "table_missing") 
      ? "healthy" 
      : "partial";
    
    return NextResponse.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      v3Integration: checks,
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
        v3Integration: checks,
      },
      { status: 500 }
    );
  }
}