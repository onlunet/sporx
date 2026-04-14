import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class OddsSchemaBootstrapService {
  private readonly logger = new Logger(OddsSchemaBootstrapService.name);
  private ensurePromise: Promise<boolean> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async ensureReady() {
    if (!this.ensurePromise) {
      this.ensurePromise = this.bootstrap();
    }
    const ready = await this.ensurePromise;
    if (!ready) {
      this.ensurePromise = null;
    }
    return ready;
  }

  private async bootstrap() {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "MatchOddsMapping" (
          "id" TEXT NOT NULL,
          "providerId" TEXT NOT NULL,
          "matchId" TEXT NOT NULL,
          "providerMatchKey" TEXT NOT NULL,
          "mappingConfidence" DOUBLE PRECISION,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "MatchOddsMapping_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "MatchOddsMapping_providerId_fkey"
            FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
            ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "MatchOddsMapping_matchId_fkey"
            FOREIGN KEY ("matchId") REFERENCES "Match"("id")
            ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "OddsSnapshot" (
          "id" TEXT NOT NULL,
          "matchId" TEXT NOT NULL,
          "providerId" TEXT NOT NULL,
          "bookmaker" TEXT NOT NULL,
          "marketType" TEXT NOT NULL,
          "selectionKey" TEXT NOT NULL,
          "line" DOUBLE PRECISION,
          "oddsValue" DOUBLE PRECISION NOT NULL,
          "impliedProbability" DOUBLE PRECISION NOT NULL,
          "fairProbability" DOUBLE PRECISION,
          "capturedAt" TIMESTAMP(3) NOT NULL,
          "isOpening" BOOLEAN NOT NULL DEFAULT false,
          "isClosingCandidate" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "OddsSnapshot_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "OddsSnapshot_matchId_fkey"
            FOREIGN KEY ("matchId") REFERENCES "Match"("id")
            ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "OddsSnapshot_providerId_fkey"
            FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
            ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "MarketAnalysisSnapshot" (
          "id" TEXT NOT NULL,
          "matchId" TEXT NOT NULL,
          "predictionType" TEXT NOT NULL,
          "marketLine" DOUBLE PRECISION,
          "modelProbability" DOUBLE PRECISION NOT NULL,
          "marketImpliedProbability" DOUBLE PRECISION NOT NULL,
          "fairMarketProbability" DOUBLE PRECISION,
          "probabilityGap" DOUBLE PRECISION NOT NULL,
          "movementDirection" TEXT,
          "volatilityScore" DOUBLE PRECISION,
          "consensusScore" DOUBLE PRECISION,
          "contradictionScore" DOUBLE PRECISION,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "MarketAnalysisSnapshot_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "MarketAnalysisSnapshot_matchId_fkey"
            FOREIGN KEY ("matchId") REFERENCES "Match"("id")
            ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);

      await this.prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "MatchOddsMapping_providerId_providerMatchKey_key" ON "MatchOddsMapping"("providerId","providerMatchKey");`
      );
      await this.prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "MatchOddsMapping_providerId_matchId_key" ON "MatchOddsMapping"("providerId","matchId");`
      );
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "OddsSnapshot_matchId_marketType_line_capturedAt_idx" ON "OddsSnapshot"("matchId","marketType","line","capturedAt");`
      );
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "OddsSnapshot_providerId_capturedAt_idx" ON "OddsSnapshot"("providerId","capturedAt");`
      );
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "OddsSnapshot_marketType_selectionKey_line_idx" ON "OddsSnapshot"("marketType","selectionKey","line");`
      );
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "MarketAnalysisSnapshot_matchId_predictionType_marketLine_createdAt_idx" ON "MarketAnalysisSnapshot"("matchId","predictionType","marketLine","createdAt");`
      );
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "MarketAnalysisSnapshot_predictionType_marketLine_createdAt_idx" ON "MarketAnalysisSnapshot"("predictionType","marketLine","createdAt");`
      );

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown bootstrap error";
      this.logger.error(`Odds schema bootstrap failed: ${message}`);
      return false;
    }
  }
}
