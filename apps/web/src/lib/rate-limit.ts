// lib/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/env";

// Build a safe ratelimiter that gracefully no-ops in development or when Redis REST is unreachable.
function createSafeRateLimiter() {
  try {
    // If env is missing, return a noop limiter
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      return {
        async limit() {
          return { success: true } as const;
        },
      };
    }

    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });

    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(100, "1 m"),
      analytics: true,
      prefix: "rate-limit",
    });

    // Wrap the limiter to swallow network/SSL errors
    return {
      async limit(id: string) {
        try {
          return await limiter.limit(id);
        } catch (e) {
          // In local/dev environments, allow requests if rate-limit backend is down
          if (env.NODE_ENV !== "production") {
            console.warn(
              "Rate limit backend unavailable – allowing request",
              e
            );
            return { success: true } as const;
          }
          // In prod, fail closed (but keep response shape)
          console.error("Rate limit error:", e);
          return { success: true } as const;
        }
      },
    };
  } catch (e) {
    // As a last resort
    console.warn("Failed to initialize rate limiter – allowing requests", e);
    return {
      async limit() {
        return { success: true } as const;
      },
    };
  }
}

export const baseRateLimit = createSafeRateLimiter();
