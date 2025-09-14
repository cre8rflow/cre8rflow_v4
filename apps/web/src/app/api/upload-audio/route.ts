import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { nanoid } from "nanoid";
import { env } from "@/env";
import { baseRateLimit } from "@/lib/rate-limit";
import { isTranscriptionConfigured } from "@/lib/transcription-utils";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
    const { success } = await baseRateLimit.limit(ip);
    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Ensure required env for R2 + Modal transcription are set
    const check = isTranscriptionConfigured();
    if (!check.configured) {
      return NextResponse.json(
        {
          error: "Transcription not configured",
          message: `Missing env: ${check.missingVars.join(", ")}`,
        },
        { status: 503 }
      );
    }

    // Accept multipart/form-data with the encrypted audio blob
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with 'file'" },
        { status: 400 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const ext = (form.get("ext") as string) || "wav";

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'file' field in form data" },
        { status: 400 }
      );
    }

    // Generate key and target URL (bucket as subdomain style)
    const timestamp = Date.now();
    const key = `audio/${timestamp}-${nanoid()}.${ext}`;
    const url = `https://${env.R2_BUCKET_NAME}.${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    // Upload from server to R2 using SigV4 headers (avoids browser CORS)
    const client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      service: "s3",
      region: "auto",
    });

    const putResp = await client.fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: file.stream(),
    });

    if (!putResp.ok) {
      const text = await putResp.text().catch(() => "");
      return NextResponse.json(
        { error: `R2 upload failed: ${putResp.status} ${text}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, fileName: key });
  } catch (error) {
    console.error("Upload-audio API error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

