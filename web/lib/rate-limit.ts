import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Rate limiting is IP-based since there are no accounts (SECURITY.md §2).
// Gracefully disabled if Upstash isn't configured, so local dev isn't
// blocked before you've set up a Redis instance.
const hasUpstashConfig = !!(process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN);

let ratelimit: Ratelimit | null = null;
if (hasUpstashConfig) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
  });
  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "10 s"),
    analytics: false,
  });
} else {
  console.warn("[rate-limit] UPSTASH_REDIS_URL/TOKEN not set - rate limiting disabled (local dev only)");
}

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  if (!ratelimit) return { allowed: true };

  const { success, reset } = await ratelimit.limit(ip);
  if (success) return { allowed: true };

  const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { allowed: false, retryAfterSeconds };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}