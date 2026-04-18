import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessActorType, GovernanceRequestStatus, GovernanceRequestType, LegalBasisHook, PrivacyJobStatus } from "@prisma/client";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength
} from "class-validator";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { RequireAccessPermission } from "../../common/decorators/access-permission.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessGovernanceService } from "../access-governance/access-governance.service";
import { AccessActor } from "../access-governance/access-governance.types";
import { RuntimeHardeningService } from "../security-hardening/runtime-hardening.service";
import { SupplyChainSecurityService } from "../security-hardening/supply-chain-security.service";
import { SecurityEventService } from "../security-events/security-event.service";
import { ComplianceGovernanceService } from "../privacy-governance/compliance-governance.service";
import { DataClassificationService } from "../privacy-governance/data-classification.service";
import { PrivacyRequestService } from "../privacy-governance/privacy-request.service";
import { RetentionGovernanceService } from "../privacy-governance/retention-governance.service";

type RequestUser = {
  id: string;
  role: string;
};

class PrivacyRequestDto {
  @IsOptional()
  @IsString()
  requestKey?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  targetDomain!: string;

  @IsOptional()
  @IsString()
  targetEntity?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsEnum(LegalBasisHook)
  legalBasisHook?: LegalBasisHook;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class RetentionDryRunDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  policyKey?: string;
}

class RetentionExecuteDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  policyKey?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsBoolean()
  asyncMode?: boolean;
}

class UpdateLegalHoldDomainsDto {
  @IsArray()
  @IsString({ each: true })
  domains!: string[];
}

@Controller("admin/security/compliance")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminComplianceGovernanceController {
  constructor(
    private readonly accessGovernanceService: AccessGovernanceService,
    private readonly securityEventService: SecurityEventService,
    private readonly dataClassificationService: DataClassificationService,
    private readonly retentionGovernanceService: RetentionGovernanceService,
    private readonly privacyRequestService: PrivacyRequestService,
    private readonly complianceGovernanceService: ComplianceGovernanceService,
    private readonly supplyChainSecurityService: SupplyChainSecurityService,
    private readonly runtimeHardeningService: RuntimeHardeningService,
    private readonly prisma: PrismaService
  ) {}

  private toLimit(raw: string | undefined, fallback = 200, max = 2000) {
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(1, Math.min(max, Math.floor(parsed)));
  }

  private parseGovernanceStatus(raw?: string): GovernanceRequestStatus | undefined {
    if (!raw) {
      return undefined;
    }
    const token = raw.trim().toUpperCase();
    const values = Object.values(GovernanceRequestStatus) as string[];
    if (!values.includes(token)) {
      return undefined;
    }
    return token as GovernanceRequestStatus;
  }

  private parsePrivacyJobStatus(raw?: string): PrivacyJobStatus | undefined {
    if (!raw) {
      return undefined;
    }
    const token = raw.trim().toUpperCase();
    const values = Object.values(PrivacyJobStatus) as string[];
    if (!values.includes(token)) {
      return undefined;
    }
    return token as PrivacyJobStatus;
  }

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

  @Get("classifications")
  @RequireAccessPermission({
    permission: "security.compliance.classification.read",
    resourceType: "security",
    action: "read"
  })
  listClassifications(@Query("limit") limit?: string) {
    return this.dataClassificationService.listClassifications(this.toLimit(limit, 300, 5000));
  }

  @Get("retention-policies")
  @RequireAccessPermission({
    permission: "security.compliance.retention.read",
    resourceType: "security",
    action: "read"
  })
  listRetentionPolicies(@Query("limit") limit?: string) {
    return this.retentionGovernanceService.listRetentionPolicies(this.toLimit(limit, 300, 5000));
  }

  @Get("deletion-requests")
  @RequireAccessPermission({
    permission: "security.compliance.privacy_delete.read",
    resourceType: "security",
    action: "read"
  })
  deletionRequestTracker(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.privacyRequestService.listDeletionRequests({
      status: this.parseGovernanceStatus(status),
      limit: this.toLimit(limit, 200, 3000)
    });
  }

  @Get("privacy-export-jobs")
  @RequireAccessPermission({
    permission: "security.compliance.privacy_export.read",
    resourceType: "security",
    action: "read"
  })
  privacyExportTracker(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.privacyRequestService.listPrivacyExportJobs({
      status: this.parsePrivacyJobStatus(status),
      limit: this.toLimit(limit, 200, 3000)
    });
  }

  @Get("data-access-requests")
  @RequireAccessPermission({
    permission: "security.compliance.data_access.read",
    resourceType: "security",
    action: "read"
  })
  dataAccessRequests(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.privacyRequestService.listDataAccessRequests({
      status: this.parseGovernanceStatus(status),
      limit: this.toLimit(limit, 200, 3000)
    });
  }

  @Post("requests/privacy-export")
  @RequireAccessPermission({
    permission: "security.compliance.privacy_export.write",
    resourceType: "security",
    action: "create"
  })
  async createPrivacyExportRequest(@Body() body: PrivacyRequestDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    return this.privacyRequestService.submitPrivacyExportRequest({
      requestType: GovernanceRequestType.PRIVACY_EXPORT,
      requestKey: body.requestKey ?? null,
      userId: body.userId ?? actor.userId ?? null,
      actorType: actor.actorType,
      actorId: actor.userId ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      targetDomain: body.targetDomain,
      targetEntity: body.targetEntity ?? null,
      targetId: body.targetId ?? null,
      legalBasisHook: body.legalBasisHook ?? null,
      reason: body.reason ?? "admin_requested_privacy_export",
      dryRun: body.dryRun ?? true,
      metadata: body.metadata ?? null,
      context
    });
  }

  @Post("requests/privacy-deletion")
  @RequireAccessPermission({
    permission: "security.compliance.privacy_delete.write",
    resourceType: "security",
    action: "create"
  })
  async createPrivacyDeletionRequest(@Body() body: PrivacyRequestDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    return this.privacyRequestService.submitPrivacyDeletionRequest({
      requestType: GovernanceRequestType.PRIVACY_DELETE,
      requestKey: body.requestKey ?? null,
      userId: body.userId ?? actor.userId ?? null,
      actorType: actor.actorType,
      actorId: actor.userId ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      targetDomain: body.targetDomain,
      targetEntity: body.targetEntity ?? null,
      targetId: body.targetId ?? null,
      legalBasisHook: body.legalBasisHook ?? null,
      reason: body.reason ?? "admin_requested_privacy_deletion",
      dryRun: body.dryRun ?? true,
      metadata: body.metadata ?? null,
      context
    });
  }

  @Post("requests/data-access")
  @RequireAccessPermission({
    permission: "security.compliance.data_access.write",
    resourceType: "security",
    action: "create"
  })
  async createDataAccessRequest(@Body() body: PrivacyRequestDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    return this.privacyRequestService.submitDataAccessRequest({
      requestType: GovernanceRequestType.DATA_ACCESS,
      requestKey: body.requestKey ?? null,
      userId: body.userId ?? actor.userId ?? null,
      actorType: actor.actorType,
      actorId: actor.userId ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      targetDomain: body.targetDomain,
      targetEntity: body.targetEntity ?? null,
      targetId: body.targetId ?? null,
      legalBasisHook: body.legalBasisHook ?? null,
      reason: body.reason ?? "admin_requested_data_access",
      dryRun: body.dryRun ?? true,
      metadata: body.metadata ?? null,
      context
    });
  }

  @Post("retention/cleanup/dry-run")
  @RequireAccessPermission({
    permission: "security.compliance.retention.dry_run",
    resourceType: "security",
    action: "read"
  })
  cleanupDryRun(@Body() body: RetentionDryRunDto) {
    return this.retentionGovernanceService.generateCleanupReport({
      domain: body.domain ?? null,
      policyKey: body.policyKey ?? null,
      dryRun: true
    });
  }

  @Post("retention/cleanup/execute")
  @RequireAccessPermission({
    permission: "security.compliance.retention.execute",
    resourceType: "security",
    action: "update"
  })
  async cleanupExecute(@Body() body: RetentionExecuteDto, @Req() request: any) {
    const actor = await this.resolveActor(request);
    const context = this.securityEventService.resolveRequestContext(request);
    const dryRun = body.dryRun ?? false;
    const asyncMode = body.asyncMode ?? true;

    if (dryRun) {
      return this.retentionGovernanceService.executeCleanup({
        domain: body.domain ?? null,
        policyKey: body.policyKey ?? null,
        actorType: actor.actorType,
        actorId: actor.userId ?? null,
        serviceIdentityId: actor.serviceIdentityId ?? null,
        dryRun: true
      });
    }

    if (!asyncMode) {
      return this.retentionGovernanceService.executeCleanup({
        domain: body.domain ?? null,
        policyKey: body.policyKey ?? null,
        actorType: actor.actorType,
        actorId: actor.userId ?? null,
        serviceIdentityId: actor.serviceIdentityId ?? null,
        dryRun: false
      });
    }

    return this.privacyRequestService.enqueueRetentionCleanup({
      domain: body.domain ?? null,
      policyKey: body.policyKey ?? null,
      dryRun: false,
      actorType: actor.actorType,
      actorId: actor.userId ?? null,
      serviceIdentityId: actor.serviceIdentityId ?? null,
      context
    });
  }

  @Get("legal-hold")
  @RequireAccessPermission({
    permission: "security.compliance.legal_hold.read",
    resourceType: "security",
    action: "read"
  })
  legalHoldIndicators() {
    return this.complianceGovernanceService.listLegalHoldIndicators();
  }

  @Post("legal-hold")
  @RequireAccessPermission({
    permission: "security.compliance.legal_hold.write",
    resourceType: "security",
    action: "update"
  })
  updateLegalHold(@Body() body: UpdateLegalHoldDomainsDto) {
    return this.complianceGovernanceService.updateLegalHoldDomains({
      domains: body.domains
    });
  }

  @Get("supply-chain-history")
  @RequireAccessPermission({
    permission: "security.compliance.supply_chain.read",
    resourceType: "security",
    action: "read"
  })
  async supplyChainHistory(@Query("limit") limit?: string) {
    const take = this.toLimit(limit, 120, 2000);
    const [vulnerabilityDashboard, releaseAttestations, dependencySnapshots, scanRuns] = await Promise.all([
      this.supplyChainSecurityService.listVulnerabilityDashboard(take),
      this.runtimeHardeningService.listReleaseAttestations(take),
      this.prisma.dependencyInventorySnapshot.findMany({
        orderBy: { createdAt: "desc" },
        take
      }),
      this.prisma.securityScanRun.findMany({
        orderBy: { createdAt: "desc" },
        take
      })
    ]);

    const snapshotById = new Map(dependencySnapshots.map((item) => [item.id, item]));
    const scanById = new Map(scanRuns.map((item) => [item.id, item]));

    return {
      vulnerabilityDashboard,
      dependencySnapshots,
      scanRuns,
      releaseAttestations: releaseAttestations.map((attestation) => ({
        ...attestation,
        dependencySnapshot: attestation.dependencySnapshotId ? snapshotById.get(attestation.dependencySnapshotId) ?? null : null,
        scanRun: attestation.scanRunId ? scanById.get(attestation.scanRunId) ?? null : null
      }))
    };
  }

  @Get("action-audit")
  @RequireAccessPermission({
    permission: "security.compliance.audit.read",
    resourceType: "security",
    action: "read"
  })
  complianceActionAudit(@Query("limit") limit?: string) {
    return this.complianceGovernanceService.listComplianceActionAudit(this.toLimit(limit, 300, 4000));
  }
}

