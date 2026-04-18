import { ForbiddenException } from "@nestjs/common";
import { QueueAccessScopeClass } from "@prisma/client";
import { InternalRuntimeSecurityService } from "./internal-runtime-security.service";

describe("InternalRuntimeSecurityService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createService(scope: any = null) {
    const prisma = {
      queueAccessScope: {
        findUnique: jest.fn().mockResolvedValue(scope),
        upsert: jest.fn()
      },
      abuseEvent: {
        count: jest.fn().mockResolvedValue(0)
      }
    } as any;
    const securityEventService = {
      emitAuditEvent: jest.fn().mockResolvedValue({ id: "audit-1" }),
      emitAbuseEvent: jest.fn().mockResolvedValue({ id: "abuse-1" })
    } as any;
    return {
      service: new InternalRuntimeSecurityService(prisma, securityEventService),
      prisma,
      securityEventService
    };
  }

  it("rejects malformed privileged queue payloads", async () => {
    const { service } = createService();
    await expect(
      service.validateQueuePayload({
        queueName: "ingestion",
        jobName: "publishDecision",
        mode: "enqueue",
        payload: {
          runId: "run-1",
          authority: "public"
        }
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it("requires explicit queue scope in production", async () => {
    process.env.APP_ENV = "production";
    const { service } = createService(null);
    await expect(
      service.validateQueuePayload({
        queueName: "ingestion",
        jobName: "publishDecision",
        mode: "enqueue",
        payload: { runId: "run-2" }
      })
    ).rejects.toThrow("Queue access scope missing");
  });

  it("accepts payload when queue scope allows identity", async () => {
    process.env.APP_ENV = "production";
    const { service } = createService({
      queueName: "ingestion",
      serviceIdentityId: "api",
      scopeClass: QueueAccessScopeClass.OPERATIONAL,
      allowEnqueue: true,
      allowProcess: true,
      allowedJobsJson: ["publish*"],
      environment: "production"
    });

    const result = await service.validateQueuePayload({
      queueName: "ingestion",
      jobName: "publishDecision",
      mode: "enqueue",
      serviceIdentityId: "api",
      payload: { runId: "run-3" }
    });

    expect(result.serviceIdentityId).toBe("api");
    expect(result.payload.runId).toBe("run-3");
  });
});
