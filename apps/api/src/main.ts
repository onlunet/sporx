import { NestFactory } from "@nestjs/core";
import { ForbiddenException, ValidationPipe } from "@nestjs/common";
import { AccessActorType, AbuseEventType, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { json, urlencoded } from "express";
import { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { ApiResponseInterceptor } from "./common/interceptors/api-response.interceptor";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { CacheService } from "./cache/cache.service";
import { createRateLimitMiddleware } from "./common/middleware/rate-limit.middleware";
import { IngestionQueueService } from "./modules/ingestion/ingestion-queue.service";
import { SecurityEventService } from "./modules/security-events/security-event.service";
import { AdminSecurityBoundaryService } from "./modules/security-hardening/admin-security-boundary.service";
import { APISecurityService } from "./modules/security-hardening/api-security.service";
import { RuntimeHardeningService } from "./modules/security-hardening/runtime-hardening.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const apiSecurityService = app.get(APISecurityService);
  const runtimeHardeningService = app.get(RuntimeHardeningService);
  const adminSecurityBoundaryService = app.get(AdminSecurityBoundaryService);
  const corsOrigins = apiSecurityService.resolveAllowedCorsOrigins();
  const corsPolicy = apiSecurityService.validateCorsPolicyForEnvironment();
  if (!corsPolicy.ok && apiSecurityService.isStrictCorsEnabled()) {
    throw new Error(`CORS policy rejected by hardening rules: ${corsPolicy.issues.join("; ")}`);
  }

  app.use(json({ limit: apiSecurityService.resolveBodyLimitAsString() }));
  app.use(urlencoded({ extended: true, limit: apiSecurityService.resolveBodyLimitAsString() }));

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      apiSecurityService.assignRequestCorrelation(req, res);
      apiSecurityService.applySecurityHeaders(res);
      if (apiSecurityService.isSuspiciousPath(req.path)) {
        await apiSecurityService.emitSuspiciousRequestEvent(req, "suspicious_path_pattern");
      }
      if (apiSecurityService.shouldRejectMissingCsrf(req)) {
        throw new ForbiddenException("Access denied");
      }
      await adminSecurityBoundaryService.assertAdminBoundary(req);
      next();
    } catch (error) {
      next(error);
    }
  });

  const trustProxyEnabled = (process.env.TRUST_PROXY ?? "true").toLowerCase() === "true";
  if (trustProxyEnabled) {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }

  app.enableCors({
    credentials: true,
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    }
  });

  const cacheService = app.get(CacheService);
  const securityEventService = app.get(SecurityEventService);
  app.use(
    createRateLimitMiddleware(cacheService, {
      onRateLimitObserved: async (payload) => {
        await apiSecurityService.recordRateLimitBucket(payload);
      },
      onRateLimitExceeded: async (payload) => {
        await securityEventService.emitAbuseEvent({
          eventKey: `abuse:rate_limit:${payload.ruleId}:${payload.ipAddress}:${Math.floor(Date.now() / (payload.remainingSeconds > 0 ? payload.remainingSeconds * 1000 : 60_000))}`,
          eventType: AbuseEventType.RATE_LIMIT_EXCEEDED,
          sourceDomain: SecurityEventSourceDomain.RUNTIME,
          severity: SecurityEventSeverity.MEDIUM,
          actorType: AccessActorType.USER,
          method: payload.method,
          path: payload.path,
          reason: "rate_limit_exceeded",
          count: payload.hits,
          windowSeconds: payload.remainingSeconds,
          context: {
            ipAddress: payload.ipAddress,
            requestId: payload.requestId,
            correlationId: payload.correlationId,
            userAgent: payload.userAgent
          },
          metadata: {
            ruleId: payload.ruleId,
            limit: payload.limit,
            blocked: payload.blocked
          }
        });
      }
    })
  );

  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: apiSecurityService.isStrictApiValidationEnabled(),
      forbidNonWhitelisted: apiSecurityService.isStrictApiValidationEnabled()
    })
  );
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await runtimeHardeningService.assertStartupHardeningOrThrow();

  const enableEmbeddedWorker = (process.env.ENABLE_EMBEDDED_INGESTION_WORKER ?? "false").toLowerCase() === "true";
  if (enableEmbeddedWorker) {
    try {
      const ingestionQueue = app.get(IngestionQueueService);
      await ingestionQueue.startWorker();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown ingestion worker startup error";
      console.error(`[api] embedded ingestion worker start failed: ${message}`);
    }
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
}

bootstrap();
