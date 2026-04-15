import { INestApplication, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
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
