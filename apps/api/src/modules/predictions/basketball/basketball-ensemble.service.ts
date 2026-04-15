import { Injectable } from "@nestjs/common";
import {
  BasketballBlendedProjection,
  BasketballCoreProjection,
  BasketballFeatureSnapshot,
  BasketballMarketSnapshot
} from "./basketball-feature.types";

@Injectable()
export class BasketballEnsembleService {
  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private normalize(probabilities: { home: number; draw: number; away: number }) {
    const safe = {
      home: this.clamp(probabilities.home, 0, 1),
      draw: this.clamp(probabilities.draw, 0, 1),
      away: this.clamp(probabilities.away, 0, 1)
    };
    const sum = safe.home + safe.draw + safe.away || 1;
    return {
      home: Number((safe.home / sum).toFixed(4)),
      draw: Number((safe.draw / sum).toFixed(4)),
      away: Number((safe.away / sum).toFixed(4))
    };
  }

  blend(
    core: BasketballCoreProjection,
    market: BasketballMarketSnapshot,
    features: BasketballFeatureSnapshot
  ): BasketballBlendedProjection {
    const riskFlags: BasketballBlendedProjection["riskFlags"] = [];
    const baseCoreWeight = Number(process.env.BASKETBALL_CORE_MODEL_WEIGHT ?? "0.86");
    const baseMarketWeight = Number(process.env.BASKETBALL_MARKET_WEIGHT ?? "0.14");
    const coverageBoost = market.coverageScore * 0.06;
    const effectiveMarketWeight = market.hasMarketData
      ? this.clamp(baseMarketWeight + coverageBoost, 0.08, 0.24)
      : 0;
    const effectiveCoreWeight = 1 - effectiveMarketWeight;

    const marketHome = market.moneyline.home;
    const marketAway = market.moneyline.away;
    const marketDraw = market.moneyline.draw;

    const blendedOutcome =
      typeof marketHome === "number" && typeof marketAway === "number"
        ? this.normalize({
            home: core.outcomeProbabilities.home * effectiveCoreWeight + marketHome * effectiveMarketWeight,
            draw:
              core.outcomeProbabilities.draw * effectiveCoreWeight +
              (typeof marketDraw === "number" ? marketDraw : 0.004) * effectiveMarketWeight,
            away: core.outcomeProbabilities.away * effectiveCoreWeight + marketAway * effectiveMarketWeight
          })
        : core.outcomeProbabilities;

    if (!market.hasMarketData || market.coverageScore < 0.15) {
      riskFlags.push({
        code: "LOW_ODDS_COVERAGE",
        severity: "medium",
        message: "Market coverage dusuk. Model market sinyalini sinirli kullandi."
      });
    }

    if (market.freshnessMinutes !== null && market.freshnessMinutes > 210) {
      riskFlags.push({
        code: "STALE_ODDS",
        severity: "medium",
        message: "Piyasa verisi guncel degil. Son hareketler modele tam yansimamis olabilir."
      });
    }

    const disagreement = Math.abs(core.outcomeProbabilities.home - blendedOutcome.home);
    const agreementLevel: BasketballBlendedProjection["marketAgreementLevel"] =
      disagreement <= 0.04 ? "aligned" : disagreement <= 0.1 ? "mixed" : "divergent";

    if (agreementLevel === "divergent") {
      riskFlags.push({
        code: "MARKET_DISAGREEMENT",
        severity: "high",
        message: "Model ve piyasa yonu belirgin sekilde ayrisiyor."
      });
    }

    if (features.sampleQualityScore < 0.45) {
      riskFlags.push({
        code: "SMALL_SAMPLE",
        severity: "medium",
        message: "Takim form orneklemi sinirli. Tahmin oynakligi artabilir."
      });
    }

    const totalLineProbabilities = core.totalLineProbabilities.map((coreLine) => {
      const marketLine = market.totals.find((item) => item.line === coreLine.line);
      if (!marketLine) {
        return coreLine;
      }
      const over = this.clamp(
        coreLine.over * effectiveCoreWeight + marketLine.over * effectiveMarketWeight,
        0.02,
        0.98
      );
      return {
        line: coreLine.line,
        over: Number(over.toFixed(4)),
        under: Number((1 - over).toFixed(4))
      };
    });

    return {
      outcomeProbabilities: blendedOutcome,
      firstHalfProbabilities: core.firstHalfProbabilities,
      totalLineProbabilities,
      marketAgreementLevel: agreementLevel,
      riskFlags
    };
  }
}
