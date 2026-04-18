import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AccessActorType,
  PermissionEffect,
  PrivilegedActionSeverity,
  PrivilegedActionStatus,
  Prisma,
  SecurityEventSeverity,
  SecurityEventSourceDomain
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessGovernanceService } from "./access-governance.service";
import { SecurityEventService } from "../security-events/security-event.service";
import {
  AccessActor,
  PrivilegedActionApprovalInput,
  PrivilegedActionRequestInput
} from "./access-governance.types";

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

@Injectable()
export class PrivilegedActionControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessGovernanceService: AccessGovernanceService,
    private readonly securityEventService: SecurityEventService
  ) {}

  private isApprovalEnabled() {
    return parseBoolean(process.env.PRIVILEGED_ACTION_APPROVAL_ENABLED, true);
  }

  private isBreakGlassEnabled() {
    return parseBoolean(process.env.BREAK_GLASS_ENABLED, true);
  }

  private shouldRequireApproval(severity: PrivilegedActionSeverity) {
    if (!this.isApprovalEnabled()) {
      return false;
    }
    return severity === PrivilegedActionSeverity.HIGH || severity === PrivilegedActionSeverity.CRITICAL;
  }

  private toJsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
    if (!value) {
      return undefined;
    }
    return value as Prisma.InputJsonValue;
  }

  async submitRequest(actor: AccessActor, input: PrivilegedActionRequestInput) {
    const existing = await this.prisma.privilegedActionRequest.findUnique({
      where: {
        idempotencyKey: input.idempotencyKey
      }
    });
    if (existing) {
      return existing;
    }

    const severity = input.severity ?? this.accessGovernanceService.severityFromAction(input.action);
    const requiresApproval = input.requiresApproval ?? this.shouldRequireApproval(severity);
    const status = requiresApproval ? PrivilegedActionStatus.PENDING : PrivilegedActionStatus.APPROVED;
    const environment = input.environment?.trim().toLowerCase() ?? actor.environment;

    const created = await this.prisma.privilegedActionRequest.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        actorType: actor.actorType,
        actorId: actor.userId ?? null,
        serviceIdentityId: actor.serviceIdentityId ?? null,
        action: input.action.trim().toLowerCase(),
        resourceType: input.resourceType.trim().toLowerCase(),
        resourceId: input.resourceId ?? null,
        scopeJson: this.toJsonValue(input.scope as unknown as Record<string, unknown>),
        environment,
        severity,
        status,
        reason: input.reason,
        requiresStepUp: input.requiresStepUp ?? false,
        requiresApproval,
        metadata: this.toJsonValue(input.metadata)
      }
    });

    await this.securityEventService.emitAuditEvent({
      eventKey: `audit:privileged_action.request:${created.id}`,
      actorType: actor.actorType,
      actorId: actor.userId ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      action: "privileged_action.request",
      resourceType: input.resourceType,
      resourceId: created.id,
      reason: input.reason,
      decisionResult: status,
      severity: severity === PrivilegedActionSeverity.CRITICAL ? SecurityEventSeverity.CRITICAL : SecurityEventSeverity.HIGH,
      context: {
        ipAddress: actor.ipAddress ?? null,
        environment: actor.environment
      },
      metadata: {
        privilegedAction: input.action,
        severity,
        status
      }
    });

    await this.securityEventService.emitSecurityEvent({
      eventKey: `security:privileged_action.request:${created.id}`,
      sourceDomain: SecurityEventSourceDomain.ACCESS,
      eventType: "privileged_action_requested",
      severity: severity === PrivilegedActionSeverity.CRITICAL ? SecurityEventSeverity.CRITICAL : SecurityEventSeverity.HIGH,
      actorType: actor.actorType,
      actorId: actor.userId ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      targetResourceType: input.resourceType,
      targetResourceId: created.id,
      reason: input.reason,
      decisionResult: status,
      metadata: {
        action: input.action
      }
    });

    return created;
  }

  async approveRequest(approverUserId: string, input: PrivilegedActionApprovalInput) {
    const request = await this.prisma.privilegedActionRequest.findUnique({
      where: {
        id: input.requestId
      }
    });
    if (!request) {
      throw new NotFoundException("Privileged action request not found");
    }

    if (
      request.status !== PrivilegedActionStatus.PENDING &&
      request.status !== PrivilegedActionStatus.APPROVED
    ) {
      return request;
    }

    const approvalStatus =
      input.status === PrivilegedActionStatus.REJECTED ? PrivilegedActionStatus.REJECTED : PrivilegedActionStatus.APPROVED;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.privilegedActionApproval.create({
        data: {
          requestId: input.requestId,
          approverUserId,
          status: approvalStatus,
          reason: input.reason ?? null
        }
      });

      const statusUpdate =
        approvalStatus === PrivilegedActionStatus.APPROVED
          ? {
              status: PrivilegedActionStatus.APPROVED,
              approvedAt: new Date()
            }
          : {
              status: PrivilegedActionStatus.REJECTED
            };

      return tx.privilegedActionRequest.update({
        where: { id: input.requestId },
        data: statusUpdate
      });
    });

    await this.securityEventService.emitAuditEvent({
      eventKey: `audit:privileged_action.approve:${request.id}:${approvalStatus}`,
      actorType: AccessActorType.ADMIN,
      actorId: approverUserId,
      action: "privileged_action.approve",
      resourceType: request.resourceType,
      resourceId: request.id,
      reason: input.reason ?? null,
      decisionResult: approvalStatus,
      severity: approvalStatus === PrivilegedActionStatus.REJECTED ? SecurityEventSeverity.MEDIUM : SecurityEventSeverity.HIGH,
      metadata: {
        status: approvalStatus
      }
    });

    await this.securityEventService.emitSecurityEvent({
      eventKey: `security:privileged_action.approve:${request.id}:${approvalStatus}`,
      sourceDomain: SecurityEventSourceDomain.ACCESS,
      eventType: approvalStatus === PrivilegedActionStatus.REJECTED ? "privileged_action_rejected" : "privileged_action_approved",
      severity: approvalStatus === PrivilegedActionStatus.REJECTED ? SecurityEventSeverity.MEDIUM : SecurityEventSeverity.HIGH,
      actorType: AccessActorType.ADMIN,
      actorId: approverUserId,
      targetResourceType: request.resourceType,
      targetResourceId: request.id,
      reason: input.reason ?? null,
      decisionResult: approvalStatus
    });

    return updated;
  }

  async executeRequest(requestId: string, executorUserId?: string) {
    const request = await this.prisma.privilegedActionRequest.findUnique({
      where: { id: requestId }
    });
    if (!request) {
      throw new NotFoundException("Privileged action request not found");
    }
    if (request.status !== PrivilegedActionStatus.APPROVED) {
      throw new ForbiddenException("Privileged action not approved");
    }
    if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
      await this.prisma.privilegedActionRequest.update({
        where: { id: request.id },
        data: {
          status: PrivilegedActionStatus.EXPIRED
        }
      });
      throw new ForbiddenException("Privileged action expired");
    }

    const updated = await this.prisma.privilegedActionRequest.update({
      where: { id: request.id },
      data: {
        status: PrivilegedActionStatus.EXECUTED,
        executedAt: new Date()
      }
    });

    await this.securityEventService.emitAuditEvent({
      eventKey: `audit:privileged_action.execute:${request.id}`,
      actorType: executorUserId ? AccessActorType.ADMIN : request.actorType,
      actorId: executorUserId ?? null,
      serviceIdentityId: request.serviceIdentityId ?? null,
      action: "privileged_action.execute",
      resourceType: request.resourceType,
      resourceId: request.id,
      reason: request.reason,
      decisionResult: PrivilegedActionStatus.EXECUTED,
      severity: request.severity === PrivilegedActionSeverity.CRITICAL ? SecurityEventSeverity.CRITICAL : SecurityEventSeverity.HIGH,
      metadata: {
        action: request.action
      }
    });

    await this.securityEventService.emitSecurityEvent({
      eventKey: `security:privileged_action.execute:${request.id}`,
      sourceDomain: SecurityEventSourceDomain.ACCESS,
      eventType: "privileged_action_executed",
      severity: request.severity === PrivilegedActionSeverity.CRITICAL ? SecurityEventSeverity.CRITICAL : SecurityEventSeverity.HIGH,
      actorType: executorUserId ? AccessActorType.ADMIN : request.actorType,
      actorId: executorUserId ?? null,
      serviceIdentityId: request.serviceIdentityId ?? null,
      targetResourceType: request.resourceType,
      targetResourceId: request.id,
      reason: request.reason,
      decisionResult: PrivilegedActionStatus.EXECUTED
    });

    return updated;
  }

  async createBreakGlassGrant(input: {
    requester: AccessActor;
    approverUserId: string;
    userId: string;
    permission: string;
    resourceType: string;
    action: string;
    environment?: string | null;
    expiresAt: Date;
    reason: string;
  }) {
    if (!this.isBreakGlassEnabled()) {
      throw new ForbiddenException("Break glass disabled");
    }

    const idempotencyKey = `breakglass:${input.userId}:${input.permission}:${input.resourceType}:${input.action}:${input.expiresAt.toISOString()}`;
    const request = await this.submitRequest(input.requester, {
      idempotencyKey,
      action: "break_glass.grant",
      resourceType: input.resourceType,
      resourceId: input.userId,
      reason: input.reason,
      severity: PrivilegedActionSeverity.CRITICAL,
      environment: input.environment ?? input.requester.environment,
      requiresApproval: true,
      metadata: {
        permission: input.permission,
        action: input.action
      }
    });

    const approved = await this.approveRequest(input.approverUserId, {
      requestId: request.id,
      status: PrivilegedActionStatus.APPROVED,
      reason: input.reason
    });

    const grant = await this.accessGovernanceService.createPermissionGrant({
      actorType: AccessActorType.ADMIN,
      actorId: input.userId,
      permission: input.permission,
      resourceType: input.resourceType,
      action: input.action,
      effect: PermissionEffect.ALLOW,
      scope: {
        global: false,
        environment: input.environment ?? input.requester.environment
      },
      expiresAt: input.expiresAt,
      reason: `break_glass:${input.reason}`,
      grantedByUserId: input.approverUserId
    });

    await this.executeRequest(approved.id, input.approverUserId);
    await this.securityEventService.emitSecurityEvent({
      eventKey: `security:break_glass.granted:${grant.id}`,
      sourceDomain: SecurityEventSourceDomain.ACCESS,
      eventType: "break_glass_granted",
      severity: SecurityEventSeverity.CRITICAL,
      actorType: AccessActorType.ADMIN,
      actorId: input.approverUserId,
      targetResourceType: input.resourceType,
      targetResourceId: input.userId,
      reason: input.reason,
      decisionResult: "ALLOW",
      metadata: {
        permission: input.permission,
        action: input.action,
        expiresAt: input.expiresAt.toISOString()
      }
    });
    return {
      request: approved,
      grant
    };
  }

  async listRequests() {
    return this.prisma.privilegedActionRequest.findMany({
      include: {
        approvals: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }
}
