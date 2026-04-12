import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const roleNames = ["super_admin", "admin", "analyst", "viewer", "user"];
  for (const roleName of roleNames) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName }
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "super_admin" } });
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@sporx.local" },
    update: { roleId: adminRole.id },
    create: {
      email: "admin@sporx.local",
      passwordHash,
      roleId: adminRole.id
    }
  });

  const sport = await prisma.sport.upsert({
    where: { code: "football" },
    update: { name: "Football" },
    create: { code: "football", name: "Football" }
  });

  const league = await prisma.league.upsert({
    where: { sportId_name: { sportId: sport.id, name: "Premier League" } },
    update: {},
    create: { sportId: sport.id, name: "Premier League", country: "ENG", dataSource: "seed" }
  });

  const season = await prisma.season.upsert({
    where: { leagueId_yearLabel: { leagueId: league.id, yearLabel: "2025-2026" } },
    update: {},
    create: {
      leagueId: league.id,
      yearLabel: "2025-2026",
      startDate: new Date("2025-08-01T00:00:00.000Z"),
      endDate: new Date("2026-05-31T00:00:00.000Z")
    }
  });

  const home = await prisma.team.upsert({
    where: { name_country: { name: "Arsenal", country: "ENG" } },
    update: {},
    create: { name: "Arsenal", country: "ENG", dataSource: "seed" }
  });

  const away = await prisma.team.upsert({
    where: { name_country: { name: "Chelsea", country: "ENG" } },
    update: {},
    create: { name: "Chelsea", country: "ENG", dataSource: "seed" }
  });

  const kickoff = new Date("2026-04-11T17:30:00.000Z");

  const match = await prisma.match.upsert({
    where: {
      sportId_leagueId_seasonId_matchDateTimeUTC_homeTeamId_awayTeamId: {
        sportId: sport.id,
        leagueId: league.id,
        seasonId: season.id,
        matchDateTimeUTC: kickoff,
        homeTeamId: home.id,
        awayTeamId: away.id
      }
    },
    update: {},
    create: {
      sportId: sport.id,
      leagueId: league.id,
      seasonId: season.id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      matchDateTimeUTC: kickoff,
      status: "scheduled",
      dataSource: "seed"
    }
  });

  await prisma.prediction.upsert({
    where: { matchId: match.id },
    update: {},
    create: {
      matchId: match.id,
      probabilities: { home: 0.48, draw: 0.26, away: 0.26 },
      expectedScore: { home: 1.63, away: 1.11 },
      rawProbabilities: { home: 0.5, draw: 0.24, away: 0.26 },
      calibratedProbabilities: { home: 0.48, draw: 0.26, away: 0.26 },
      rawConfidenceScore: 0.71,
      calibratedConfidenceScore: 0.68,
      confidenceScore: 0.68,
      summary: "Home side has slight edge with stronger recent Elo trend.",
      riskFlags: [{ code: "VOLATILITY", severity: "medium", message: "Derby variance elevated." }],
      isRecommended: true,
      isLowConfidence: false,
      avoidReason: null,
      dataSource: "seed"
    }
  });

  await prisma.provider.upsert({
    where: { key: "football_data" },
    update: { name: "football-data.org", isActive: true },
    create: {
      key: "football_data",
      name: "football-data.org",
      isActive: true
    }
  });

  const systemSettings = [
    {
      key: "ensemble.default",
      value: { mode: "weighted", activeModel: "elo-poisson", weights: { elo_poisson_v1: 0.7, elo_poisson_v1_challenger: 0.3 } },
      description: "Varsayılan ensemble ayarı"
    },
    {
      key: "sync.interval.defaultMinutes",
      value: { value: 60 },
      description: "Varsayılan incremental sync aralığı"
    },
    {
      key: "sync.interval.matchDayMinutes",
      value: { value: 15 },
      description: "Maç günü sync aralığı"
    },
    {
      key: "sync.interval.standingsMinutes",
      value: { value: 360 },
      description: "Puan durumu sync çalışma aralığı"
    },
    {
      key: "sync.interval.aliasMinutes",
      value: { value: 360 },
      description: "Provider alias çözümleme çalışma aralığı"
    },
    {
      key: "sync.interval.teamProfileMinutes",
      value: { value: 240 },
      description: "Takım profil enrichment çalışma aralığı"
    },
    {
      key: "sync.interval.matchDetailMinutes",
      value: { value: 120 },
      description: "Maç detay enrichment çalışma aralığı"
    },
    {
      key: "prediction.lowConfidenceThreshold",
      value: { value: 0.52 },
      description: "Düşük güven eşiği"
    },
    {
      key: "prediction.infoFlagSuppressionThreshold",
      value: { value: 0.7 },
      description: "Yüksek güvende bilgilendirici risk bayraklarını gizleme eşiği"
    },
    {
      key: "risk.lowScoreBias.threshold",
      value: { value: 0.18 },
      description: "LOW_SCORE_BIAS için lowScoreBias eşik değeri"
    },
    {
      key: "risk.lowScoreBias.totalGoalsThreshold",
      value: { value: 1.6 },
      description: "LOW_SCORE_BIAS için toplam gol beklentisi alt eşiği"
    },
    {
      key: "risk.conflict.baseEloGapThreshold",
      value: { value: 45 },
      description: "CONFLICTING_SIGNALS taban Elo fark eşiği"
    },
    {
      key: "risk.conflict.leagueGoalEnvMultiplier",
      value: { value: 20 },
      description: "Lig gol ortamının conflict Elo eşiğine etkisi"
    },
    {
      key: "risk.conflict.volatilityMultiplier",
      value: { value: 25 },
      description: "Volatilite skorunun conflict Elo eşiğine etkisi"
    },
    {
      key: "risk.conflict.outcomeEdgeBase",
      value: { value: 0.11 },
      description: "CONFLICTING_SIGNALS için taban olasılık marj eşiği"
    },
    {
      key: "risk.conflict.outcomeEdgeVolatilityMultiplier",
      value: { value: 0.12 },
      description: "Volatiliteye bağlı olasılık marj artış katsayısı"
    },
    {
      key: "risk.conflict.minCalibratedConfidence",
      value: { value: 0.56 },
      description: "CONFLICTING_SIGNALS için minimum kalibre güven skoru"
    },
    {
      key: "risk.flags.enabled",
      value: { value: true },
      description: "Risk bayrak motoru aktiflik ayarı"
    }
  ];

  for (const setting of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: { key: setting.key, value: setting.value, description: setting.description }
    });
  }

  const primaryModel = await prisma.modelVersion.upsert({
    where: {
      modelName_version: {
        modelName: "elo_poisson",
        version: "v1.0.0"
      }
    },
    update: {
      active: false,
      trainingWindow: "2023-2025",
      parameters: { kFactor: 24, homeAdvantage: 0.18, dixonColesRho: -0.07 }
    },
    create: {
      sportId: sport.id,
      modelName: "elo_poisson",
      version: "v1.0.0",
      trainingWindow: "2023-2025",
      parameters: { kFactor: 24, homeAdvantage: 0.18, dixonColesRho: -0.07 },
      active: false
    }
  });

  const challengerModel = await prisma.modelVersion.upsert({
    where: {
      modelName_version: {
        modelName: "elo_poisson",
        version: "v1.1.0-rc1"
      }
    },
    update: {
      active: false,
      trainingWindow: "2024-2025",
      parameters: { kFactor: 22, homeAdvantage: 0.17, dixonColesRho: -0.06 }
    },
    create: {
      sportId: sport.id,
      modelName: "elo_poisson",
      version: "v1.1.0-rc1",
      trainingWindow: "2024-2025",
      parameters: { kFactor: 22, homeAdvantage: 0.17, dixonColesRho: -0.06 },
      active: false
    }
  });

  const advancedModel = await prisma.modelVersion.upsert({
    where: {
      modelName_version: {
        modelName: "elo_poisson_dc",
        version: "v2.0.0"
      }
    },
    update: {
      active: true,
      trainingWindow: "2022-2025",
      parameters: {
        usesElo: true,
        usesPoisson: true,
        usesDixonColes: true,
        usesDynamicLambda: true,
        usesTimeDecay: true,
        dixonColesRho: -0.06
      }
    },
    create: {
      sportId: sport.id,
      modelName: "elo_poisson_dc",
      version: "v2.0.0",
      trainingWindow: "2022-2025",
      parameters: {
        usesElo: true,
        usesPoisson: true,
        usesDixonColes: true,
        usesDynamicLambda: true,
        usesTimeDecay: true,
        dixonColesRho: -0.06
      },
      active: true
    }
  });

  await prisma.prediction.updateMany({
    where: { matchId: match.id },
    data: {
      modelVersionId: advancedModel.id
    }
  });

  const performanceCount = await prisma.modelPerformanceTimeseries.count();
  if (performanceCount === 0) {
    const base = Date.now();
    const rows = [];
    for (let i = 0; i < 8; i += 1) {
      rows.push({
        modelVersionId: primaryModel.id,
        measuredAt: new Date(base - i * 24 * 60 * 60 * 1000),
        metrics: {
          brier: Number((0.196 + i * 0.002).toFixed(3)),
          logLoss: Number((0.612 + i * 0.004).toFixed(3)),
          accuracy: Number((0.543 - i * 0.003).toFixed(3))
        }
      });
      rows.push({
        modelVersionId: challengerModel.id,
        measuredAt: new Date(base - i * 24 * 60 * 60 * 1000),
        metrics: {
          brier: Number((0.203 + i * 0.002).toFixed(3)),
          logLoss: Number((0.624 + i * 0.004).toFixed(3)),
          accuracy: Number((0.531 - i * 0.002).toFixed(3))
        }
      });
      rows.push({
        modelVersionId: advancedModel.id,
        measuredAt: new Date(base - i * 24 * 60 * 60 * 1000),
        metrics: {
          brier: Number((0.191 + i * 0.002).toFixed(3)),
          logLoss: Number((0.603 + i * 0.004).toFixed(3)),
          accuracy: Number((0.556 - i * 0.002).toFixed(3))
        }
      });
    }

    await prisma.modelPerformanceTimeseries.createMany({
      data: rows
    });
  }

  const featureImportanceCount = await prisma.featureImportanceSnapshot.count();
  if (featureImportanceCount === 0) {
    await prisma.featureImportanceSnapshot.createMany({
      data: [
        {
          modelVersionId: primaryModel.id,
          measuredAt: new Date(),
          values: {
            eloDelta: 0.34,
            form5Delta: 0.19,
            oddsImpliedHome: 0.16,
            defensiveRatingGap: 0.11
          }
        },
        {
          modelVersionId: challengerModel.id,
          measuredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          values: {
            eloDelta: 0.31,
            form5Delta: 0.22,
            oddsImpliedHome: 0.14,
            defensiveRatingGap: 0.13
          }
        },
        {
          modelVersionId: advancedModel.id,
          measuredAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
          values: {
            eloDelta: 0.29,
            form5Delta: 0.24,
            dynamicLambda: 0.21,
            dixonColesCorrection: 0.14,
            scheduleFatigueScore: 0.08
          }
        }
      ]
    });
  }

  const comparisonCount = await prisma.modelComparisonSnapshot.count();
  if (comparisonCount === 0) {
    await prisma.modelComparisonSnapshot.create({
      data: {
        modelVersionId: advancedModel.id,
        comparedWith: [
          { modelName: primaryModel.modelName, version: primaryModel.version, modelVersionId: primaryModel.id },
          { modelName: challengerModel.modelName, version: challengerModel.version, modelVersionId: challengerModel.id }
        ],
        winnerModel: `${advancedModel.modelName}:${advancedModel.version}`,
        details: {
          advancedBrier: 0.191,
          baselineBrier: 0.196,
          challengerBrier: 0.203,
          winRateDelta: 0.019,
          note: "Advanced model selected by lower Brier score and stronger calibration."
        }
      }
    });
  }

  const strategyCount = await prisma.modelStrategy.count();
  if (strategyCount === 0) {
    await prisma.modelStrategy.createMany({
      data: [
        {
          name: "default_weighted",
          config: { strategy: "weighted", blend: { elo_poisson_v1: 0.7, market_prior: 0.3 } },
          isActive: true,
          notes: "V1 production default strategy"
        },
        {
          name: "risk_averse",
          config: { strategy: "threshold", minConfidence: 0.62, skipHighVolatility: true },
          isActive: false,
          notes: "Conservative strategy for volatile fixtures"
        }
      ]
    });
  }

  const calibrationCount = await prisma.predictionCalibration.count();
  if (calibrationCount === 0) {
    await prisma.predictionCalibration.createMany({
      data: {
        modelVersionId: primaryModel.id,
        bucketReport: {
          bins: [
            { range: "0.50-0.55", predicted: 0.53, observed: 0.51 },
            { range: "0.56-0.60", predicted: 0.58, observed: 0.57 }
          ]
        },
        brierScore: 0.196,
        ece: 0.021
      }
    });
  }

  const advancedCalibration = await prisma.predictionCalibration.findFirst({
    where: { modelVersionId: advancedModel.id }
  });
  if (!advancedCalibration) {
    await prisma.predictionCalibration.create({
      data: {
        modelVersionId: advancedModel.id,
        bucketReport: {
          bins: [
            { range: "0.50-0.55", predicted: 0.53, observed: 0.52 },
            { range: "0.56-0.60", predicted: 0.58, observed: 0.58 },
            { range: "0.61-0.70", predicted: 0.65, observed: 0.64 }
          ]
        },
        brierScore: 0.191,
        ece: 0.017
      }
    });
  }

  const backtestCount = await prisma.backtestResult.count();
  if (backtestCount === 0) {
    await prisma.backtestResult.create({
      data: {
        modelVersionId: primaryModel.id,
        rangeStart: new Date("2025-01-01T00:00:00.000Z"),
        rangeEnd: new Date("2025-12-31T23:59:59.000Z"),
        metrics: { roiProxy: 0.084, hitRate: 0.542, sampleSize: 1240 },
        summary: "Stable over baseline with lower variance in top 5 leagues."
      }
    });
  }

  const advancedBacktest = await prisma.backtestResult.findFirst({
    where: { modelVersionId: advancedModel.id }
  });
  if (!advancedBacktest) {
    await prisma.backtestResult.create({
      data: {
        modelVersionId: advancedModel.id,
        rangeStart: new Date("2025-01-01T00:00:00.000Z"),
        rangeEnd: new Date("2025-12-31T23:59:59.000Z"),
        metrics: {
          roiProxy: 0.097,
          hitRate: 0.559,
          logLoss: 0.603,
          brierScore: 0.191,
          sampleSize: 1240
        },
        summary: "Advanced Elo + Dixon-Coles model produced lower Brier/logLoss in the same window."
      }
    });
  }

  const failedPredictionCount = await prisma.failedPredictionAnalysis.count();
  if (failedPredictionCount === 0) {
    const seededPrediction = await prisma.prediction.findUniqueOrThrow({ where: { matchId: match.id } });
    await prisma.failedPredictionAnalysis.create({
      data: {
        predictionId: seededPrediction.id,
        issueCategory: "lineup_shock",
        analysis: {
          rootCause: "Unexpected lineup rotation before kickoff.",
          impact: "home_win_probability_overestimated"
        },
        actionItems: [
          { key: "lineupSensitivity", value: "increase" },
          { key: "lastMinuteNewsWeight", value: 0.2 }
        ]
      }
    });
  }

  const featureLabSetCount = await prisma.featureLabSet.count();
  if (featureLabSetCount === 0) {
    const labSet = await prisma.featureLabSet.create({
      data: {
        name: "Futbol V1 Özellik Seti",
        description: "Elo, form ve odds tabanlı başlangıç seti"
      }
    });

    await prisma.featureLabExperiment.create({
      data: {
        featureLabSetId: labSet.id,
        name: "form-weight-tuning",
        hypothesis: "Form ağırlığını artırmak düşük güven oranını düşürebilir.",
        config: { formWeight: 1.2, lookback: 5 },
        status: "completed",
        result: { deltaBrier: -0.004, deltaECE: -0.002, recommendation: "accept" }
      }
    });
  }

  const ingestionRunCount = await prisma.ingestionJobRun.count();
  if (ingestionRunCount === 0) {
    await prisma.ingestionJobRun.createMany({
      data: [
        {
          jobType: "syncFixtures",
          status: "succeeded",
          startedAt: new Date(Date.now() - 70 * 60 * 1000),
          finishedAt: new Date(Date.now() - 68 * 60 * 1000),
          recordsRead: 340,
          recordsWritten: 330,
          errors: 0
        },
        {
          jobType: "generatePredictions",
          status: "succeeded",
          startedAt: new Date(Date.now() - 40 * 60 * 1000),
          finishedAt: new Date(Date.now() - 38 * 60 * 1000),
          recordsRead: 330,
          recordsWritten: 330,
          errors: 0
        },
        {
          jobType: "providerHealthCheck",
          status: "succeeded",
          startedAt: new Date(Date.now() - 20 * 60 * 1000),
          finishedAt: new Date(Date.now() - 19 * 60 * 1000),
          recordsRead: 4,
          recordsWritten: 3,
          errors: 0
        }
      ]
    });
  }

  const importRunCount = await prisma.historicalImportRun.count();
  if (importRunCount === 0) {
    await prisma.historicalImportRun.create({
      data: {
        sourceName: "Club-Football-Match-Data-2000-2025",
        status: "succeeded",
        startedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
        finishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        recordsRead: 475590,
        recordsMerged: 230557,
        conflicts: 1234,
        summary: { strategy: "merge_enrich", note: "Seed sample import summary" }
      }
    });
  }

  const apiLogCount = await prisma.apiLog.count();
  if (apiLogCount === 0) {
    await prisma.apiLog.createMany({
      data: [
        {
          userId: adminUser.id,
          method: "GET",
          path: "/api/v1/admin/models/comparison",
          statusCode: 200,
          durationMs: 14,
          requestId: "seed-req-1"
        },
        {
          userId: adminUser.id,
          method: "GET",
          path: "/api/v1/admin/system/settings",
          statusCode: 200,
          durationMs: 9,
          requestId: "seed-req-2"
        }
      ]
    });
  }

  const auditLogCount = await prisma.auditLog.count();
  if (auditLogCount === 0) {
    await prisma.auditLog.create({
      data: {
        userId: adminUser.id,
        action: "seed_bootstrap",
        resourceType: "system",
        resourceId: "v1",
        metadata: { source: "prisma-seed", note: "Initial admin seed data inserted." }
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
