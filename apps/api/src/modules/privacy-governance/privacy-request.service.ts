import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  AccessActorType,
  DataClassificationLevel,
  GovernanceRequestStatus,
  GovernanceRequestType,
  LegalBasisHook,
  Prisma,
  PrivacyJobStatus,
  SecurityEventSeverity,
  SecurityEventSourceDomain
} from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { InternalRuntimeSecurityService } from "../security-hardening/internal-runtime-security.service";
import { SecurityEventService } from "../security-events/security-event.service";
import { ComplianceGovernanceService } from "./compliance-governance.service";
import { DataClassificationService } from "./data-classification.service";
import { DataMinimizationService } from "./data-minimization.service";
import { GovernanceContext, PrivacyRequestInput } from "./privacy-governance.types";
import { RetentionGovernanceService } from "./retention-governance.service";

const PRIVACY_GOVERNANCE_QUEUE = "privacy-governance";
const JOB_PRIVACY_EXPORT = "privacyExport";
const JOB_PRIVACY_DELETE = "privacyDelete";
const JOB_RETENTION_CLEANUP = "retentionCleanup";

const TERMINAL_REQUEST_STATUSES = new Set<GovernanceRequestStatus>([
  GovernanceRequestStatus.REJECTED,
  GovernanceRequestStatus.COMPLETED,
  GovernanceRequestStatus.FAILED,
  GovernanceRequestStatus.CANCELLED
]);

const REQUEST_TRANSITIONS: Record<GovernanceRequestStatus, GovernanceRequestStatus[]> = {
  OPEN: [GovernanceRequestStatus.POLICY_REVIEW, GovernanceRequestStatus.CANCELLED],
  POLICY_REVIEW: [GovernanceRequestStatus.APPROVED, GovernanceRequestStatus.REJECTED, GovernanceRequestStatus.CANCELLED],
  APPROVED: [GovernanceRequestStatus.QUEUED, GovernanceRequestStatus.CANCELLED],
  REJECTED: [],
  QUEUED: [GovernanceRequestStatus.RUNNING, GovernanceRequestStatus.FAILED, GovernanceRequestStatus.CANCELLED],
  RUNNING: [GovernanceRequestStatus.COMPLETED, GovernanceRequestStatus.FAILED, GovernanceRequestStatus.CANCELLED],
  COMPLETED: [],
  FAILED: [GovernanceRequestStatus.QUEUED, GovernanceRequestStatus.CANCELLED],
  CANCELLED: []
};

type QueuePayloadBase = {
  runId: string;
  serviceIdentityId: string;
  authority: "internal";
  actorType: AccessActorType;
  actorId?: string | null;
  context?: GovernanceContext | null;
};

type ExportQueuePayload = QueuePayloadBase & {
  requestId: string;
  jobId: string;
};

type DeleteQueuePayload = QueuePayloadBase & {
  requestId: string;
  jobId: string;
};

type CleanupQueuePayload = QueuePayloadBase & {
  jobKey: string;
  domain?: string | null;
  policyKey?: string | null;
  dryRun: boolean;
};

type DeletionExecutionResult = {
  deletedCount: number;
  anonymizedCount: number;
  skippedProtectedCount: number;
  details: Record<string, unknown>;
};

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

function normalize(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class PrivacyRequestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivacyRequestService.name);
  private worker: Worker | null = null;
  private workerStartPromise: Promise<void> | null = null;

  constructor(
    @InjectQueue(PRIVACY_GOVERNANCE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService,
    private readonly complianceGovernanceService: ComplianceGovernanceService,
    private readonly dataClassificationService: DataClassificationService,
    private readonly dataMinimizationService: DataMinimizationService,
    private readonly retentionGovernanceService: RetentionGovernanceService,
    private readonly internalRuntimeSecurityService: InternalRuntimeSecurityService
  ) {}

  isPrivacyGovernanceEnabled() {
    return parseBoolean(process.env.PRIVACY_GOVERNANCE_ENABLED, true);
  }

  isPrivacyExportEnabled() {
    return parseBoolean(process.env.PRIVACY_EXPORT_ENABLED, true);
  }

  isPrivacyDeletionEnabled() {
    return parseBoolean(process.env.PRIVACY_DELETION_ENABLED, true);
  }

  private shouldRunWorker() {
    const serviceRole = (process.env.SERVICE_ROLE ?? "api").trim().toLowerCase();
    const embedded = parseBoolean(process.env.ENABLE_EMBEDDED_PRIVACY_WORKER, false);
    return serviceRole === "worker" || embedded;
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private toJson(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
    if (!value) {
      return undefined;
    }
    return value as Prisma.InputJsonValue;
  }

  private contextFrom(input?: GovernanceContext | null) {
    return {
      correlationId: normalize(input?.correlationId),
      traceId: normalize(input?.traceId),
      requestId: normalize(input?.requestId),
      ipAddress: normalize(input?.ipAddress),
      userAgent: normalize(input?.userAgent),
      environment:
        normalize(input?.environment) ??
        normalize(process.env.APP_ENV) ??
        normalize(process.env.NODE_ENV) ??
        "development"
    };
  }

  private resolveActorType(input: {
    actorType?: AccessActorType | null;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    userId?: string | null;
  }) {
    if (input.actorType) {
      return input.actorType;
    }
    if (normalize(input.serviceIdentityId)) {
      return AccessActorType.SERVICE;
    }
    if (normalize(input.actorId)) {
      return AccessActorType.ADMIN;
    }
    if (normalize(input.userId)) {
      return AccessActorType.USER;
    }
    return AccessActorType.SYSTEM;
  }

  private requestStatusCanTransition(from: GovernanceRequestStatus, to: GovernanceRequestStatus) {
    if (from === to) {
      return true;
    }
    return (REQUEST_TRANSITIONS[from] ?? []).includes(to);
  }

  private isTerminalStatus(status: GovernanceRequestStatus) {
    return TERMINAL_REQUEST_STATUSES.has(status);
  }

  private resolveRequestKey(input: PrivacyRequestInput, policyVersion: string) {
    const provided = normalize(input.requestKey);
    if (provided) {
      return provided;
    }
    return `privacy_request:${this.hash(
      JSON.stringify({
        requestType: input.requestType,
        userId: normalize(input.userId),
        targetDomain: input.targetDomain.trim().toLowerCase(),
        targetEntity: normalize(input.targetEntity)?.toLowerCase() ?? null,
        targetId: normalize(input.targetId),
        policyVersion,
        legalBasisHook: input.legalBasisHook ?? null,
        dryRun: input.dryRun ?? true
      })
    )}`;
  }

  private resolveExportJobKey(request: {
    id: string;
    userId: string | null;
    targetDomain: string;
    targetEntity: string | null;
    targetId: string | null;
    policyVersion: string | null;
    dryRun: boolean;
  }) {
    return `privacy_export_job:${this.hash(
      JSON.stringify({
        requestId: request.id,
        userId: request.userId,
        targetDomain: request.targetDomain,
        targetEntity: request.targetEntity,
        targetId: request.targetId,
        policyVersion: request.policyVersion,
        dryRun: request.dryRun
      })
    )}`;
  }

  private resolveDeleteJobKey(request: {
    id: string;
    userId: string | null;
    targetDomain: string;
    targetEntity: string | null;
    targetId: string | null;
    policyVersion: string | null;
    legalBasisHook: LegalBasisHook | null;
    dryRun: boolean;
  }) {
    return `privacy_delete_job:${this.hash(
      JSON.stringify({
        requestId: request.id,
        userId: request.userId,
        targetDomain: request.targetDomain,
        targetEntity: request.targetEntity,
        targetId: request.targetId,
        policyVersion: request.policyVersion,
        legalBasisHook: request.legalBasisHook,
        dryRun: request.dryRun
      })
    )}`;
  }

  private resolveServiceIdentityId() {
    return this.internalRuntimeSecurityService.resolveServiceIdentity("compliance-governance");
  }

  private async emitTrail(input: {
    eventKey: string;
    actorType: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    action: string;
    eventType: string;
    resourceType: string;
    resourceId?: string | null;
    reason?: string | null;
    decisionResult?: string | null;
    severity?: SecurityEventSeverity;
    metadata?: Record<string, unknown> | null;
    context?: GovernanceContext | null;
  }) {
    const context = this.contextFrom(input.context);
    const audit = await this.securityEventService.emitAuditEvent({
      eventKey: `audit:${input.eventKey}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      reason: input.reason ?? null,
      decisionResult: input.decisionResult ?? null,
      severity: input.severity ?? SecurityEventSeverity.INFO,
      context,
      metadata: input.metadata ?? null
    });

    const security = await this.securityEventService.emitSecurityEvent({
      eventKey: `security:${input.eventKey}`,
      sourceDomain: SecurityEventSourceDomain.COMPLIANCE,
      eventType: input.eventType,
      severity: input.severity ?? SecurityEventSeverity.INFO,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      targetResourceType: input.resourceType,
      targetResourceId: input.resourceId ?? null,
      reason: input.reason ?? null,
      decisionResult: input.decisionResult ?? null,
      context,
      metadata: input.metadata ?? null
    });

    return {
      auditEventId: audit?.id ?? null,
      securityEventId: security?.id ?? null
    };
  }

  private async createDeletionRequest(input: PrivacyRequestInput, requestType: GovernanceRequestType) {
    const policyVersion = this.complianceGovernanceService.resolvePolicyVersion(input.policyVersion);
    const requestKey = this.resolveRequestKey({ ...input, requestType }, policyVersion);
    const actorType = this.resolveActorType(input);

    const existing = await this.prisma.deletionRequest.findUnique({
      where: { requestKey }
    });
    if (existing) {
      return {
        request: existing,
        deduplicated: true
      };
    }

    const created = await this.prisma.deletionRequest.create({
      data: {
        requestKey,
        userId: normalize(input.userId),
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId: normalize(input.serviceIdentityId),
        targetDomain: input.targetDomain.trim().toLowerCase(),
        targetEntity: normalize(input.targetEntity)?.toLowerCase() ?? null,
        targetId: normalize(input.targetId),
        requestType,
        status: GovernanceRequestStatus.OPEN,
        legalBasisHook: input.legalBasisHook ?? null,
        policyVersion,
        reason: normalize(input.reason),
        dryRun: input.dryRun ?? true,
        metadata: this.toJson({
          ...(input.metadata ?? {}),
          context: this.contextFrom(input.context)
        })
      }
    });

    const trail = await this.emitTrail({
      eventKey: `privacy_request.open:${created.id}`,
      actorType,
      actorId: normalize(input.actorId),
      serviceIdentityId: normalize(input.serviceIdentityId),
      action: "compliance.privacy_request.open",
      eventType: "privacy_request_opened",
      resourceType: "privacy_request",
      resourceId: created.id,
      reason: created.reason,
      metadata: {
        requestType,
        requestKey,
        targetDomain: created.targetDomain,
        dryRun: created.dryRun
      },
      context: input.context
    });

    const updated = await this.prisma.deletionRequest.update({
      where: { id: created.id },
      data: {
        auditEventId: trail.auditEventId,
        securityEventId: trail.securityEventId
      }
    });

    return {
      request: updated,
      deduplicated: false
    };
  }

  private async transitionDeletionRequestStatus(input: {
    requestId: string;
    status: GovernanceRequestStatus;
    reason?: string | null;
    actorType: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    context?: GovernanceContext | null;
    metadata?: Record<string, unknown> | null;
  }) {
    const existing = await this.prisma.deletionRequest.findUnique({
      where: { id: input.requestId }
    });
    if (!existing) {
      throw new BadRequestException("Privacy request not found");
    }

    if (existing.status === input.status) {
      return existing;
    }
    if (!this.requestStatusCanTransition(existing.status, input.status)) {
      if (this.isTerminalStatus(existing.status)) {
        return existing;
      }
      throw new BadRequestException(`Invalid privacy request transition: ${existing.status} -> ${input.status}`);
    }

    const updated = await this.prisma.deletionRequest.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        completedAt: this.isTerminalStatus(input.status) ? new Date() : null,
        reason: normalize(input.reason) ?? existing.reason,
        metadata: this.toJson({
          ...(typeof existing.metadata === "object" && existing.metadata ? (existing.metadata as Record<string, unknown>) : {}),
          ...(input.metadata ?? {})
        })
      }
    });

    await this.emitTrail({
      eventKey: `privacy_request.transition:${updated.id}:${input.status}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "compliance.privacy_request.transition",
      eventType: "privacy_request_transitioned",
      resourceType: "privacy_request",
      resourceId: updated.id,
      reason: normalize(input.reason) ?? existing.reason,
      decisionResult: input.status,
      severity:
        input.status === GovernanceRequestStatus.REJECTED || input.status === GovernanceRequestStatus.FAILED
          ? SecurityEventSeverity.HIGH
          : SecurityEventSeverity.INFO,
      metadata: {
        from: existing.status,
        to: input.status
      },
      context: input.context
    });

    return updated;
  }

  private async classifyRequest(request: {
    targetDomain: string;
    targetEntity: string | null;
    policyVersion: string | null;
  }) {
    const classification = await this.dataClassificationService.resolveClassification({
      domain: request.targetDomain,
      entity: request.targetEntity ?? request.targetDomain,
      fieldName: "*",
      policyVersion: request.policyVersion
    });
    return classification.dataClass as DataClassificationLevel;
  }

  private async ensureExportJob(request: {
    id: string;
    userId: string | null;
    actorType: AccessActorType | null;
    actorId: string | null;
    serviceIdentityId: string | null;
    targetDomain: string;
    targetEntity: string | null;
    targetId: string | null;
    policyVersion: string | null;
    legalBasisHook: LegalBasisHook | null;
    dryRun: boolean;
    reason: string | null;
  }) {
    const jobKey = this.resolveExportJobKey(request);
    const existing = await this.prisma.privacyExportJob.findUnique({
      where: { jobKey }
    });
    if (existing && (existing.status === PrivacyJobStatus.QUEUED || existing.status === PrivacyJobStatus.RUNNING || existing.status === PrivacyJobStatus.COMPLETED)) {
      return existing;
    }

    const jobRecord = existing
      ? await this.prisma.privacyExportJob.update({
          where: { id: existing.id },
          data: {
            status: PrivacyJobStatus.QUEUED,
            policyVersion: request.policyVersion,
            legalBasisHook: request.legalBasisHook,
            dryRun: request.dryRun,
            legalHoldBlocked: false,
            errorMessage: null,
            completedAt: null
          }
        })
      : await this.prisma.privacyExportJob.create({
          data: {
            jobKey,
            requestId: request.id,
            userId: request.userId,
            status: PrivacyJobStatus.QUEUED,
            policyVersion: request.policyVersion,
            legalBasisHook: request.legalBasisHook,
            dryRun: request.dryRun,
            legalHoldBlocked: false,
            inputScopeJson: this.toJson({
              requestId: request.id,
              targetDomain: request.targetDomain,
              targetEntity: request.targetEntity,
              targetId: request.targetId
            })
          }
        });

    const serviceIdentityId = request.serviceIdentityId ?? this.resolveServiceIdentityId();
    const payload: ExportQueuePayload = {
      runId: jobRecord.id,
      requestId: request.id,
      jobId: jobRecord.id,
      authority: "internal",
      actorType: request.actorType ?? AccessActorType.SYSTEM,
      actorId: request.actorId ?? null,
      serviceIdentityId,
      context: {
        environment: normalize(process.env.APP_ENV) ?? normalize(process.env.NODE_ENV) ?? "development"
      }
    };

    await this.enqueueQueueJob(JOB_PRIVACY_EXPORT, payload, jobKey);
    this.runInlineFallback(JOB_PRIVACY_EXPORT, payload);
    return jobRecord;
  }

  private async ensureDeletionJob(request: {
    id: string;
    userId: string | null;
    actorType: AccessActorType | null;
    actorId: string | null;
    serviceIdentityId: string | null;
    targetDomain: string;
    targetEntity: string | null;
    targetId: string | null;
    policyVersion: string | null;
    legalBasisHook: LegalBasisHook | null;
    dryRun: boolean;
    reason: string | null;
  }) {
    const jobKey = this.resolveDeleteJobKey(request);
    const existing = await this.prisma.privacyDeletionJob.findUnique({
      where: { jobKey }
    });
    if (existing && (existing.status === PrivacyJobStatus.QUEUED || existing.status === PrivacyJobStatus.RUNNING || existing.status === PrivacyJobStatus.COMPLETED)) {
      return existing;
    }

    const jobRecord = existing
      ? await this.prisma.privacyDeletionJob.update({
          where: { id: existing.id },
          data: {
            status: PrivacyJobStatus.QUEUED,
            policyVersion: request.policyVersion,
            legalBasisHook: request.legalBasisHook,
            dryRun: request.dryRun,
            legalHoldBlocked: false,
            deletedCount: 0,
            anonymizedCount: 0,
            skippedProtectedCount: 0,
            errorMessage: null,
            completedAt: null
          }
        })
      : await this.prisma.privacyDeletionJob.create({
          data: {
            jobKey,
            requestId: request.id,
            userId: request.userId,
            status: PrivacyJobStatus.QUEUED,
            policyVersion: request.policyVersion,
            legalBasisHook: request.legalBasisHook,
            dryRun: request.dryRun,
            legalHoldBlocked: false,
            inputScopeJson: this.toJson({
              requestId: request.id,
              targetDomain: request.targetDomain,
              targetEntity: request.targetEntity,
              targetId: request.targetId
            })
          }
        });

    const serviceIdentityId = request.serviceIdentityId ?? this.resolveServiceIdentityId();
    const payload: DeleteQueuePayload = {
      runId: jobRecord.id,
      requestId: request.id,
      jobId: jobRecord.id,
      authority: "internal",
      actorType: request.actorType ?? AccessActorType.SYSTEM,
      actorId: request.actorId ?? null,
      serviceIdentityId,
      context: {
        environment: normalize(process.env.APP_ENV) ?? normalize(process.env.NODE_ENV) ?? "development"
      }
    };

    await this.enqueueQueueJob(JOB_PRIVACY_DELETE, payload, jobKey);
    this.runInlineFallback(JOB_PRIVACY_DELETE, payload);
    return jobRecord;
  }

  async submitPrivacyExportRequest(input: PrivacyRequestInput) {
    if (!this.isPrivacyGovernanceEnabled() || !this.isPrivacyExportEnabled()) {
      throw new ForbiddenException("Privacy export disabled");
    }
    if (input.requestType !== GovernanceRequestType.PRIVACY_EXPORT) {
      throw new BadRequestException("Invalid request type for privacy export");
    }

    const actorType = this.resolveActorType(input);
    const serviceIdentityId = normalize(input.serviceIdentityId) ?? this.resolveServiceIdentityId();
    const created = await this.createDeletionRequest(input, GovernanceRequestType.PRIVACY_EXPORT);
    let request = created.request;
    const context = this.contextFrom(input.context);

    if (request.requestType !== GovernanceRequestType.PRIVACY_EXPORT) {
      throw new BadRequestException("Request type mismatch for privacy export");
    }

    if (request.status === GovernanceRequestStatus.COMPLETED) {
      const existingJob = await this.prisma.privacyExportJob.findFirst({
        where: { requestId: request.id },
        orderBy: { createdAt: "desc" }
      });
      return {
        request,
        job: existingJob,
        deduplicated: true
      };
    }
    if (request.status === GovernanceRequestStatus.QUEUED || request.status === GovernanceRequestStatus.RUNNING) {
      const existingJob = await this.prisma.privacyExportJob.findFirst({
        where: { requestId: request.id },
        orderBy: { createdAt: "desc" }
      });
      return {
        request,
        job: existingJob,
        deduplicated: true
      };
    }
    if (request.status === GovernanceRequestStatus.REJECTED || request.status === GovernanceRequestStatus.CANCELLED) {
      return {
        request,
        job: null,
        deduplicated: true
      };
    }

    if (request.status === GovernanceRequestStatus.OPEN) {
      request = await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.POLICY_REVIEW,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        reason: "privacy_export_policy_review",
        context
      });
    }

    const dataClass = await this.classifyRequest(request);
    const policyDecision = await this.complianceGovernanceService.evaluatePolicy({
      operation: "privacy_export",
      domain: request.targetDomain,
      dataClass,
      policyVersion: request.policyVersion,
      legalBasisHook: request.legalBasisHook,
      dryRun: request.dryRun,
      scope: {
        requestId: request.id,
        targetEntity: request.targetEntity,
        targetId: request.targetId,
        requestType: request.requestType
      },
      actorType,
      actorId: normalize(input.actorId),
      serviceIdentityId,
      reason: normalize(input.reason),
      context
    });

    if (!policyDecision.approved) {
      request = await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.REJECTED,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        reason: policyDecision.reason,
        context,
        metadata: {
          policyDecisionKey: policyDecision.decisionKey
        }
      });
      return {
        request,
        job: null,
        deduplicated: created.deduplicated,
        policyDecision
      };
    }

    if (request.status === GovernanceRequestStatus.POLICY_REVIEW) {
      request = await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.APPROVED,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        reason: "privacy_export_policy_approved",
        context,
        metadata: {
          policyDecisionKey: policyDecision.decisionKey
        }
      });
    }

    const job = await this.ensureExportJob({
      id: request.id,
      userId: request.userId,
      actorType,
      actorId: normalize(input.actorId),
      serviceIdentityId,
      targetDomain: request.targetDomain,
      targetEntity: request.targetEntity,
      targetId: request.targetId,
      policyVersion: request.policyVersion,
      legalBasisHook: request.legalBasisHook,
      dryRun: request.dryRun,
      reason: request.reason
    });

    if (request.status !== GovernanceRequestStatus.QUEUED && request.status !== GovernanceRequestStatus.RUNNING) {
      request = await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.QUEUED,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        reason: "privacy_export_job_queued",
        context,
        metadata: {
          jobId: job.id,
          jobKey: job.jobKey
        }
      });
    }

    return {
      request,
      job,
      deduplicated: created.deduplicated,
      policyDecision
    };
  }

  async submitPrivacyDeletionRequest(input: PrivacyRequestInput) {
    if (!this.isPrivacyGovernanceEnabled() || !this.isPrivacyDeletionEnabled()) {
      throw new ForbiddenException("Privacy deletion disabled");
    }
    if (input.requestType !== GovernanceRequestType.PRIVACY_DELETE) {
      throw new BadRequestException("Invalid request type for privacy deletion");
    }

    const actorType = this.resolveActorType(input);
    const serviceIdentityId = normalize(input.serviceIdentityId) ?? this.resolveServiceIdentityId();
    const created = await this.createDeletionRequest(input, GovernanceRequestType.PRIVACY_DELETE);
    let request = created.request;
    const context = this.contextFrom(input.context);

    if (request.requestType !== GovernanceRequestType.PRIVACY_DELETE) {
      throw new BadRequestException("Request type mismatch for privacy deletion");
    }

    if (request.status === GovernanceRequestStatus.COMPLETED) {
      const existingJob = await this.prisma.privacyDeletionJob.findFirst({
        where: { requestId: request.id },
        orderBy: { createdAt: "desc" }
      });
      return {
        request,
        job: existingJob,
        deduplicated: true
      };
    }
    if (request.status === GovernanceRequestStatus.QUEUED || request.status === GovernanceRequestStatus.RUNNING) {
      const existingJob = await this.prisma.privacyDeletionJob.findFirst({
        where: { requestId: request.id },
        orderBy: { createdAt: "desc" }
      });
      return {
        request,
        job: existingJob,
        deduplicated: true
      };
    }
    if (request.status === GovernanceRequestStatus.REJECTED || request.status === GovernanceRequestStatus.CANCELLED) {
      return {
        request,
        job: null,
        deduplicated: true
      };
    }

    if (request.status === GovernanceRequestStatus.OPEN) {
      request = await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.POLICY_REVIEW,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        reason: "privacy_delete_policy_review",
        context
      });
    }

    const dataClass = await this.classifyRequest(request);
    const policyDecision = await this.complianceGovernanceService.evaluatePolicy({
      operation: "privacy_delete",
      domain: request.targetDomain,
      dataClass,
      policyVersion: request.policyVersion,
      legalBasisHook: request.legalBasisHook,
      dryRun: request.dryRun,
      scope: {
        requestId: request.id,
        targetEntity: request.targetEntity,
        targetId: request.targetId,
        requestType: request.requestType
      },
      actorType,
      actorId: normalize(input.actorId),
      serviceIdentityId,
      reason: normalize(input.reason),
      context
    });

    if (!policyDecision.approved) {
      request = await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.REJECTED,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        reason: policyDecision.reason,
        context,
        metadata: {
          policyDecisionKey: policyDecision.decisionKey
        }
      });
      return {
        request,
        job: null,
        deduplicated: created.deduplicated,
        policyDecision
      };
    }

    if (request.status === GovernanceRequestStatus.POLICY_REVIEW) {
      request = await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.APPROVED,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        reason: "privacy_delete_policy_approved",
        context,
        metadata: {
          policyDecisionKey: policyDecision.decisionKey
        }
      });
    }

    const job = await this.ensureDeletionJob({
      id: request.id,
      userId: request.userId,
      actorType,
      actorId: normalize(input.actorId),
      serviceIdentityId,
      targetDomain: request.targetDomain,
      targetEntity: request.targetEntity,
      targetId: request.targetId,
      policyVersion: request.policyVersion,
      legalBasisHook: request.legalBasisHook,
      dryRun: request.dryRun,
      reason: request.reason
    });

    if (request.status !== GovernanceRequestStatus.QUEUED && request.status !== GovernanceRequestStatus.RUNNING) {
      request = await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.QUEUED,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        reason: "privacy_delete_job_queued",
        context,
        metadata: {
          jobId: job.id,
          jobKey: job.jobKey
        }
      });
    }

    return {
      request,
      job,
      deduplicated: created.deduplicated,
      policyDecision
    };
  }

  async submitDataAccessRequest(input: PrivacyRequestInput) {
    if (!this.isPrivacyGovernanceEnabled()) {
      throw new ForbiddenException("Privacy governance disabled");
    }
    if (input.requestType !== GovernanceRequestType.DATA_ACCESS) {
      throw new BadRequestException("Invalid request type for data access");
    }

    const actorType = this.resolveActorType(input);
    const serviceIdentityId = normalize(input.serviceIdentityId) ?? this.resolveServiceIdentityId();
    const policyVersion = this.complianceGovernanceService.resolvePolicyVersion(input.policyVersion);
    const requestKey = this.resolveRequestKey(input, policyVersion);
    const context = this.contextFrom(input.context);

    const existing = await this.prisma.dataAccessRequest.findUnique({
      where: { requestKey }
    });
    if (existing) {
      return {
        request: existing,
        deduplicated: true
      };
    }

    let request = await this.prisma.dataAccessRequest.create({
      data: {
        requestKey,
        userId: normalize(input.userId),
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        targetDomain: input.targetDomain.trim().toLowerCase(),
        targetEntity: normalize(input.targetEntity)?.toLowerCase() ?? null,
        targetId: normalize(input.targetId),
        requestType: GovernanceRequestType.DATA_ACCESS,
        status: GovernanceRequestStatus.POLICY_REVIEW,
        legalBasisHook: input.legalBasisHook ?? null,
        policyVersion,
        reason: normalize(input.reason),
        dryRun: input.dryRun ?? true,
        metadata: this.toJson({
          ...(input.metadata ?? {}),
          context
        })
      }
    });

    await this.emitTrail({
      eventKey: `data_access_request.open:${request.id}`,
      actorType,
      actorId: normalize(input.actorId),
      serviceIdentityId,
      action: "compliance.data_access_request.open",
      eventType: "data_access_request_opened",
      resourceType: "data_access_request",
      resourceId: request.id,
      reason: request.reason,
      context
    });

    const dataClass = await this.classifyRequest(request);
    const policyDecision = await this.complianceGovernanceService.evaluatePolicy({
      operation: "data_access",
      domain: request.targetDomain,
      dataClass,
      policyVersion: request.policyVersion,
      legalBasisHook: request.legalBasisHook,
      dryRun: request.dryRun,
      scope: {
        requestId: request.id,
        requestType: request.requestType
      },
      actorType,
      actorId: normalize(input.actorId),
      serviceIdentityId,
      reason: normalize(input.reason),
      context
    });

    if (!policyDecision.approved) {
      request = await this.prisma.dataAccessRequest.update({
        where: { id: request.id },
        data: {
          status: GovernanceRequestStatus.REJECTED,
          completedAt: new Date(),
          metadata: this.toJson({
            ...(typeof request.metadata === "object" && request.metadata ? (request.metadata as Record<string, unknown>) : {}),
            policyDecisionKey: policyDecision.decisionKey
          })
        }
      });

      await this.emitTrail({
        eventKey: `data_access_request.rejected:${request.id}`,
        actorType,
        actorId: normalize(input.actorId),
        serviceIdentityId,
        action: "compliance.data_access_request.rejected",
        eventType: "data_access_request_rejected",
        resourceType: "data_access_request",
        resourceId: request.id,
        reason: policyDecision.reason,
        decisionResult: "REJECTED",
        severity: SecurityEventSeverity.HIGH,
        context
      });

      return {
        request,
        deduplicated: false,
        policyDecision
      };
    }

    const receipt = await this.buildDataAccessReceipt({
      userId: request.userId,
      targetDomain: request.targetDomain,
      targetEntity: request.targetEntity,
      targetId: request.targetId
    });

    request = await this.prisma.dataAccessRequest.update({
      where: { id: request.id },
      data: {
        status: GovernanceRequestStatus.COMPLETED,
        completedAt: new Date(),
        metadata: this.toJson({
          ...(typeof request.metadata === "object" && request.metadata ? (request.metadata as Record<string, unknown>) : {}),
          policyDecisionKey: policyDecision.decisionKey,
          receipt
        })
      }
    });

    await this.emitTrail({
      eventKey: `data_access_request.completed:${request.id}`,
      actorType,
      actorId: normalize(input.actorId),
      serviceIdentityId,
      action: "compliance.data_access_request.completed",
      eventType: "data_access_request_completed",
      resourceType: "data_access_request",
      resourceId: request.id,
      reason: request.reason,
      decisionResult: "COMPLETED",
      context,
      metadata: {
        receipt
      }
    });

    return {
      request,
      deduplicated: false,
      policyDecision
    };
  }

  async listDeletionRequests(input?: {
    status?: GovernanceRequestStatus | null;
    limit?: number;
  }) {
    const take = Math.max(1, Math.min(input?.limit ?? 200, 2000));
    const requests = await this.prisma.deletionRequest.findMany({
      where: {
        requestType: GovernanceRequestType.PRIVACY_DELETE,
        ...(input?.status ? { status: input.status } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take
    });

    const requestIds = requests.map((item) => item.id);
    const jobs = requestIds.length === 0
      ? []
      : await this.prisma.privacyDeletionJob.findMany({
          where: { requestId: { in: requestIds } },
          orderBy: [{ createdAt: "desc" }]
        });
    const latestJobByRequest = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) {
      if (!job.requestId) {
        continue;
      }
      if (!latestJobByRequest.has(job.requestId)) {
        latestJobByRequest.set(job.requestId, job);
      }
    }

    return {
      items: requests.map((request) => ({
        request,
        latestJob: latestJobByRequest.get(request.id) ?? null
      })),
      summary: {
        total: requests.length,
        byStatus: requests.reduce<Record<GovernanceRequestStatus, number>>(
          (acc, item) => {
            acc[item.status] = (acc[item.status] ?? 0) + 1;
            return acc;
          },
          {
            OPEN: 0,
            POLICY_REVIEW: 0,
            APPROVED: 0,
            REJECTED: 0,
            QUEUED: 0,
            RUNNING: 0,
            COMPLETED: 0,
            FAILED: 0,
            CANCELLED: 0
          }
        )
      }
    };
  }

  async listPrivacyExportJobs(input?: {
    status?: PrivacyJobStatus | null;
    limit?: number;
  }) {
    const take = Math.max(1, Math.min(input?.limit ?? 200, 2000));
    const jobs = await this.prisma.privacyExportJob.findMany({
      where: {
        ...(input?.status ? { status: input.status } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take
    });
    return {
      items: jobs,
      summary: {
        total: jobs.length,
        byStatus: jobs.reduce<Record<PrivacyJobStatus, number>>(
          (acc, item) => {
            acc[item.status] = (acc[item.status] ?? 0) + 1;
            return acc;
          },
          {
            QUEUED: 0,
            RUNNING: 0,
            COMPLETED: 0,
            FAILED: 0,
            CANCELLED: 0
          }
        )
      }
    };
  }

  async listDataAccessRequests(input?: {
    status?: GovernanceRequestStatus | null;
    limit?: number;
  }) {
    const take = Math.max(1, Math.min(input?.limit ?? 200, 2000));
    return this.prisma.dataAccessRequest.findMany({
      where: {
        ...(input?.status ? { status: input.status } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take
    });
  }

  async enqueueRetentionCleanup(input?: {
    domain?: string | null;
    policyKey?: string | null;
    dryRun?: boolean;
    actorType?: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    context?: GovernanceContext | null;
  }) {
    const actorType = input?.actorType ?? AccessActorType.ADMIN;
    const actorId = normalize(input?.actorId);
    const serviceIdentityId = normalize(input?.serviceIdentityId) ?? this.resolveServiceIdentityId();
    const dryRun = input?.dryRun ?? false;
    const domain = normalize(input?.domain)?.toLowerCase() ?? null;
    const policyKey = normalize(input?.policyKey);
    const jobKey = `retention_cleanup_job:${this.hash(
      JSON.stringify({
        domain,
        policyKey,
        dryRun,
        policyVersion: this.complianceGovernanceService.resolvePolicyVersion()
      })
    )}`;

    const payload: CleanupQueuePayload = {
      runId: randomUUID(),
      authority: "internal",
      actorType,
      actorId,
      serviceIdentityId,
      domain,
      policyKey,
      dryRun,
      jobKey,
      context: this.contextFrom(input?.context)
    };

    await this.emitTrail({
      eventKey: `retention_cleanup.enqueued:${jobKey}`,
      actorType,
      actorId,
      serviceIdentityId,
      action: "compliance.retention.cleanup_enqueued",
      eventType: "retention_cleanup_enqueued",
      resourceType: "retention_policy",
      resourceId: policyKey ?? domain ?? "all",
      reason: dryRun ? "retention_cleanup_dry_run_enqueue" : "retention_cleanup_execute_enqueue",
      severity: SecurityEventSeverity.MEDIUM,
      context: input?.context ?? null,
      metadata: {
        jobKey,
        dryRun,
        domain,
        policyKey
      }
    });

    const queued = await this.enqueueQueueJob(JOB_RETENTION_CLEANUP, payload, jobKey);

    return {
      jobId: queued.id ? String(queued.id) : jobKey,
      jobKey,
      dryRun,
      domain,
      policyKey
    };
  }

  private async enqueueQueueJob(jobName: string, payload: QueuePayloadBase, jobId: string) {
    const validated = await this.internalRuntimeSecurityService.validateQueuePayload({
      queueName: PRIVACY_GOVERNANCE_QUEUE,
      jobName,
      payload: payload as Record<string, unknown>,
      mode: "enqueue",
      serviceIdentityId: payload.serviceIdentityId
    });

    return this.queue.add(jobName, validated.payload, {
      jobId,
      removeOnComplete: 500,
      removeOnFail: 500,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1500
      }
    });
  }

  private runInlineFallback(jobName: string, payload: QueuePayloadBase) {
    setImmediate(() => {
      this.processQueuePayload(jobName, payload as any).catch((error) => {
        this.logger.error(
          `Inline privacy queue fallback failed for ${jobName}`,
          error instanceof Error ? error.stack : undefined
        );
      });
    });
  }

  private async processQueuePayload(jobName: string, payload: QueuePayloadBase) {
    const validated = await this.internalRuntimeSecurityService.validateQueuePayload({
      queueName: PRIVACY_GOVERNANCE_QUEUE,
      jobName,
      payload: payload as Record<string, unknown>,
      mode: "process",
      serviceIdentityId: payload.serviceIdentityId
    });
    const normalized = validated.payload as Record<string, unknown>;

    if (jobName === JOB_PRIVACY_EXPORT) {
      const requestId = String(normalized.requestId ?? "");
      const jobId = String(normalized.jobId ?? normalized.runId ?? "");
      if (!requestId || !jobId) {
        throw new BadRequestException("privacy export payload missing requestId/jobId");
      }
      return this.processPrivacyExportJob({
        requestId,
        jobId,
        actorType: payload.actorType,
        actorId: payload.actorId ?? null,
        serviceIdentityId: payload.serviceIdentityId,
        context: payload.context ?? null
      });
    }

    if (jobName === JOB_PRIVACY_DELETE) {
      const requestId = String(normalized.requestId ?? "");
      const jobId = String(normalized.jobId ?? normalized.runId ?? "");
      if (!requestId || !jobId) {
        throw new BadRequestException("privacy delete payload missing requestId/jobId");
      }
      return this.processPrivacyDeleteJob({
        requestId,
        jobId,
        actorType: payload.actorType,
        actorId: payload.actorId ?? null,
        serviceIdentityId: payload.serviceIdentityId,
        context: payload.context ?? null
      });
    }

    if (jobName === JOB_RETENTION_CLEANUP) {
      return this.processRetentionCleanupJob({
        actorType: payload.actorType,
        actorId: payload.actorId ?? null,
        serviceIdentityId: payload.serviceIdentityId,
        context: payload.context ?? null,
        jobKey: String(normalized.jobKey ?? ""),
        dryRun: Boolean(normalized.dryRun),
        domain: normalize(typeof normalized.domain === "string" ? normalized.domain : null),
        policyKey: normalize(typeof normalized.policyKey === "string" ? normalized.policyKey : null)
      });
    }

    throw new BadRequestException(`Unsupported privacy queue job: ${jobName}`);
  }

  private async processPrivacyExportJob(input: {
    requestId: string;
    jobId: string;
    actorType: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    context?: GovernanceContext | null;
  }) {
    const claim = await this.prisma.privacyExportJob.updateMany({
      where: {
        id: input.jobId,
        status: {
          in: [PrivacyJobStatus.QUEUED, PrivacyJobStatus.FAILED]
        }
      },
      data: {
        status: PrivacyJobStatus.RUNNING,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
        attempts: { increment: 1 }
      }
    });
    if (claim.count === 0) {
      return this.prisma.privacyExportJob.findUnique({ where: { id: input.jobId } });
    }

    await this.transitionDeletionRequestStatus({
      requestId: input.requestId,
      status: GovernanceRequestStatus.RUNNING,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: "privacy_export_running",
      context: input.context
    });

    await this.emitTrail({
      eventKey: `privacy_export.start:${input.jobId}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "compliance.privacy_export.start",
      eventType: "privacy_export_started",
      resourceType: "privacy_export_job",
      resourceId: input.jobId,
      severity: SecurityEventSeverity.MEDIUM,
      reason: "privacy_export_started",
      context: input.context
    });

    const [job, request] = await Promise.all([
      this.prisma.privacyExportJob.findUnique({ where: { id: input.jobId } }),
      this.prisma.deletionRequest.findUnique({ where: { id: input.requestId } })
    ]);
    if (!job || !request) {
      throw new BadRequestException("Privacy export request/job not found");
    }

    const dataClass = await this.classifyRequest(request);
    const policyDecision = await this.complianceGovernanceService.evaluatePolicy({
      operation: "privacy_export",
      domain: request.targetDomain,
      dataClass,
      policyVersion: request.policyVersion,
      legalBasisHook: request.legalBasisHook,
      dryRun: job.dryRun,
      scope: {
        requestId: request.id,
        targetEntity: request.targetEntity,
        targetId: request.targetId
      },
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: request.reason,
      context: this.contextFrom(input.context)
    });

    if (!policyDecision.approved) {
      await this.prisma.privacyExportJob.update({
        where: { id: job.id },
        data: {
          status: PrivacyJobStatus.FAILED,
          completedAt: new Date(),
          legalHoldBlocked: policyDecision.legalHoldBlocked,
          errorMessage: policyDecision.reason
        }
      });
      await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.FAILED,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        reason: policyDecision.reason,
        context: input.context,
        metadata: {
          policyDecisionKey: policyDecision.decisionKey
        }
      });
      return {
        status: PrivacyJobStatus.FAILED,
        reason: policyDecision.reason,
        legalHoldBlocked: policyDecision.legalHoldBlocked
      };
    }

    const exported = await this.buildExportPayload(request);
    const outputHash = this.hash(JSON.stringify(exported));
    const outputRef = job.dryRun
      ? `dryrun://privacy-export/${request.id}/${outputHash}`
      : `inline://privacy-export/${job.id}/${outputHash}`;

    const completed = await this.prisma.privacyExportJob.update({
      where: { id: job.id },
      data: {
        status: PrivacyJobStatus.COMPLETED,
        completedAt: new Date(),
        outputRef,
        legalHoldBlocked: false,
        errorMessage: null,
        metadata: this.toJson({
          manifest: exported.manifest,
          outputHash,
          sample: exported.sample
        })
      }
    });

    await this.transitionDeletionRequestStatus({
      requestId: request.id,
      status: GovernanceRequestStatus.COMPLETED,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: "privacy_export_completed",
      context: input.context,
      metadata: {
        jobId: completed.id,
        outputRef
      }
    });

    await this.emitTrail({
      eventKey: `privacy_export.completed:${completed.id}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "compliance.privacy_export.completed",
      eventType: "privacy_export_completed",
      resourceType: "privacy_export_job",
      resourceId: completed.id,
      severity: SecurityEventSeverity.INFO,
      reason: "privacy_export_completed",
      decisionResult: "COMPLETED",
      context: input.context,
      metadata: {
        outputRef,
        outputHash
      }
    });

    return completed;
  }

  private async processPrivacyDeleteJob(input: {
    requestId: string;
    jobId: string;
    actorType: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    context?: GovernanceContext | null;
  }) {
    const claim = await this.prisma.privacyDeletionJob.updateMany({
      where: {
        id: input.jobId,
        status: {
          in: [PrivacyJobStatus.QUEUED, PrivacyJobStatus.FAILED]
        }
      },
      data: {
        status: PrivacyJobStatus.RUNNING,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
        attempts: { increment: 1 }
      }
    });
    if (claim.count === 0) {
      return this.prisma.privacyDeletionJob.findUnique({ where: { id: input.jobId } });
    }

    await this.transitionDeletionRequestStatus({
      requestId: input.requestId,
      status: GovernanceRequestStatus.RUNNING,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: "privacy_delete_running",
      context: input.context
    });

    await this.emitTrail({
      eventKey: `privacy_delete.start:${input.jobId}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "compliance.privacy_delete.start",
      eventType: "privacy_delete_started",
      resourceType: "privacy_delete_job",
      resourceId: input.jobId,
      severity: SecurityEventSeverity.HIGH,
      reason: "privacy_delete_started",
      context: input.context
    });

    const [job, request] = await Promise.all([
      this.prisma.privacyDeletionJob.findUnique({ where: { id: input.jobId } }),
      this.prisma.deletionRequest.findUnique({ where: { id: input.requestId } })
    ]);
    if (!job || !request) {
      throw new BadRequestException("Privacy delete request/job not found");
    }

    const dataClass = await this.classifyRequest(request);
    const policyDecision = await this.complianceGovernanceService.evaluatePolicy({
      operation: "privacy_delete",
      domain: request.targetDomain,
      dataClass,
      policyVersion: request.policyVersion,
      legalBasisHook: request.legalBasisHook,
      dryRun: job.dryRun,
      scope: {
        requestId: request.id,
        targetEntity: request.targetEntity,
        targetId: request.targetId
      },
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: request.reason,
      context: this.contextFrom(input.context)
    });

    if (!policyDecision.approved) {
      await this.prisma.privacyDeletionJob.update({
        where: { id: job.id },
        data: {
          status: PrivacyJobStatus.FAILED,
          completedAt: new Date(),
          legalHoldBlocked: policyDecision.legalHoldBlocked,
          errorMessage: policyDecision.reason
        }
      });
      await this.transitionDeletionRequestStatus({
        requestId: request.id,
        status: GovernanceRequestStatus.FAILED,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        reason: policyDecision.reason,
        context: input.context,
        metadata: {
          policyDecisionKey: policyDecision.decisionKey
        }
      });
      return {
        status: PrivacyJobStatus.FAILED,
        reason: policyDecision.reason,
        legalHoldBlocked: policyDecision.legalHoldBlocked
      };
    }

    const execution = await this.executeDeletion(request, job);
    const completed = await this.prisma.privacyDeletionJob.update({
      where: { id: job.id },
      data: {
        status: PrivacyJobStatus.COMPLETED,
        completedAt: new Date(),
        legalHoldBlocked: false,
        errorMessage: null,
        deletedCount: execution.deletedCount,
        anonymizedCount: execution.anonymizedCount,
        skippedProtectedCount: execution.skippedProtectedCount,
        metadata: this.toJson({
          details: execution.details
        })
      }
    });

    await this.transitionDeletionRequestStatus({
      requestId: request.id,
      status: GovernanceRequestStatus.COMPLETED,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: "privacy_delete_completed",
      context: input.context,
      metadata: {
        jobId: completed.id,
        deletedCount: execution.deletedCount,
        anonymizedCount: execution.anonymizedCount,
        skippedProtectedCount: execution.skippedProtectedCount
      }
    });

    await this.emitTrail({
      eventKey: `privacy_delete.completed:${completed.id}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "compliance.privacy_delete.completed",
      eventType: "privacy_delete_completed",
      resourceType: "privacy_delete_job",
      resourceId: completed.id,
      severity: SecurityEventSeverity.HIGH,
      reason: "privacy_delete_completed",
      decisionResult: "COMPLETED",
      context: input.context,
      metadata: {
        deletedCount: execution.deletedCount,
        anonymizedCount: execution.anonymizedCount,
        skippedProtectedCount: execution.skippedProtectedCount
      }
    });

    return completed;
  }

  private async processRetentionCleanupJob(input: {
    actorType: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    context?: GovernanceContext | null;
    jobKey: string;
    dryRun: boolean;
    domain?: string | null;
    policyKey?: string | null;
  }) {
    await this.emitTrail({
      eventKey: `retention_cleanup.start:${input.jobKey}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "compliance.retention.cleanup_start",
      eventType: "retention_cleanup_started",
      resourceType: "retention_policy",
      resourceId: input.policyKey ?? input.domain ?? "all",
      reason: input.dryRun ? "retention_cleanup_dry_run_start" : "retention_cleanup_execute_start",
      severity: SecurityEventSeverity.MEDIUM,
      context: input.context,
      metadata: {
        dryRun: input.dryRun,
        jobKey: input.jobKey,
        domain: input.domain,
        policyKey: input.policyKey
      }
    });

    const result = await this.retentionGovernanceService.executeCleanup({
      domain: input.domain ?? null,
      policyKey: input.policyKey ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      dryRun: input.dryRun
    });

    await this.emitTrail({
      eventKey: `retention_cleanup.completed:${input.jobKey}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "compliance.retention.cleanup_completed",
      eventType: "retention_cleanup_completed",
      resourceType: "retention_policy",
      resourceId: input.policyKey ?? input.domain ?? "all",
      reason: result.executed ? "retention_cleanup_executed" : "retention_cleanup_skipped_or_dry_run",
      severity: SecurityEventSeverity.MEDIUM,
      context: input.context,
      metadata: {
        jobKey: input.jobKey,
        dryRun: input.dryRun,
        executed: result.executed,
        deletedTotal: result.deletedTotal ?? 0,
        anonymizedTotal: result.anonymizedTotal ?? 0,
        reportKey: result.report?.reportKey ?? null
      }
    });

    return result;
  }

  private async executeDeletion(
    request: {
      id: string;
      userId: string | null;
      targetDomain: string;
      targetEntity: string | null;
      targetId: string | null;
      dryRun: boolean;
      metadata: unknown;
    },
    job: {
      dryRun: boolean;
    }
  ): Promise<DeletionExecutionResult> {
    const domain = request.targetDomain.trim().toLowerCase();
    const userId = normalize(request.userId) ?? normalize(request.targetId);
    const metadataRecord =
      typeof request.metadata === "object" && request.metadata ? (request.metadata as Record<string, unknown>) : {};
    const allowImmutableDelete =
      parseBoolean(process.env.COMPLIANCE_IMMUTABLE_DELETE_ALLOWED, false) &&
      metadataRecord.allowImmutableDelete === true;

    if (domain === "auth" || domain === "user" || domain === "account") {
      return this.executeUserScopedDeletion({
        userId,
        dryRun: job.dryRun
      });
    }

    if (domain === "research") {
      return this.executeResearchArtifactAnonymization({
        dryRun: job.dryRun,
        targetId: normalize(request.targetId)
      });
    }

    if (domain === "provider") {
      return this.executeProviderPayloadDeletion({
        dryRun: job.dryRun,
        targetEntity: normalize(request.targetEntity),
        targetId: normalize(request.targetId)
      });
    }

    if (domain === "security" || domain === "compliance") {
      return this.executeImmutableSecurityDeletion({
        dryRun: job.dryRun,
        userId,
        allowImmutableDelete
      });
    }

    return {
      deletedCount: 0,
      anonymizedCount: 0,
      skippedProtectedCount: 1,
      details: {
        domain,
        reason: "unsupported_domain_for_destructive_deletion",
        partialDeletionUsed: true
      }
    };
  }

  private async executeProviderPayloadDeletion(input: {
    dryRun: boolean;
    targetEntity?: string | null;
    targetId?: string | null;
  }): Promise<DeletionExecutionResult> {
    const filters: Prisma.RawProviderPayloadWhereInput[] = [];
    if (input.targetId) {
      filters.push({ providerEntityId: input.targetId });
    }
    if (input.targetEntity) {
      filters.push({ entityType: input.targetEntity });
    }
    const where = filters.length > 0 ? { OR: filters } : undefined;
    const candidateCount = await this.prisma.rawProviderPayload.count({
      where
    });
    if (input.dryRun) {
      return {
        deletedCount: candidateCount,
        anonymizedCount: 0,
        skippedProtectedCount: 0,
        details: {
          mode: "dry_run",
          candidateCount
        }
      };
    }
    const deleted = await this.prisma.rawProviderPayload.deleteMany({
      where
    });
    return {
      deletedCount: deleted.count,
      anonymizedCount: 0,
      skippedProtectedCount: 0,
      details: {
        mode: "execute",
        deletedCount: deleted.count
      }
    };
  }

  private async executeResearchArtifactAnonymization(input: {
    dryRun: boolean;
    targetId?: string | null;
  }): Promise<DeletionExecutionResult> {
    const where: Prisma.ResearchRunArtifactWhereInput = input.targetId
      ? { researchRunId: input.targetId }
      : {};
    const candidateCount = await this.prisma.researchRunArtifact.count({ where });
    if (input.dryRun) {
      return {
        deletedCount: 0,
        anonymizedCount: candidateCount,
        skippedProtectedCount: 0,
        details: {
          mode: "dry_run",
          candidateCount
        }
      };
    }

    const anonymized = await this.prisma.researchRunArtifact.updateMany({
      where,
      data: {
        artifactUri: null
      }
    });
    return {
      deletedCount: 0,
      anonymizedCount: anonymized.count,
      skippedProtectedCount: 0,
      details: {
        mode: "execute",
        anonymizedCount: anonymized.count
      }
    };
  }

  private async executeImmutableSecurityDeletion(input: {
    dryRun: boolean;
    userId?: string | null;
    allowImmutableDelete: boolean;
  }): Promise<DeletionExecutionResult> {
    if (!input.userId) {
      return {
        deletedCount: 0,
        anonymizedCount: 0,
        skippedProtectedCount: 0,
        details: {
          reason: "missing_user_scope_for_security_records"
        }
      };
    }

    const [auditCandidates, securityCandidates] = await Promise.all([
      this.prisma.auditEvent.count({
        where: { actorId: input.userId }
      }),
      this.prisma.securityEvent.count({
        where: { actorId: input.userId }
      })
    ]);
    const candidateTotal = auditCandidates + securityCandidates;

    if (!input.allowImmutableDelete) {
      return {
        deletedCount: 0,
        anonymizedCount: 0,
        skippedProtectedCount: candidateTotal,
        details: {
          immutableProtected: true,
          reason: "immutable_security_records_protected",
          candidateTotal
        }
      };
    }

    if (input.dryRun) {
      return {
        deletedCount: candidateTotal,
        anonymizedCount: 0,
        skippedProtectedCount: 0,
        details: {
          mode: "dry_run",
          candidateTotal,
          immutableDeletionPath: true
        }
      };
    }

    const [auditDeleted, securityDeleted] = await this.prisma.$transaction([
      this.prisma.auditEvent.deleteMany({
        where: { actorId: input.userId }
      }),
      this.prisma.securityEvent.deleteMany({
        where: { actorId: input.userId }
      })
    ]);

    return {
      deletedCount: auditDeleted.count + securityDeleted.count,
      anonymizedCount: 0,
      skippedProtectedCount: 0,
      details: {
        immutableDeletionPath: true,
        auditDeleted: auditDeleted.count,
        securityDeleted: securityDeleted.count
      }
    };
  }

  private async executeUserScopedDeletion(input: {
    userId?: string | null;
    dryRun: boolean;
  }): Promise<DeletionExecutionResult> {
    const userId = normalize(input.userId);
    if (!userId) {
      return {
        deletedCount: 0,
        anonymizedCount: 0,
        skippedProtectedCount: 0,
        details: {
          reason: "missing_user_id"
        }
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true }
    });
    if (!user) {
      return {
        deletedCount: 0,
        anonymizedCount: 0,
        skippedProtectedCount: 0,
        details: {
          reason: "user_not_found"
        }
      };
    }

    const [sessionCount, refreshTokenCount, refreshFamilyCount, adminSessionCount, challengeCount, loginAttemptCount, authRiskCount, refreshEventCount, consentCount] =
      await Promise.all([
        this.prisma.authSession.count({ where: { userId } }),
        this.prisma.refreshToken.count({ where: { userId } }),
        this.prisma.refreshTokenFamily.count({ where: { userId } }),
        this.prisma.adminAccessSession.count({ where: { userId } }),
        this.prisma.adminStepUpChallenge.count({ where: { userId } }),
        this.prisma.loginAttempt.count({ where: { userId } }),
        this.prisma.authRiskEvent.count({ where: { userId } }),
        this.prisma.refreshTokenEvent.count({ where: { userId } }),
        this.prisma.consentRecord.count({ where: { userId } })
      ]);

    if (input.dryRun) {
      return {
        deletedCount: refreshTokenCount + refreshFamilyCount + sessionCount + adminSessionCount + challengeCount,
        anonymizedCount: loginAttemptCount + authRiskCount + refreshEventCount + consentCount + 1,
        skippedProtectedCount: 0,
        details: {
          mode: "dry_run",
          candidate: {
            sessionCount,
            refreshTokenCount,
            refreshFamilyCount,
            adminSessionCount,
            challengeCount,
            loginAttemptCount,
            authRiskCount,
            refreshEventCount,
            consentCount
          }
        }
      };
    }

    const anonymized = this.dataMinimizationService.anonymizeUserProfile({
      userId,
      email: user.email
    });
    const deletedPasswordHash = `deleted:${this.hash(userId).slice(0, 32)}`;

    const [
      deletedTokens,
      deletedFamilies,
      deletedSessions,
      deletedAdminSessions,
      deletedChallenges,
      anonymizedLoginAttempts,
      anonymizedAuthRiskEvents,
      anonymizedRefreshEvents,
      anonymizedConsentRecords,
      anonymizedDeletionRequests,
      anonymizedDataAccessRequests,
      anonymizedExportJobs,
      anonymizedDeletionJobs,
      anonymizedUser
    ] = await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { userId }
      }),
      this.prisma.refreshTokenFamily.deleteMany({
        where: { userId }
      }),
      this.prisma.authSession.deleteMany({
        where: { userId }
      }),
      this.prisma.adminAccessSession.deleteMany({
        where: { userId }
      }),
      this.prisma.adminStepUpChallenge.deleteMany({
        where: { userId }
      }),
      this.prisma.loginAttempt.updateMany({
        where: { userId },
        data: {
          userId: null,
          email: anonymized.email
        }
      }),
      this.prisma.authRiskEvent.updateMany({
        where: { userId },
        data: {
          userId: null,
          ipAddress: null
        }
      }),
      this.prisma.refreshTokenEvent.updateMany({
        where: { userId },
        data: {
          userId: null,
          ipAddress: null
        }
      }),
      this.prisma.consentRecord.updateMany({
        where: { userId },
        data: {
          userId: null
        }
      }),
      this.prisma.deletionRequest.updateMany({
        where: { userId },
        data: {
          userId: null
        }
      }),
      this.prisma.dataAccessRequest.updateMany({
        where: { userId },
        data: {
          userId: null
        }
      }),
      this.prisma.privacyExportJob.updateMany({
        where: { userId },
        data: {
          userId: null
        }
      }),
      this.prisma.privacyDeletionJob.updateMany({
        where: { userId },
        data: {
          userId: null
        }
      }),
      this.prisma.user.updateMany({
        where: { id: userId },
        data: {
          email: anonymized.email ?? `deleted+${this.hash(userId).slice(0, 12)}@redacted.local`,
          passwordHash: deletedPasswordHash,
          isActive: false
        }
      })
    ]);

    return {
      deletedCount:
        deletedTokens.count +
        deletedFamilies.count +
        deletedSessions.count +
        deletedAdminSessions.count +
        deletedChallenges.count,
      anonymizedCount:
        anonymizedLoginAttempts.count +
        anonymizedAuthRiskEvents.count +
        anonymizedRefreshEvents.count +
        anonymizedConsentRecords.count +
        anonymizedDeletionRequests.count +
        anonymizedDataAccessRequests.count +
        anonymizedExportJobs.count +
        anonymizedDeletionJobs.count +
        anonymizedUser.count,
      skippedProtectedCount: 0,
      details: {
        mode: "execute",
        userId,
        deleted: {
          refreshTokens: deletedTokens.count,
          refreshTokenFamilies: deletedFamilies.count,
          authSessions: deletedSessions.count,
          adminAccessSessions: deletedAdminSessions.count,
          adminStepUpChallenges: deletedChallenges.count
        },
        anonymized: {
          loginAttempts: anonymizedLoginAttempts.count,
          authRiskEvents: anonymizedAuthRiskEvents.count,
          refreshTokenEvents: anonymizedRefreshEvents.count,
          consentRecords: anonymizedConsentRecords.count,
          deletionRequests: anonymizedDeletionRequests.count,
          dataAccessRequests: anonymizedDataAccessRequests.count,
          privacyExportJobs: anonymizedExportJobs.count,
          privacyDeletionJobs: anonymizedDeletionJobs.count,
          users: anonymizedUser.count
        }
      }
    };
  }

  private async buildDataAccessReceipt(input: {
    userId?: string | null;
    targetDomain: string;
    targetEntity?: string | null;
    targetId?: string | null;
  }) {
    const userId = normalize(input.userId);
    if (!userId) {
      return {
        targetDomain: input.targetDomain,
        targetEntity: input.targetEntity,
        targetId: input.targetId,
        generatedAt: new Date().toISOString(),
        note: "No user scope attached"
      };
    }

    const [deletionRequests, accessRequests, consents] = await Promise.all([
      this.prisma.deletionRequest.count({ where: { userId } }),
      this.prisma.dataAccessRequest.count({ where: { userId } }),
      this.prisma.consentRecord.count({ where: { userId } })
    ]);

    return {
      userId,
      targetDomain: input.targetDomain,
      targetEntity: input.targetEntity,
      targetId: input.targetId,
      generatedAt: new Date().toISOString(),
      references: {
        deletionRequests,
        dataAccessRequests: accessRequests,
        consentRecords: consents
      }
    };
  }

  private async buildExportPayload(request: {
    userId: string | null;
    targetDomain: string;
    targetEntity: string | null;
    targetId: string | null;
  }) {
    const domain = request.targetDomain.trim().toLowerCase();
    const userId = normalize(request.userId) ?? normalize(request.targetId);

    if (domain === "auth" || domain === "user" || domain === "account") {
      const [user, sessions, loginAttempts, refreshEvents, consents] = await Promise.all([
        userId
          ? this.prisma.user.findUnique({
              where: { id: userId },
              select: {
                id: true,
                email: true,
                isActive: true,
                roleId: true,
                createdAt: true,
                updatedAt: true
              }
            })
          : null,
        userId
          ? this.prisma.authSession.findMany({
              where: { userId },
              orderBy: { createdAt: "desc" },
              take: 400,
              select: {
                id: true,
                actorType: true,
                status: true,
                environment: true,
                createdAt: true,
                lastSeenAt: true,
                expiresAt: true,
                revokedAt: true
              }
            })
          : [],
        userId
          ? this.prisma.loginAttempt.findMany({
              where: { userId },
              orderBy: { createdAt: "desc" },
              take: 400,
              select: {
                id: true,
                result: true,
                reason: true,
                email: true,
                createdAt: true
              }
            })
          : [],
        userId
          ? this.prisma.refreshTokenEvent.findMany({
              where: { userId },
              orderBy: { createdAt: "desc" },
              take: 400,
              select: {
                id: true,
                eventType: true,
                reason: true,
                createdAt: true
              }
            })
          : [],
        userId
          ? this.prisma.consentRecord.findMany({
              where: { userId },
              orderBy: { createdAt: "desc" },
              take: 400
            })
          : []
      ]);

      const sample = this.dataMinimizationService.sanitizeLogRecord({
        user,
        sessions: sessions.slice(0, 5),
        loginAttempts: loginAttempts.slice(0, 5),
        refreshEvents: refreshEvents.slice(0, 5),
        consents: consents.slice(0, 5)
      });

      return {
        manifest: {
          domain,
          userId,
          totals: {
            sessions: sessions.length,
            loginAttempts: loginAttempts.length,
            refreshEvents: refreshEvents.length,
            consentRecords: consents.length
          }
        },
        sample
      };
    }

    if (domain === "provider") {
      const payloads = await this.prisma.rawProviderPayload.findMany({
        where: {
          ...(request.targetId ? { providerEntityId: request.targetId } : {}),
          ...(request.targetEntity ? { entityType: request.targetEntity } : {})
        },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          id: true,
          provider: true,
          entityType: true,
          providerEntityId: true,
          sourceUpdatedAt: true,
          pulledAt: true,
          createdAt: true
        }
      });

      return {
        manifest: {
          domain,
          totals: {
            payloads: payloads.length
          }
        },
        sample: payloads.slice(0, 10)
      };
    }

    if (domain === "prediction") {
      const predictions = await this.prisma.predictionRun.findMany({
        where: {
          ...(request.targetId ? { matchId: request.targetId } : {}),
          ...(request.targetEntity ? { market: request.targetEntity } : {})
        },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          id: true,
          matchId: true,
          market: true,
          line: true,
          horizon: true,
          probability: true,
          confidence: true,
          createdAt: true
        }
      });

      return {
        manifest: {
          domain,
          totals: {
            predictions: predictions.length
          }
        },
        sample: predictions.slice(0, 10)
      };
    }

    if (domain === "research") {
      const artifacts = await this.prisma.researchRunArtifact.findMany({
        where: {
          ...(request.targetId ? { researchRunId: request.targetId } : {}),
          ...(request.targetEntity ? { artifactType: request.targetEntity } : {})
        },
        orderBy: { createdAt: "desc" },
        take: 400,
        select: {
          id: true,
          researchRunId: true,
          artifactType: true,
          artifactKey: true,
          artifactUri: true,
          createdAt: true
        }
      });

      return {
        manifest: {
          domain,
          totals: {
            artifacts: artifacts.length
          }
        },
        sample: artifacts.slice(0, 10).map((item) => ({
          ...item,
          artifactUri: item.artifactUri ? this.dataMinimizationService.maskValue(item.artifactUri) : null
        }))
      };
    }

    if (domain === "security" || domain === "compliance") {
      const [auditCount, securityCount, abuseCount] = await Promise.all([
        this.prisma.auditEvent.count({
          where: userId ? { actorId: userId } : undefined
        }),
        this.prisma.securityEvent.count({
          where: userId ? { actorId: userId } : undefined
        }),
        this.prisma.abuseEvent.count({
          where: userId ? { actorId: userId } : undefined
        })
      ]);

      return {
        manifest: {
          domain,
          immutable: true,
          totals: {
            auditEvents: auditCount,
            securityEvents: securityCount,
            abuseEvents: abuseCount
          }
        },
        sample: {
          note: "Immutable security records are exported as aggregate metadata in v1."
        }
      };
    }

    if (domain === "bankroll") {
      const accounts = await this.prisma.bankrollAccount.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          name: true,
          mode: true,
          status: true,
          createdAt: true
        }
      });

      return {
        manifest: {
          domain,
          totals: {
            accounts: accounts.length
          }
        },
        sample: accounts.slice(0, 10)
      };
    }

    return {
      manifest: {
        domain,
        note: "No domain-specific export mapper configured."
      },
      sample: {}
    };
  }

  async onModuleInit() {
    if (!this.shouldRunWorker()) {
      return;
    }
    await this.startWorker().catch((error) => {
      this.logger.error(
        `Privacy governance worker bootstrap failed: ${error instanceof Error ? error.message : "unknown"}`,
        error instanceof Error ? error.stack : undefined
      );
    });
  }

  async onModuleDestroy() {
    if (!this.worker) {
      return;
    }
    const worker = this.worker;
    this.worker = null;
    await worker.close().catch(() => undefined);
  }

  async startWorker() {
    if (this.worker) {
      return;
    }
    if (this.workerStartPromise) {
      await this.workerStartPromise;
      return;
    }

    this.workerStartPromise = this.startWorkerInternal();
    try {
      await this.workerStartPromise;
    } finally {
      this.workerStartPromise = null;
    }
  }

  private async startWorkerInternal() {
    if (this.worker) {
      return;
    }

    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    const parsedConcurrency = Number(process.env.PRIVACY_GOVERNANCE_WORKER_CONCURRENCY ?? 1);
    const concurrency =
      Number.isFinite(parsedConcurrency) && parsedConcurrency > 0
        ? Math.max(1, Math.min(4, Math.floor(parsedConcurrency)))
        : 1;

    const worker = new Worker(
      PRIVACY_GOVERNANCE_QUEUE,
      async (job) => {
        return this.processQueuePayload(job.name, (job.data ?? {}) as QueuePayloadBase);
      },
      {
        connection: { url },
        concurrency
      }
    );

    worker.on("error", (error) => {
      this.logger.error(
        "Privacy governance worker error",
        error instanceof Error ? error.stack : undefined
      );
    });

    worker.on("closed", () => {
      if (this.worker === worker) {
        this.worker = null;
      }
      this.logger.warn("Privacy governance worker closed");
    });

    try {
      await worker.waitUntilReady();
    } catch (error) {
      await worker.close().catch(() => undefined);
      throw error;
    }

    this.worker = worker;
    this.logger.log(`Privacy governance worker started (queue=${PRIVACY_GOVERNANCE_QUEUE}, concurrency=${concurrency})`);
  }
}
