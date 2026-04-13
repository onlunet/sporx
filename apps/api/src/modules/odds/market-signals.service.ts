import { Injectable } from "@nestjs/common";
import { MarketAnalysisResult, MarketOddsSummary } from "./odds-types";

type ApiRiskFlag = {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
};

@Injectable()
export class MarketSignalsService {
  buildRiskFlags(summary: MarketOddsSummary, analysis: MarketAnalysisResult): ApiRiskFlag[] {
    const flags: ApiRiskFlag[] = [];

    if (summary.coverage < 2) {
      flags.push({
        code: "LOW_ODDS_COVERAGE",
        severity: "medium",
        message: "Oran kapsaması düşük, piyasa karşılaştırması sınırlı."
      });
    }

    if (summary.freshnessScore < 0.35) {
      flags.push({
        code: "STALE_ODDS",
        severity: "medium",
        message: "Oran verisi güncel değil, taze market sinyali zayıf."
      });
    }

    if (summary.bookmakerDisagreementScore > 0.06) {
      flags.push({
        code: "HIGH_BOOKMAKER_SPREAD",
        severity: "medium",
        message: "Bookmaker dağılımı yüksek, piyasa uzlaşısı zayıf."
      });
    }

    if (summary.volatilityScore > 0.07 || Math.abs(summary.movementSpeed) > 0.09) {
      flags.push({
        code: "SHARP_MOVEMENT",
        severity: "high",
        message: "Oran hareketi keskin, piyasa sinyali oynak."
      });
    }

    if (Math.abs(analysis.probabilityGap) > 0.12) {
      flags.push({
        code: "MARKET_DISAGREEMENT",
        severity: "high",
        message: "Model ile piyasa arasında belirgin ayrışma var."
      });
    }

    if (analysis.contradictionScore > 0.18) {
      flags.push({
        code: "UNSTABLE_MARKET_SIGNAL",
        severity: "medium",
        message: "Piyasa sinyali tutarsız, kontradiksiyon skoru yüksek."
      });
    }

    return flags;
  }

  agreementLevel(probabilityGap: number) {
    const gap = Math.abs(probabilityGap);
    if (gap <= 0.04) {
      return "high";
    }
    if (gap <= 0.09) {
      return "medium";
    }
    return "low";
  }
}
