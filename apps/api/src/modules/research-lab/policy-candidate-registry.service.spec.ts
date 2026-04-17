import { PolicyCandidateStatus } from "@prisma/client";
import { PolicyCandidateRegistryService } from "./policy-candidate-registry.service";

describe("PolicyCandidateRegistryService", () => {
  const prisma = {
    policyCandidate: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    policyPromotionRequest: {
      create: jest.fn()
    },
    experimentNote: {
      create: jest.fn()
    },
    $transaction: jest.fn(async (handler: any) => handler(prisma))
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stores immutable candidate and avoids duplicate mutation", async () => {
    prisma.policyCandidate.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "candidate-1",
      key: "candidate-key",
      immutable: true
    });
    prisma.policyCandidate.create.mockResolvedValue({
      id: "candidate-1",
      key: "candidate-key",
      immutable: true,
      status: PolicyCandidateStatus.CANDIDATE
    });

    const service = new PolicyCandidateRegistryService(prisma);
    const first = await service.registerCandidate({
      projectId: "project-1",
      experimentId: "exp-1",
      researchRunId: "run-1",
      key: "candidate-key"
    });
    const second = await service.registerCandidate({
      projectId: "project-1",
      experimentId: "exp-1",
      researchRunId: "run-1",
      key: "candidate-key"
    });

    expect(first.id).toBe("candidate-1");
    expect(second.id).toBe("candidate-1");
    expect(prisma.policyCandidate.create).toHaveBeenCalledTimes(1);
  });

  it("rejects summary mutation when candidate is immutable", async () => {
    prisma.policyCandidate.findUnique.mockResolvedValue({
      id: "candidate-1",
      immutable: true
    });
    const service = new PolicyCandidateRegistryService(prisma);
    await expect(
      service.updateSummary({
        candidateId: "candidate-1",
        summary: { score: 0.61 }
      })
    ).rejects.toThrow("policy_candidate_immutable");
  });
});
