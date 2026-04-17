import { Injectable } from "@nestjs/common";
import { PolicyCandidateStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CandidateRegistrationInput } from "./research-lab.types";

@Injectable()
export class PolicyCandidateRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async registerCandidate(input: CandidateRegistrationInput) {
    const key = input.key.trim().toLowerCase();
    const existing = await this.prisma.policyCandidate.findUnique({
      where: { key }
    });
    if (existing) {
      return existing;
    }

    return this.prisma.policyCandidate.create({
      data: {
        projectId: input.projectId,
        experimentId: input.experimentId,
        researchRunId: input.researchRunId,
        bestTrialId: input.bestTrialId ?? null,
        strategyConfigVersionId: input.strategyConfigVersionId ?? null,
        searchSpaceId: input.searchSpaceId ?? null,
        robustnessTestRunId: input.robustnessTestRunId ?? null,
        key,
        status: input.status ?? PolicyCandidateStatus.CANDIDATE,
        summaryJson: (input.summary ?? null) as Prisma.InputJsonValue,
        objectiveDefinitionJson: (input.objectiveDefinition ?? null) as Prisma.InputJsonValue,
        datasetHashesJson: (input.datasetHashes ?? null) as Prisma.InputJsonValue,
        immutable: true
      }
    });
  }

  async setStatus(input: {
    candidateId: string;
    status: PolicyCandidateStatus;
    actor?: string;
    reason?: string | null;
  }) {
    const candidate = await this.prisma.policyCandidate.findUnique({
      where: { id: input.candidateId }
    });
    if (!candidate) {
      throw new Error("policy_candidate_not_found");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.policyCandidate.update({
        where: { id: candidate.id },
        data: { status: input.status }
      });

      await tx.experimentNote.create({
        data: {
          projectId: updated.projectId,
          experimentId: updated.experimentId,
          researchRunId: updated.researchRunId,
          author: input.actor ?? "system",
          noteText: `policy_candidate_status:${updated.status}${input.reason ? ` (${input.reason})` : ""}`
        }
      });
      return updated;
    });
  }

  async updateSummary(input: {
    candidateId: string;
    summary: Record<string, unknown>;
  }) {
    const candidate = await this.prisma.policyCandidate.findUnique({
      where: { id: input.candidateId }
    });
    if (!candidate) {
      throw new Error("policy_candidate_not_found");
    }
    if (candidate.immutable) {
      throw new Error("policy_candidate_immutable");
    }

    return this.prisma.policyCandidate.update({
      where: { id: input.candidateId },
      data: {
        summaryJson: input.summary as Prisma.InputJsonValue
      }
    });
  }

  async createPromotionRequest(input: {
    candidateId: string;
    researchRunId?: string | null;
    requestedBy?: string;
    reason?: string | null;
    evidence?: Record<string, unknown> | null;
  }) {
    return this.prisma.policyPromotionRequest.create({
      data: {
        policyCandidateId: input.candidateId,
        researchRunId: input.researchRunId ?? null,
        requestedBy: input.requestedBy ?? "system",
        reason: input.reason ?? null,
        evidenceJson: (input.evidence ?? null) as Prisma.InputJsonValue,
        status: "queued"
      }
    });
  }
}
