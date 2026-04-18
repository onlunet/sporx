import { NextFunction, Request, Response } from "express";
import { CacheService } from "../../cache/cache.service";

type RateLimitExceededPayload = {
  ruleId: string;
  limit: number;
  hits: number;
  remainingSeconds: number;
  blocked: boolean;
  ipAddress: string;
  method: string;
  path: string;
  requestId: string | null;
  correlationId: string | null;
  userAgent: string | null;
};

type RateLimitMiddlewareOptions = {
  onRateLimitExceeded?: (payload: RateLimitExceededPayload) => Promise<void> | void;
  onRateLimitObserved?: (payload: RateLimitExceededPayload) => Promise<void> | void;
};

type RateLimitRule = {
  id: string;
  limit: number;
  windowSeconds: number;
  matches: (req: Request) => boolean;
};

const rateLimitRules: RateLimitRule[] = [
  {
    id: "auth-login",
    limit: Number(process.env.RATE_LIMIT_AUTH_LOGIN_LIMIT ?? 10),
    windowSeconds: Number(process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS ?? 60),
    matches: (req) => req.path.endsWith("/auth/login")
  },
  {
    id: "auth-refresh",
    limit: Number(process.env.RATE_LIMIT_AUTH_REFRESH_LIMIT ?? 30),
    windowSeconds: Number(process.env.RATE_LIMIT_AUTH_REFRESH_WINDOW_SECONDS ?? 60),
    matches: (req) => req.path.endsWith("/auth/refresh")
  },
  {
    id: "admin-write",
    limit: Number(process.env.RATE_LIMIT_ADMIN_WRITE_LIMIT ?? 60),
    windowSeconds: Number(process.env.RATE_LIMIT_ADMIN_WRITE_WINDOW_SECONDS ?? 60),
    matches: (req) => req.path.includes("/admin") && !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())
  },
  {
    id: "api-default",
    limit: Number(process.env.RATE_LIMIT_DEFAULT_LIMIT ?? 300),
    windowSeconds: Number(process.env.RATE_LIMIT_DEFAULT_WINDOW_SECONDS ?? 60),
    matches: () => true
  }
];

function resolveClientIp(req: Request) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return forwardedFor[0]?.trim() ?? "unknown";
  }

  return req.ip ?? "unknown";
}

export function createRateLimitMiddleware(cacheService: CacheService, options?: RateLimitMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }

    const rule = rateLimitRules.find((candidate) => candidate.matches(req)) ?? rateLimitRules[rateLimitRules.length - 1];
    const ip = resolveClientIp(req);
    const key = `${rule.id}:${ip}`;

    try {
      const { hits, remainingSeconds } = await cacheService.incrementRateLimit(key, rule.windowSeconds);
      const remaining = Math.max(rule.limit - hits, 0);

      res.setHeader("X-RateLimit-Limit", String(rule.limit));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader("X-RateLimit-Reset", String(remainingSeconds));

      const requestIdHeader = req.headers["x-request-id"];
      const correlationHeader = req.headers["x-correlation-id"];
      const telemetryPayload: RateLimitExceededPayload = {
        ruleId: rule.id,
        limit: rule.limit,
        hits,
        remainingSeconds,
        blocked: hits > rule.limit,
        ipAddress: ip,
        method: req.method,
        path: req.path,
        requestId: Array.isArray(requestIdHeader)
          ? requestIdHeader[0] ?? null
          : typeof requestIdHeader === "string"
            ? requestIdHeader
            : null,
        correlationId: Array.isArray(correlationHeader)
          ? correlationHeader[0] ?? null
          : typeof correlationHeader === "string"
            ? correlationHeader
            : null,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null
      };
      try {
        await options?.onRateLimitObserved?.(telemetryPayload);
      } catch {
        // telemetry failures should not block request flow
      }

      if (hits > rule.limit) {
        try {
          await options?.onRateLimitExceeded?.(telemetryPayload);
        } catch {
          // rate-limit telemetry should not block response
        }

        res.status(429).json({
          success: false,
          data: null,
          meta: {
            retryAfterSeconds: remainingSeconds
          },
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please retry later."
          }
        });
        return;
      }

      next();
    } catch {
      next();
    }
  };
}
