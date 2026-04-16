import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { ApiResponseInterceptor } from "./common/interceptors/api-response.interceptor";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { CacheService } from "./cache/cache.service";
import { createRateLimitMiddleware } from "./common/middleware/rate-limit.middleware";
import { IngestionQueueService } from "./modules/ingestion/ingestion-queue.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3100")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

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
  app.use(createRateLimitMiddleware(cacheService));

  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

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
