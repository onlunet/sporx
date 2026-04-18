import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessActorType, AuthActorType, IncidentStatus, QueueAccessScopeClass, SecretCategory, SecretLifecycleStatus, SecurityAlertStatus, SecurityEventSeverity } from "@prisma/client";
import { IsArray, IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { RequireAccessPermission } from "../../common/decorators/access-permission.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { AccessGovernanceService } from "../access-governance/access-governance.service";
import { AccessActor } from "../access-governance/access-governance.types";
import { APISecurityService } from "../security-hardening/api-security.service";
import { InternalRuntimeSecurityService } from "../security-hardening/internal-runtime-security.service";
import { RuntimeHardeningService } from "../security-hardening/runtime-hardening.service";
import { SecretGovernanceService } from "../security-hardening/secret-governance.service";
import { SupplyChainSecurityService } from "../security-hardening/supply-chain-security.service";
import { IncidentReadinessService } from "../security-events/incident-readiness.service";
import { SecurityEventService } from "../security-events/security-event.service";

type RequestUser = {
  id: string;
  role: string;
};

class OpenIncidentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsEnum(SecurityEventSeverity)
  severity!: SecurityEventSeverity;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class TransitionIncidentDto {
  @IsEnum(IncidentStatus)
  status!: IncidentStatus;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class IncidentNoteDto {
  @IsString()
  @IsNotEmpty()
  note!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class AlertStatusDto {
  @IsEnum(SecurityAlertStatus)
  status!: SecurityAlertStatus;
}

class EmergencyControlToggleDto {
  @IsString()
  @IsNotEmpty()
  control!: "disable_refresh_global" | "disable_admin_write_actions" | "admin_read_only_mode" | "disabled_provider_path" | "feature_flag_rollback";

  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  incidentId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class RevokeSessionsByScopeDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsEnum(AuthActorType)
  actorType?: AuthActorType;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  incidentId?: string;
}

class SecretRotationMetadataDto {
  @IsEnum(SecretCategory)
  category!: SecretCategory;

  @IsString()
  @IsNotEmpty()
  secretRef!: string;

  @IsEnum(SecretLifecycleStatus)
  lifecycleStatus!: SecretLifecycleStatus;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsDateString()
  plannedAt?: string;

  @IsOptional()
  @IsDateString()
  activatedAt?: string;

  @IsOptional()
  @IsDateString()
  retiringAt?: string;

  @IsOptional()
  @IsDateString()
  revokedAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class QueueScopeUpsertDto {
  @IsString()
  @IsNotEmpty()
  queueName!: string;

  @IsString()
  @IsNotEmpty()
  serviceIdentityId!: string;

  @IsEnum(QueueAccessScopeClass)
  scopeClass!: QueueAccessScopeClass;

  @IsBoolean()
  allowEnqueue!: boolean;

  @IsBoolean()
  allowProcess!: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedJobs?: string[];

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class VulnerabilityIgnoreDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

@Controller("admin/security")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminSecurityEventsController {
  constructor(
    private readonly securityEventService: SecurityEventService,
    private readonly incidentReadinessService: IncidentReadinessService,
    private readonly accessGovernanceService: AccessGovernanceService,
    private readonly secretGovernanceService: SecretGovernanceService,
    private readonly apiSecurityService: APISecurityService,
    private readonly internalRuntimeSecurityService: InternalRuntimeSecurityService,
    private readonly runtimeHardeningService: RuntimeHardeningService,
    private readonly supplyChainSecurityService: SupplyChainSecurityService
  ) {}

  private async resolveActor(request: any): Promise<AccessActor> {
    const resolved = await this.accessGovernanceService.resolveActorFromRequest(request);
    if (resolved) {
      return resolved;
    }

    const user = request.user as RequestUser | undefined;
    if (!user?.id) {
      throw new ForbiddenException("Access denied");
    }
    return {
      actorType: AccessActorType.ADMIN,
      userId: user.id,
      role: user.role,
      environment: this.accessGovernanceService.resolveEnvironment(request),
      ipAddress: this.accessGovernanceService.parseClientIp(request)
    };
  }

  @Get("audit-events")
  @RequireAccessPermission({
    permission: "security.audit.read",
    resourceType: "security",
    action: "read"
  })
  auditEvents(@Query("limit") limit?: string) {
    return this.securityEventService.listAuditEvents(Number.parseInt(limit ?? "200", 10));
  }

  @Get("events")
  @RequireAccessPermission({
    permission: "security.events.read",
    resourceType: "security",
    action: "read"
  })
  securityEvents(@Query("limit") limit?: string) {
    return this.securityEventService.listSecurityEvents(Number.parseInt(limit ?? "200", 10));
  }

  @Get("alerts")
  @RequireAccessPermission({
    permission: "security.alerts.read",
    resourceType: "security",
    action: "read"
  })
  securityAlerts(@Query("limit") limit?: string) {
    return this.securityEventService.listSecurityAlerts(Number.parseInt(limit ?? "200", 10));
  }

  @Patch("alerts/:alertId/status")
  @RequireAccessPermission({
    permission: "security.alerts.update",
    resourceType: "security",
    action: "update"
  })
  updateAlertStatus(@Param("alertId") alertId: string, @Body() body: AlertStatusDto, @Req() request: { user: RequestUser }) {
    return this.securityEventService.updateAlertStatus(alertId, body.status, request.user.id);
  }

  @Get("abuse")
  @RequireAccessPermission({
    permission: "security.abuse.read",
    resourceType: "security",
    action: "read"
  })
  abuseEvents(@Query("limit") limit?: string) {
    return this.securityEventService.listAbuseEvents(Number.parseInt(limit ?? "200", 10));
  }

  @Get("privileged-history")
  @RequireAccessPermission({
    permission: "security.privileged_history.read",
    resourceType: "security",
    action: "read"
  })
  privilegedHistory(@Query("limit") limit?: string) {
    return this.securityEventService.listPrivilegedActionHistory(Number.parseInt(limit ?? "200", 10));
  }

  @Get("incidents")
  @RequireAccessPermission({
    permission: "security.incidents.read",
    resourceType: "security",
    action: "read"
  })
  incidents(@Query("limit") limit?: string) {
    return this.incidentReadinessService.listIncidents(Number.parseInt(limit ?? "200", 10));
  }

  @Get("incidents/:incidentId/timeline")
  @RequireAccessPermission({
    permission: "security.incidents.read",
    resourceType: "security",
    action: "read"
  })
  incidentTimeline(@Param("incidentId") incidentId: string, @Query("limit") limit?: string) {
    return this.incidentReadinessService.getIncidentTimeline(incidentId, Number.parseInt(limit ?? "500", 10));
  }

  @Post("incidents/open")
  @RequireAccessPermission({
    permission: "security.incidents.write",
    resourceType: "security",
    action: "create"
  })
  async openIncident(@Body() body: OpenIncidentDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);

    return this.incidentReadinessService.openIncident({
      title: body.title,
      note: body.note ?? null,
      severity: body.severity,
      ownerUserId: body.ownerUserId ?? request.user?.id ?? null,
      actorType: actor.actorType,
      actorId: actor.userId ?? request.user?.id ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      reason: body.reason ?? null,
      context,
      metadata: body.metadata ?? null
    });
  }

  @Post("incidents/:incidentId/transition")
  @RequireAccessPermission({
    permission: "security.incidents.write",
    resourceType: "security",
    action: "update"
  })
  async transitionIncident(@Param("incidentId") incidentId: string, @Body() body: TransitionIncidentDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    return this.incidentReadinessService.transitionIncident({
      incidentId,
      status: body.status,
      actorType: actor.actorType,
      actorId: actor.userId ?? request.user?.id ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      ownerUserId: body.ownerUserId ?? null,
      note: body.note ?? null,
      reason: body.reason ?? null,
      context,
      metadata: body.metadata ?? null
    });
  }

  @Post("incidents/:incidentId/note")
  @RequireAccessPermission({
    permission: "security.incidents.write",
    resourceType: "security",
    action: "update"
  })
  async addIncidentNote(@Param("incidentId") incidentId: string, @Body() body: IncidentNoteDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    return this.incidentReadinessService.addIncidentNote({
      incidentId,
      note: body.note,
      actorType: actor.actorType,
      actorId: actor.userId ?? request.user?.id ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      reason: body.reason ?? null,
      context,
      metadata: body.metadata ?? null
    });
  }

  @Get("emergency-controls")
  @RequireAccessPermission({
    permission: "security.emergency.read",
    resourceType: "security",
    action: "read"
  })
  emergencyControls() {
    return this.incidentReadinessService.getEmergencyControlStatus();
  }

  @Post("emergency-controls/toggle")
  @RequireAccessPermission({
    permission: "security.emergency.write",
    resourceType: "security",
    action: "update"
  })
  async toggleEmergencyControl(@Body() body: EmergencyControlToggleDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    return this.incidentReadinessService.activateEmergencyControl({
      control: body.control,
      enabled: body.enabled,
      actorType: actor.actorType,
      actorId: actor.userId ?? request.user?.id ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      reason: body.reason,
      incidentId: body.incidentId ?? null,
      context,
      metadata: body.metadata ?? null
    });
  }

  @Post("emergency-controls/revoke-sessions")
  @RequireAccessPermission({
    permission: "security.emergency.revoke_sessions",
    resourceType: "security",
    action: "update"
  })
  async revokeSessionsByScope(@Body() body: RevokeSessionsByScopeDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    return this.incidentReadinessService.revokeSessionsByScope({
      actorType: actor.actorType,
      actorId: actor.userId ?? request.user?.id ?? null,
      reason: body.reason,
      scope: {
        actorType: body.actorType ?? null,
        userId: body.userId ?? null,
        environment: body.environment ?? null
      },
      incidentId: body.incidentId ?? null,
      context
    });
  }

  @Get("phase4/secret-rotations")
  @RequireAccessPermission({
    permission: "security.secrets.read",
    resourceType: "security",
    action: "read"
  })
  secretRotations(@Query("limit") limit?: string) {
    return this.secretGovernanceService.listRotationEvents(Number.parseInt(limit ?? "200", 10));
  }

  @Post("phase4/secret-rotations")
  @RequireAccessPermission({
    permission: "security.secrets.write",
    resourceType: "security",
    action: "create"
  })
  async createSecretRotation(@Body() body: SecretRotationMetadataDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    return this.secretGovernanceService.recordSecretRotation({
      category: body.category,
      secretRef: body.secretRef,
      lifecycleStatus: body.lifecycleStatus,
      reason: body.reason ?? null,
      plannedAt: body.plannedAt ? new Date(body.plannedAt) : null,
      activatedAt: body.activatedAt ? new Date(body.activatedAt) : null,
      retiringAt: body.retiringAt ? new Date(body.retiringAt) : null,
      revokedAt: body.revokedAt ? new Date(body.revokedAt) : null,
      actorType: actor.actorType,
      actorId: actor.userId ?? request.user?.id ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      context,
      metadata: body.metadata ?? null
    });
  }

  @Get("phase4/runtime-status")
  @RequireAccessPermission({
    permission: "security.runtime.read",
    resourceType: "security",
    action: "read"
  })
  runtimeStatus() {
    return this.runtimeHardeningService.getLatestStartupReport();
  }

  @Get("phase4/environment-checks")
  @RequireAccessPermission({
    permission: "security.runtime.read",
    resourceType: "security",
    action: "read"
  })
  environmentChecks() {
    return this.runtimeHardeningService.runStartupChecks();
  }

  @Get("phase4/rate-limit-buckets")
  @RequireAccessPermission({
    permission: "security.abuse.read",
    resourceType: "security",
    action: "read"
  })
  rateLimitBuckets(@Query("limit") limit?: string) {
    return this.apiSecurityService.listRateLimitBuckets(Number.parseInt(limit ?? "200", 10));
  }

  @Get("phase4/queue-security")
  @RequireAccessPermission({
    permission: "security.queue.read",
    resourceType: "security",
    action: "read"
  })
  queueSecurityOverview() {
    return this.internalRuntimeSecurityService.listQueueSecurityOverview();
  }

  @Post("phase4/queue-security/scopes")
  @RequireAccessPermission({
    permission: "security.queue.write",
    resourceType: "security",
    action: "update"
  })
  upsertQueueScope(@Body() body: QueueScopeUpsertDto) {
    return this.internalRuntimeSecurityService.upsertQueueScope({
      queueName: body.queueName,
      serviceIdentityId: body.serviceIdentityId,
      scopeClass: body.scopeClass,
      allowEnqueue: body.allowEnqueue,
      allowProcess: body.allowProcess,
      allowedJobs: body.allowedJobs ?? null,
      environment: body.environment ?? "development",
      metadata: body.metadata ?? null
    });
  }

  @Get("phase4/vulnerabilities")
  @RequireAccessPermission({
    permission: "security.vulnerability.read",
    resourceType: "security",
    action: "read"
  })
  vulnerabilityDashboard(@Query("limit") limit?: string) {
    return this.supplyChainSecurityService.listVulnerabilityDashboard(Number.parseInt(limit ?? "300", 10));
  }

  @Post("phase4/vulnerabilities/:findingId/ignore")
  @RequireAccessPermission({
    permission: "security.vulnerability.write",
    resourceType: "security",
    action: "update"
  })
  ignoreVulnerability(@Param("findingId") findingId: string, @Body() body: VulnerabilityIgnoreDto) {
    return this.supplyChainSecurityService.ignoreFindingWithExpiry({
      findingId,
      reason: body.reason,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
    });
  }

  @Get("phase4/release-attestations")
  @RequireAccessPermission({
    permission: "security.release.read",
    resourceType: "security",
    action: "read"
  })
  releaseAttestations(@Query("limit") limit?: string) {
    return this.runtimeHardeningService.listReleaseAttestations(Number.parseInt(limit ?? "200", 10));
  }

  @Get("phase4/dependency-snapshots/capture")
  @RequireAccessPermission({
    permission: "security.vulnerability.write",
    resourceType: "security",
    action: "create"
  })
  captureDependencySnapshot() {
    return this.supplyChainSecurityService.captureDependencyInventorySnapshot("monorepo");
  }
}
