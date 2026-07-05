import { headers } from "next/headers";

const MAX_GENERATIONS_PER_IP = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const generationLimits = new Map<string, RateLimitEntry>();

function getClientIp(headerList: Headers) {
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    headerList.get("x-real-ip") ??
    headerList.get("cf-connecting-ip") ??
    "unknown"
  );
}

export async function checkGenerationLimit() {
  const headerList = await headers();
  const ip = getClientIp(headerList);
  const now = Date.now();
  const current = generationLimits.get(ip);

  if (!current || current.resetAt <= now) {
    generationLimits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false, remaining: MAX_GENERATIONS_PER_IP - 1 };
  }

  if (current.count >= MAX_GENERATIONS_PER_IP) {
    return {
      limited: true,
      remaining: 0,
      resetAt: current.resetAt,
    };
  }

  current.count += 1;
  return {
    limited: false,
    remaining: MAX_GENERATIONS_PER_IP - current.count,
    resetAt: current.resetAt,
  };
}

