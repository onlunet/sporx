import { AccessActorType, GovernanceRequestStatus, GovernanceRequestType } from "@prisma/client";
import { PrivacyRequestService } from "./privacy-request.service";

describe("PrivacyRequestService", () => {
  let service: PrivacyRequestService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      dataAccessRequest: {
        findUnique: jest.fn()
      }
    };

    service = new PrivacyRequestService(
      {
        add: jest.fn()
      } as any,
      prisma,
      {
        emitAuditEvent: jest.fn(),
        emitSecurityEvent: jest.fn()
      } as any,
      {
        resolvePolicyVersion: jest.fn().mockReturnValue("v1"),
        evaluatePolicy: jest.fn()
      } as any,
      {
        resolveClassification: jest.fn()
      } as any,
      {
        anonymizeUserProfile: jest.fn()
      } as any,
      {
        executeCleanup: jest.fn()
      } as any,
      {
        resolveServiceIdentity: jest.fn().mockReturnValue("compliance-governance"),
        validateQueuePayload: jest.fn(async ({ payload, queueName, jobName, serviceIdentityId }: any) => ({
          queueName,
          jobName,
          payload,
          serviceIdentityId: serviceIdentityId ?? "compliance-governance"
        }))
      } as any
    );
  });

  it("returns existing data access request for stable idempotency key", async () => {
    const existing = {
      id: "req-1",
      requestKey: "privacy_request:abc",
      userId: "user-1",
      actorType: AccessActorType.ADMIN,
      actorId: "admin-1",
      serviceIdentityId: null,
      targetDomain: "auth",
      targetEntity: "users",
      targetId: "user-1",
      requestType: GovernanceRequestType.DATA_ACCESS,
      status: GovernanceRequestStatus.COMPLETED,
      legalBasisHook: null,
      policyVersion: "v1",
      reason: "existing_request",
      dryRun: true,
      auditEventId: null,
      securityEventId: null,
      metadata: null,
      createdAt: new Date(),
      completedAt: new Date(),
      updatedAt: new Date()
    };
    prisma.dataAccessRequest.findUnique.mockResolvedValue(existing);

    const result = await service.submitDataAccessRequest({
      requestType: GovernanceRequestType.DATA_ACCESS,
      requestKey: "privacy_request:abc",
      userId: "user-1",
      actorType: AccessActorType.ADMIN,
      actorId: "admin-1",
      targetDomain: "auth",
      targetEntity: "users",
      targetId: "user-1",
      dryRun: true
    });

    expect(result).toEqual({
      request: existing,
      deduplicated: true
    });
  });

  it("rejects invalid request type for privacy export flow", async () => {
    await expect(
      service.submitPrivacyExportRequest({
        requestType: GovernanceRequestType.PRIVACY_DELETE,
        targetDomain: "auth",
        dryRun: true
      })
    ).rejects.toThrow("Invalid request type for privacy export");
  });
});

