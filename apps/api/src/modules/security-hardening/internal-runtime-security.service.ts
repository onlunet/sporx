import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { AccessActorType, AbuseEventType, QueueAccessScopeClass, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityEventService } from "../security-events/security-event.service";
import { QueueAuthorizationInput, QueuePayloadValidationInput, QueuePayloadValidationResult, QueueScopeInput } from "./security-hardening.types";

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
export class InternalRuntimeSecurityService {
  private readonly privilegedJobs = new Set(["publishDecision", "publicPublish", "bankrollAccounting", "invalidateCache"]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService
  ) {}

  isQueueSecurityEnforced() {
    return parseBoolean(process.env.QUEUE_SECURITY_ENFORCED, true);
  }

  resolveEnvironment(value?: string | null) {
    const env = normalize(value) ?? normalize(process.env.APP_ENV) ?? normalize(process.env.NODE_ENV) ?? "development";
    if (env === "production" || env === "staging") {
      return env;
    }
    return "development";
  }

  resolveServiceIdentity(fallback = "api") {
    return (
      normalize(process.env.SERVICE_IDENTITY) ??
      normalize(process.env.SERVICE_ROLE) ??
      fallback
    );
  }

  private normalizeAllowedJobs(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }

  private matchJobPattern(jobName: string, pattern: string) {
    if (pattern === "*") {
      return true;
    }
    if (!pattern.includes("*")) {
      return jobName === pattern;
    }
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(jobName);
  }

  async assertQueueAccess(input: QueueAuthorizationInput) {
    if (!this.isQueueSecurityEnforced()) {
      return;
    }

    const environment = this.resolveEnvironment(input.environment);
    const serviceIdentityId = normalize(input.serviceIdentityId);
    if (!serviceIdentityId) {
      throw new ForbiddenException("Missing service identity");
    }

    const scope = await this.prisma.queueAccessScope.findUnique({
      where: {
        queueName_serviceIdentityId_environment: {
          queueName: input.queueName,
          serviceIdentityId,
          environment
        }
      }
    });

    if (!scope) {
      if (environment === "production") {
        throw new ForbiddenException("Queue access scope missing");
      }
      return;
    }

    const modeAllowed = input.mode === "enqueue" ? scope.allowEnqueue : scope.allowProcess;
    if (!modeAllowed) {
      throw new ForbiddenException("Queue access denied");
    }

    if (input.jobName) {
      const allowedJobs = this.normalizeAllowedJobs(scope.allowedJobsJson);
      if (allowedJobs.length > 0 && !allowedJobs.some((pattern) => this.matchJobPattern(input.jobName as string, pattern))) {
        throw new ForbiddenException("Queue job scope denied");
      }
    }
  }

  private validatePayload(payload: Record<string, unknown>) {
    const keys = Object.keys(payload);
    if (keys.length === 0) {
      throw new BadRequestException("Queue payload is empty");
    }
    if (keys.length > 80) {
      throw new BadRequestException("Queue payload has too many fields");
    }
    if (typeof payload.runId !== "string" || payload.runId.trim().length < 3) {
      throw new BadRequestException("Queue payload missing runId");
    }
    const authority = normalize(typeof payload.authority === "string" ? payload.authority : null);
    if (authority?.toLowerCase() === "public") {
      throw new ForbiddenException("Public authority cannot trigger privileged queue jobs");
    }
  }

  async validateQueuePayload(input: QueuePayloadValidationInput): Promise<QueuePayloadValidationResult> {
    const serviceIdentityId = normalize(input.serviceIdentityId) ?? this.resolveServiceIdentity("api") ?? "api";
    if (!/^[a-zA-Z0-9:_-]{2,120}$/.test(input.jobName)) {
      throw new BadRequestException("Invalid queue job name");
    }
    this.validatePayload(input.payload);
    await this.assertQueueAccess({
      queueName: input.queueName,
      serviceIdentityId,
      mode: input.mode,
      jobName: input.jobName
    });

    const normalized = { ...input.payload, serviceIdentityId };

    if (this.privilegedJobs.has(input.jobName)) {
      const runId = (normalized as Record<string, unknown>).runId;
      await this.securityEventService.emitAuditEvent({
        eventKey: `audit:queue_privileged:${input.mode}:${input.queueName}:${input.jobName}:${String(runId ?? "unknown")}`,
        actorType: AccessActorType.SERVICE,
        serviceIdentityId,
        action: input.mode === "enqueue" ? "queue.privileged.enqueue" : "queue.privileged.execute",
        resourceType: "queue_job",
        resourceId: `${input.queueName}:${input.jobName}`,
        severity: SecurityEventSeverity.HIGH,
        reason: "privileged_operational_job",
        context: input.context,
        metadata: {
          runId: runId ?? null,
          queueName: input.queueName,
          jobName: input.jobName
        }
      });
    }

    return {
      queueName: input.queueName,
      jobName: input.jobName,
      serviceIdentityId,
      payload: normalized
    };
  }

  async quarantinePoisonJob(input: {
    queueName: string;
    jobName: string;
    reason: string;
    payload?: Record<string, unknown> | null;
    serviceIdentityId?: string | null;
  }) {
    await this.securityEventService.emitAbuseEvent({
      eventType: AbuseEventType.QUEUE_INVOCATION_ANOMALY,
      sourceDomain: SecurityEventSourceDomain.QUEUE,
      severity: SecurityEventSeverity.HIGH,
      actorType: AccessActorType.SERVICE,
      serviceIdentityId: input.serviceIdentityId ?? null,
      targetResourceType: "queue_job",
      targetResourceId: `${input.queueName}:${input.jobName}`,
      reason: input.reason,
      metadata: {
        queueName: input.queueName,
        jobName: input.jobName,
        payloadKeys: Object.keys(input.payload ?? {})
      }
    });
  }

  async upsertQueueScope(input: QueueScopeInput) {
    return this.prisma.queueAccessScope.upsert({
      where: {
        queueName_serviceIdentityId_environment: {
          queueName: input.queueName,
          serviceIdentityId: input.serviceIdentityId,
          environment: this.resolveEnvironment(input.environment)
        }
      },
      update: {
        scopeClass: input.scopeClass,
        allowEnqueue: input.allowEnqueue,
        allowProcess: input.allowProcess,
        allowedJobsJson: (input.allowedJobs ?? null) as any,
        metadata: (input.metadata ?? null) as any
      },
      create: {
        queueName: input.queueName,
        serviceIdentityId: input.serviceIdentityId,
        scopeClass: input.scopeClass,
        allowEnqueue: input.allowEnqueue,
        allowProcess: input.allowProcess,
        allowedJobsJson: (input.allowedJobs ?? null) as any,
        environment: this.resolveEnvironment(input.environment),
        metadata: (input.metadata ?? null) as any
      }
    });
  }

  async listQueueSecurityOverview() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [scopes, anomalies] = await Promise.all([
      this.prisma.queueAccessScope.findMany({
        orderBy: [{ queueName: "asc" }, { serviceIdentityId: "asc" }]
      }),
      this.prisma.abuseEvent.count({
        where: {
          eventType: AbuseEventType.QUEUE_INVOCATION_ANOMALY,
          createdAt: { gte: since }
        }
      })
    ]);

    const byClass: Record<QueueAccessScopeClass, number> = {
      OPERATIONAL: 0,
      RESEARCH: 0,
      BACKGROUND: 0
    };
    for (const item of scopes) {
      byClass[item.scopeClass] += 1;
    }

    return {
      queueScopes: scopes,
      summary: {
        totalScopes: scopes.length,
        anomaliesLast24h: anomalies,
        byClass
      }
    };
  }
}
