import { DataClassificationLevel } from "@prisma/client";
import { DataClassificationService } from "./data-classification.service";

describe("DataClassificationService", () => {
  let prisma: any;
  let securityEventService: any;
  let service: DataClassificationService;

  beforeEach(() => {
    process.env.COMPLIANCE_POLICY_VERSION = "v1";

    prisma = {
      dataClassification: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn()
      }
    };

    securityEventService = {
      emitAuditEvent: jest.fn().mockResolvedValue({ id: "audit-1" })
    };

    service = new DataClassificationService(prisma, securityEventService);
  });

  afterEach(() => {
    delete process.env.COMPLIANCE_POLICY_VERSION;
  });

  it("lists classifications with bounded limit", async () => {
    await service.listClassifications(9000);

    expect(prisma.dataClassification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true },
        take: 5000
      })
    );
  });

  it("resolves exact then wildcard classification mappings", async () => {
    const exact = {
      domain: "auth",
      entity: "users",
      fieldName: "email",
      dataClass: DataClassificationLevel.PII,
      redactionStrategy: "mask_email",
      policyVersion: "v1",
      active: true
    };

    prisma.dataClassification.findFirst
      .mockResolvedValueOnce(exact)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        domain: "provider",
        entity: "raw_provider_payloads",
        fieldName: "*",
        dataClass: DataClassificationLevel.RESTRICTED,
        redactionStrategy: "hash_payload",
        policyVersion: "v1",
        active: true
      });

    const exactResult = await service.resolveClassification({
      domain: "auth",
      entity: "users",
      fieldName: "email"
    });
    expect(exactResult).toMatchObject({ dataClass: DataClassificationLevel.PII, fieldName: "email" });

    const wildcardResult = await service.resolveClassification({
      domain: "provider",
      entity: "raw_provider_payloads",
      fieldName: "responseBody"
    });
    expect(wildcardResult).toMatchObject({
      dataClass: DataClassificationLevel.RESTRICTED,
      fieldName: "*"
    });
  });

  it("falls back to internal classification when mapping is missing", async () => {
    prisma.dataClassification.findFirst.mockResolvedValue(null);

    const result = await service.resolveClassification({
      domain: "prediction",
      entity: "unknown_table",
      fieldName: "unknown_field"
    });

    expect(result).toMatchObject({
      domain: "prediction",
      entity: "unknown_table",
      fieldName: "unknown_field",
      dataClass: DataClassificationLevel.INTERNAL,
      redactionStrategy: "mask",
      policyVersion: "v1"
    });
  });
});
