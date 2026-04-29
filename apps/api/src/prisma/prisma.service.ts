import { INestApplication, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

type RuntimeDbConfig = {
  url?: string;
  label: string;
  host: string;
};

function safeHostLabel(url?: string) {
  if (!url) {
    return "unconfigured";
  }
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "invalid";
  }
}

function resolveRuntimeDbConfig(): RuntimeDbConfig {
  const explicitRuntimeUrl = process.env.PRISMA_RUNTIME_DATABASE_URL?.trim();
  const explicitMode = (process.env.PRISMA_CONNECTION_MODE ?? "").trim().toLowerCase();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const poolerUrl = process.env.SUPABASE_DB_POOLER_URL?.trim();
  const directUrl = process.env.SUPABASE_DB_DIRECT_URL?.trim();

  if (explicitRuntimeUrl) {
    return {
      url: explicitRuntimeUrl,
      label: "runtime-explicit",
      host: safeHostLabel(explicitRuntimeUrl)
    };
  }

  if (explicitMode === "direct" && directUrl) {
    return {
      url: directUrl,
      label: "direct",
      host: safeHostLabel(directUrl)
    };
  }

  if (explicitMode === "pooler" && poolerUrl) {
    return {
      url: poolerUrl,
      label: "pooler",
      host: safeHostLabel(poolerUrl)
    };
  }

  if (explicitMode === "database" && databaseUrl) {
    return {
      url: databaseUrl,
      label: "database-url",
      host: safeHostLabel(databaseUrl)
    };
  }

  const databaseHost = safeHostLabel(databaseUrl);
  const databasePointsToPooler = databaseHost.includes("pooler.supabase.com");
  if (databasePointsToPooler && directUrl) {
    return {
      url: directUrl,
      label: "direct-fallback-from-pooler",
      host: safeHostLabel(directUrl)
    };
  }

  if (databaseUrl) {
    return {
      url: databaseUrl,
      label: "database-url",
      host: databaseHost
    };
  }

  if (poolerUrl) {
    return {
      url: poolerUrl,
      label: "pooler",
      host: safeHostLabel(poolerUrl)
    };
  }

  if (directUrl) {
    return {
      url: directUrl,
      label: "direct",
      host: safeHostLabel(directUrl)
    };
  }

  return {
    label: "default",
    host: "unconfigured"
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private readonly runtimeDbConfig: RuntimeDbConfig;

  constructor() {
    const runtimeDbConfig = resolveRuntimeDbConfig();
    super(runtimeDbConfig.url ? { datasources: { db: { url: runtimeDbConfig.url } } } : undefined);
    this.runtimeDbConfig = runtimeDbConfig;
  }

  async onModuleInit() {
    this.logger.log(
      `Prisma runtime database target selected: mode=${this.runtimeDbConfig.label}, host=${this.runtimeDbConfig.host}`
    );
    await this.connectWithRetry();
  }

  private async connectWithRetry() {
    const maxAttempts = 30;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log(`Prisma bağlantısı ${attempt}. denemede kuruldu.`);
        }
        return;
      } catch (error) {
        lastError = error;
        const waitMs = Math.min(1000 * attempt, 10000);
        this.logger.warn(
          `Prisma bağlantısı kurulamadı (deneme ${attempt}/${maxAttempts}). ${waitMs}ms sonra tekrar denenecek.`
        );
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    this.logger.error("Prisma bağlantısı max deneme sonrasında kurulamadı.");
    throw lastError;
  }

  async enableShutdownHooks(app: INestApplication) {
    (this as any).$on("beforeExit", async () => {
      await app.close();
    });
  }
}
