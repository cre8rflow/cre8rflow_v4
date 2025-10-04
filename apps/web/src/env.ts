import { vercel } from "@t3-oss/env-core/presets-zod";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { keys as auth } from "@opencut/auth/keys";
import { keys as db } from "@opencut/db/keys";

export const env = createEnv({
  extends: [vercel(), auth(), db()],
  server: {
    ANALYZE: z.string().optional(),
    // Added by Vercel
    NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    FREESOUND_CLIENT_ID: z.string().optional(),
    FREESOUND_API_KEY: z.string().optional(),
    // R2 / Cloudflare
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().optional(),
    // Modal transcription
    MODAL_TRANSCRIPTION_URL: z.string().optional(),
    // Supabase (for V3 integration - persistent storage)
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_KEY: z.string().optional(),
    // Twelvelabs (for V3 integration - AI video analysis)
    TWELVELABS_API_KEY: z.string().optional(),
    // OpenAI planner (agent orchestration)
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_RESP_FORMAT: z.enum(["json_object", "json_schema"]).optional(),
    // Planner behavior
    AGENT_PLANNER_FALLBACK: z
      .enum(["true", "false"])
      .optional()
      .default("true"),
    // Agent thinking/reasoning display
    AGENT_THOUGHT_STRICT: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    AGENT_THINKING_TIMEOUT_MS: z.coerce.number().optional().default(3000),
  },
  client: {},
  runtimeEnv: {
    ANALYZE: process.env.ANALYZE,
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    NODE_ENV: process.env.NODE_ENV,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    FREESOUND_CLIENT_ID: process.env.FREESOUND_CLIENT_ID,
    FREESOUND_API_KEY: process.env.FREESOUND_API_KEY,
    // R2 / Cloudflare
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    // Modal transcription
    MODAL_TRANSCRIPTION_URL: process.env.MODAL_TRANSCRIPTION_URL,
    // Supabase (for V3 integration - persistent storage)
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    // Twelvelabs (for V3 integration - AI video analysis)
    TWELVELABS_API_KEY: process.env.TWELVELABS_API_KEY,
    // OpenAI planner (agent orchestration)
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_RESP_FORMAT: process.env.OPENAI_RESP_FORMAT,
    AGENT_PLANNER_FALLBACK: process.env.AGENT_PLANNER_FALLBACK,
    AGENT_THOUGHT_STRICT: process.env.AGENT_THOUGHT_STRICT,
    AGENT_THINKING_TIMEOUT_MS: process.env.AGENT_THINKING_TIMEOUT_MS,
  },
});
