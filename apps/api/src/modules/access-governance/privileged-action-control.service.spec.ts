import { AccessActorType, PrivilegedActionSeverity, PrivilegedActionStatus } from "@prisma/client";
import { PrivilegedActionControlService } from "./privileged-action-control.service";

describe("PrivilegedActionControlService", () => {
  let prisma: any;
  let accessGovernanceService: any;
  let service: PrivilegedActionControlService;

  beforeEach(() => {
    process.env.PRIVILEGED_ACTION_APPROVAL_ENABLED = "true";
    process.env.BREAK_GLASS_ENABLED = "true";

    prisma = {
      privilegedActionRequest: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([])
      },
      privilegedActionApproval: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({})
      },
      $transaction: jest.fn()
    };

    accessGovernanceService = {
      severityFromAction: jest.fn().mockReturnValue(PrivilegedActionSeverity.HIGH),
      createPermissionGrant: jest.fn().mockResolvedValue({
        id: "grant-1"
      })
    };

    service = new PrivilegedActionControlService(prisma, accessGovernanceService);
  });

  afterEach(() => {
    delete process.env.PRIVILEGED_ACTION_APPROVAL_ENABLED;
    delete process.env.BREAK_GLASS_ENABLED;
  });

  it("requires approval for high-severity privileged actions", async () => {
    prisma.privilegedActionRequest.findUnique.mockResolvedValue(null);
    prisma.privilegedActionRequest.create.mockResolvedValue({
      id: "request-1",
      status: PrivilegedActionStatus.PENDING,
      requiresApproval: true
    });

    const result = await service.submitRequest(
      {
        actorType: AccessActorType.ADMIN,
        userId: "admin-1",
        environment: "production"
      },
      {
        idempotencyKey: "idem-1",
        action: "model.alias.switch",
        resourceType: "model",
        reason: "switch to stable alias",
        severity: PrivilegedActionSeverity.HIGH
      }
    );

    expect(result.status).toBe(PrivilegedActionStatus.PENDING);
    expect(prisma.privilegedActionRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requiresApproval: true,
          status: PrivilegedActionStatus.PENDING
        })
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "privileged_action.request"
        })
      })
    );
  });

  it("creates time-bounded break-glass grant and audit trail", async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    prisma.privilegedActionRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "request-break-glass",
        status: PrivilegedActionStatus.PENDING,
        resourceType: "security"
      })
      .mockResolvedValueOnce({
        id: "request-break-glass",
        status: PrivilegedActionStatus.APPROVED,
        action: "break_glass.grant",
        resourceType: "security"
      });

    prisma.privilegedActionRequest.create.mockResolvedValue({
      id: "request-break-glass",
      status: PrivilegedActionStatus.PENDING
    });

    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        privilegedActionApproval: {
          create: jest.fn().mockResolvedValue({})
        },
        privilegedActionRequest: {
          update: jest.fn().mockResolvedValue({
            id: "request-break-glass",
            status: PrivilegedActionStatus.APPROVED
          })
        }
      })
    );

    prisma.privilegedActionRequest.update.mockResolvedValue({
      id: "request-break-glass",
      status: PrivilegedActionStatus.EXECUTED
    });

    const result = await service.createBreakGlassGrant({
      requester: {
        actorType: AccessActorType.ADMIN,
        userId: "admin-2",
        environment: "production"
      },
      approverUserId: "admin-2",
      userId: "admin-3",
      permission: "security.compliance.change",
      resourceType: "security",
      action: "update",
      expiresAt,
      reason: "incident response"
    });

    expect(accessGovernanceService.createPermissionGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "admin-3",
        expiresAt,
        reason: expect.stringContaining("break_glass:incident response")
      })
    );
    expect(result.grant).toMatchObject({ id: "grant-1" });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(3);
  });
});
