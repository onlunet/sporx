import { Injectable } from "@nestjs/common";
import { Prisma, ResearchRunStatus, StrategyObjective } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { stableHash } from "./research-lab.hash";
import { RunComparisonRow } from "./research-lab.types";

type CreateRunInput = {
  projectId: string;
  experimentId: string;
  strategyConfigSetId?: string | null;
  strategyConfigVersionId?: string | null;
  searchSpaceId?: string | null;
  rangeStart: Date;
  rangeEnd: Date;
  sport: string;
  leagueScope?: Record<string, unknown> | null;
  marketScope?: Record<string, unknown> | null;
  horizonScope?: Record<string, unknown> | null;
  objectiveMetric: string;
  secondaryMetrics?: string[];
  seed: number;
  datasetHashes: Record<string, unknown>;
  featureSetVersion?: string | null;
  modelRefs?: Record<string, unknown> | null;
  policyRefs?: Record<string, unknown> | null;
  bankrollProfile?: string | null;
  notes?: string | null;
  tags?: string[];
};

@Injectable()
export class ExperimentTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(input: { key: string; name: string; description?: string | null; sport?: string }) {
    return this.prisma.researchProject.upsert({
      where: { key: input.key.trim() },
      update: {
        name: input.name.trim(),
        description: input.description ?? null,
        sportCode: (input.sport ?? "football").trim().toLowerCase(),
        active: true
      },
      create: {
        key: input.key.trim(),
        name: input.name.trim(),
        description: input.description ?? null,
        sportCode: (input.sport ?? "football").trim().toLowerCase(),
        active: true
      }
    });
  }

  async createExperiment(input: {
    projectId: string;
    key: string;
    name: string;
    description?: string | null;
    objective?: StrategyObjective;
    objectiveDefinition?: Record<string, unknown>;
    seed?: number | null;
    sport?: string;
    notes?: string | null;
  }) {
    return this.prisma.researchExperiment.upsert({
      where: {
        projectId_key: {
          projectId: input.projectId,
          key: input.key.trim()
        }
      },
      update: {
        name: input.name.trim(),
        description: input.description ?? null,
        objective: input.objective ?? StrategyObjective.COMPOSITE,
        objectiveDefinitionJson: (input.objectiveDefinition ?? {
          primary: StrategyObjective.ROI,
          secondary: ["logLoss", "brierScore"]
        }) as Prisma.InputJsonValue,
        seed: input.seed ?? null,
        sportCode: (input.sport ?? "football").trim().toLowerCase(),
        notes: input.notes ?? null
      },
      create: {
        projectId: input.projectId,
        key: input.key.trim(),
        name: input.name.trim(),
        description: input.description ?? null,
        objective: input.objective ?? StrategyObjective.COMPOSITE,
        objectiveDefinitionJson: (input.objectiveDefinition ?? {
          primary: StrategyObjective.ROI,
          secondary: ["logLoss", "brierScore"]
        }) as Prisma.InputJsonValue,
        seed: input.seed ?? null,
        sportCode: (input.sport ?? "football").trim().toLowerCase(),
        notes: input.notes ?? null
      }
    });
  }

  buildRunKey(input: Omit<CreateRunInput, "notes" | "tags" | "secondaryMetrics">) {
    return stableHash({
      projectId: input.projectId,
      experimentId: input.experimentId,
      strategyConfigSetId: input.strategyConfigSetId ?? null,
      strategyConfigVersionId: input.strategyConfigVersionId ?? null,
      searchSpaceId: input.searchSpaceId ?? null,
      rangeStart: input.rangeStart.toISOString(),
      rangeEnd: input.rangeEnd.toISOString(),
      sport: input.sport.trim().toLowerCase(),
      objectiveMetric: input.objectiveMetric,
      seed: input.seed,
      datasetHashes: input.datasetHashes
    });
  }

  async createOrUpdateRun(input: CreateRunInput) {
    const runKey = this.buildRunKey(input);
    return this.prisma.researchRun.upsert({
      where: { runKey },
      update: {
        strategyConfigSetId: input.strategyConfigSetId ?? null,
        strategyConfigVersionId: input.strategyConfigVersionId ?? null,
        searchSpaceId: input.searchSpaceId ?? null,
        status: ResearchRunStatus.running,
        dataWindowStart: input.rangeStart,
        dataWindowEnd: input.rangeEnd,
        sportCode: input.sport.trim().toLowerCase(),
        leagueScopeJson: (input.leagueScope ?? null) as Prisma.InputJsonValue,
        marketScopeJson: (input.marketScope ?? null) as Prisma.InputJsonValue,
        horizonScopeJson: (input.horizonScope ?? null) as Prisma.InputJsonValue,
        objectiveMetric: input.objectiveMetric,
        secondaryMetricsJson: (input.secondaryMetrics ?? []) as Prisma.InputJsonValue,
        seed: input.seed,
        datasetHashesJson: input.datasetHashes as Prisma.InputJsonValue,
        featureSetVersion: input.featureSetVersion ?? null,
        modelRefsJson: (input.modelRefs ?? null) as Prisma.InputJsonValue,
        policyRefsJson: (input.policyRefs ?? null) as Prisma.InputJsonValue,
        bankrollProfile: input.bankrollProfile ?? null,
        notes: input.notes ?? null,
        tagsJson: (input.tags ?? []) as Prisma.InputJsonValue,
        startedAt: new Date()
      },
      create: {
        projectId: input.projectId,
        experimentId: input.experimentId,
        strategyConfigSetId: input.strategyConfigSetId ?? null,
        strategyConfigVersionId: input.strategyConfigVersionId ?? null,
        searchSpaceId: input.searchSpaceId ?? null,
        runKey,
        status: ResearchRunStatus.running,
        dataWindowStart: input.rangeStart,
        dataWindowEnd: input.rangeEnd,
        sportCode: input.sport.trim().toLowerCase(),
        leagueScopeJson: (input.leagueScope ?? null) as Prisma.InputJsonValue,
        marketScopeJson: (input.marketScope ?? null) as Prisma.InputJsonValue,
        horizonScopeJson: (input.horizonScope ?? null) as Prisma.InputJsonValue,
        objectiveMetric: input.objectiveMetric,
        secondaryMetricsJson: (input.secondaryMetrics ?? []) as Prisma.InputJsonValue,
        seed: input.seed,
        datasetHashesJson: input.datasetHashes as Prisma.InputJsonValue,
        featureSetVersion: input.featureSetVersion ?? null,
        modelRefsJson: (input.modelRefs ?? null) as Prisma.InputJsonValue,
        policyRefsJson: (input.policyRefs ?? null) as Prisma.InputJsonValue,
        bankrollProfile: input.bankrollProfile ?? null,
        notes: input.notes ?? null,
        tagsJson: (input.tags ?? []) as Prisma.InputJsonValue,
        startedAt: new Date()
      }
    });
  }

  async markRunCompleted(runId: string, status: ResearchRunStatus, metrics?: Record<string, unknown>) {
    return this.prisma.researchRun.update({
      where: { id: runId },
      data: {
        status,
        metricsJson: (metrics ?? null) as Prisma.InputJsonValue,
        completedAt: new Date()
      }
    });
  }

  async addRunArtifact(input: {
    runId: string;
    artifactType: string;
    artifactKey: string;
    artifactUri?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    return this.prisma.researchRunArtifact.upsert({
      where: {
        researchRunId_artifactKey: {
          researchRunId: input.runId,
          artifactKey: input.artifactKey
        }
      },
      update: {
        artifactType: input.artifactType,
        artifactUri: input.artifactUri ?? null,
        metadataJson: (input.metadata ?? null) as Prisma.InputJsonValue
      },
      create: {
        researchRunId: input.runId,
        artifactType: input.artifactType,
        artifactKey: input.artifactKey,
        artifactUri: input.artifactUri ?? null,
        metadataJson: (input.metadata ?? null) as Prisma.InputJsonValue
      }
    });
  }

  async addExperimentNote(input: {
    projectId?: string | null;
    experimentId?: string | null;
    researchRunId?: string | null;
    author?: string;
    noteText: string;
  }) {
    return this.prisma.experimentNote.create({
      data: {
        projectId: input.projectId ?? null,
        experimentId: input.experimentId ?? null,
        researchRunId: input.researchRunId ?? null,
        author: input.author ?? "system",
        noteText: input.noteText
      }
    });
  }

  async addExperimentTag(input: { projectId?: string | null; experimentId?: string | null; tag: string }) {
    return this.prisma.experimentTag.create({
      data: {
        projectId: input.projectId ?? null,
        experimentId: input.experimentId ?? null,
        tag: input.tag.trim().toLowerCase()
      }
    });
  }

  async compareRuns(runIds: string[]): Promise<RunComparisonRow[]> {
    if (runIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.researchRun.findMany({
      where: {
        id: { in: runIds }
      },
      select: {
        id: true,
        projectId: true,
        experimentId: true,
        status: true,
        objectiveMetric: true,
        datasetHashesJson: true,
        strategyConfigVersionId: true,
        searchSpaceId: true,
        seed: true,
        metricsJson: true
      }
    });

    return rows.map((row) => ({
      runId: row.id,
      projectId: row.projectId,
      experimentId: row.experimentId,
      status: row.status,
      objectiveMetric: row.objectiveMetric,
      datasetHashes: ((row.datasetHashesJson as Record<string, unknown>) ?? {}) as Record<string, unknown>,
      configVersionId: row.strategyConfigVersionId ?? null,
      searchSpaceId: row.searchSpaceId ?? null,
      seed: row.seed ?? null,
      metrics: ((row.metricsJson as Record<string, unknown>) ?? {}) as Record<string, unknown>
    }));
  }
}
