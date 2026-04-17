import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  AccessActorType,
  PermissionEffect,
  PrivilegedActionSeverity,
  PrivilegedActionStatus
} from "@prisma/client";
import {
  IsBoolean,
  IsDateString,
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
import { AccessGovernanceService } from "../access-governance/access-governance.service";
import { PrivilegedActionControlService } from "../access-governance/privileged-action-control.service";

type RequestUser = {
  id: string;
  role: string;
};

class CreatePolicyDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

class CreatePolicyVersionDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsObject()
  matrix!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  makeCurrent?: boolean;
}

class CreateEnvironmentOverrideDto {
  @IsString()
  @IsNotEmpty()
  environment!: string;

  @IsObject()
  override!: Record<string, unknown>;
}

class CreatePermissionGrantDto {
  @IsEnum(AccessActorType)
  actorType!: AccessActorType;

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  serviceIdentityId?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsString()
  @IsNotEmpty()
  permission!: string;

  @IsString()
  @IsNotEmpty()
  resourceType!: string;

  @IsString()
  @IsNotEmpty()
  action!: string;

  @IsOptional()
  @IsEnum(PermissionEffect)
  effect?: PermissionEffect;

  @IsOptional()
  @IsString()
  scopeSport?: string;

  @IsOptional()
  @IsString()
  scopeLeagueId?: string;

  @IsOptional()
  @IsString()
  scopeMarket?: string;

  @IsOptional()
  @IsString()
  scopeHorizon?: string;

  @IsOptional()
  @IsString()
  scopeEnvironment?: string;

  @IsOptional()
  @IsBoolean()
  scopeGlobal?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class RevokeGrantDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class AssignRoleDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  role!: string;

  @IsOptional()
  @IsString()
  scopeSport?: string;

  @IsOptional()
  @IsString()
  scopeLeagueId?: string;

  @IsOptional()
  @IsString()
  scopeMarket?: string;

  @IsOptional()
  @IsString()
  scopeHorizon?: string;

  @IsOptional()
  @IsString()
  scopeEnvironment?: string;

  @IsOptional()
  @IsBoolean()
  scopeGlobal?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

class CreateServiceIdentityDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  environment?: string;
}

class CreateServiceScopeDto {
  @IsString()
  @IsNotEmpty()
  permission!: string;

  @IsString()
  @IsNotEmpty()
  resourceType!: string;

  @IsString()
  @IsNotEmpty()
  action!: string;

  @IsOptional()
  @IsEnum(PermissionEffect)
  effect?: PermissionEffect;

  @IsOptional()
  @IsString()
  scopeSport?: string;

  @IsOptional()
  @IsString()
  scopeLeagueId?: string;

  @IsOptional()
  @IsString()
  scopeMarket?: string;

  @IsOptional()
  @IsString()
  scopeHorizon?: string;

  @IsOptional()
  @IsString()
  scopeEnvironment?: string;

  @IsOptional()
  @IsBoolean()
  scopeGlobal?: boolean;
}

class CreatePrivilegedRequestDto {
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsString()
  @IsNotEmpty()
  action!: string;

  @IsString()
  @IsNotEmpty()
  resourceType!: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsEnum(PrivilegedActionSeverity)
  severity?: PrivilegedActionSeverity;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class ApprovePrivilegedRequestDto {
  @IsEnum(PrivilegedActionStatus)
  status!: PrivilegedActionStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}

class BreakGlassDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  permission!: string;

  @IsString()
  @IsNotEmpty()
  resourceType!: string;

  @IsString()
  @IsNotEmpty()
  action!: string;

  @IsDateString()
  expiresAt!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  environment?: string;
}

class CreateIpAllowlistDto {
  @IsEnum(AccessActorType)
  actorType!: AccessActorType;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  serviceIdentityId?: string;

  @IsString()
  @IsNotEmpty()
  cidr!: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller("admin/security/access")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminAccessGovernanceController {
  constructor(
    private readonly accessGovernanceService: AccessGovernanceService,
    private readonly privilegedActionControlService: PrivilegedActionControlService
  ) {}

  @Get("policies")
  @RequireAccessPermission({
    permission: "security.policy.read",
    resourceType: "security",
    action: "read"
  })
  listPolicies() {
    return this.accessGovernanceService.listPolicies();
  }

  @Post("policies")
  @RequireAccessPermission({
    permission: "security.policy.write",
    resourceType: "security",
    action: "update"
  })
  createPolicy(@Body() body: CreatePolicyDto) {
    return this.accessGovernanceService.createPolicy({
      key: body.key,
      name: body.name,
      description: body.description ?? null
    });
  }

  @Post("policies/:policyId/versions")
  @RequireAccessPermission({
    permission: "security.policy.version.write",
    resourceType: "security",
    action: "update"
  })
  createPolicyVersion(
    @Param("policyId") policyId: string,
    @Body() body: CreatePolicyVersionDto,
    @Req() request: { user: RequestUser }
  ) {
    return this.accessGovernanceService.createPolicyVersion({
      policyId,
      label: body.label,
      matrix: body.matrix as any,
      conditions: body.conditions as any,
      makeCurrent: body.makeCurrent,
      createdByUserId: request.user.id
    });
  }

  @Post("policies/versions/:versionId/overrides")
  @RequireAccessPermission({
    permission: "security.policy.override.write",
    resourceType: "security",
    action: "update"
  })
  createEnvironmentOverride(
    @Param("versionId") versionId: string,
    @Body() body: CreateEnvironmentOverrideDto,
    @Req() request: { user: RequestUser }
  ) {
    return this.accessGovernanceService.createEnvironmentOverride({
      policyVersionId: versionId,
      environment: body.environment,
      overrideJson: body.override as any,
      createdByUserId: request.user.id
    });
  }

  @Get("grants")
  @RequireAccessPermission({
    permission: "security.permission.read",
    resourceType: "security",
    action: "read"
  })
  listGrants(@Query("includeRevoked") includeRevoked?: string) {
    const shouldInclude = (includeRevoked ?? "").trim().toLowerCase() === "true";
    return this.accessGovernanceService.listPermissionGrants({
      includeRevoked: shouldInclude
    });
  }

  @Post("grants")
  @RequireAccessPermission({
    permission: "security.permission.write",
    resourceType: "security",
    action: "update"
  })
  createGrant(@Body() body: CreatePermissionGrantDto, @Req() request: { user: RequestUser }) {
    return this.accessGovernanceService.createPermissionGrant({
      actorType: body.actorType,
      actorId: body.actorId ?? null,
      serviceIdentityId: body.serviceIdentityId ?? null,
      role: body.role ?? null,
      permission: body.permission,
      resourceType: body.resourceType,
      action: body.action,
      effect: body.effect,
      scope: {
        global: body.scopeGlobal ?? false,
        sport: body.scopeSport ?? null,
        leagueId: body.scopeLeagueId ?? null,
        market: body.scopeMarket ?? null,
        horizon: body.scopeHorizon ?? null,
        environment: body.scopeEnvironment ?? null
      },
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      reason: body.reason ?? null,
      grantedByUserId: request.user.id
    });
  }

  @Post("grants/:grantId/revoke")
  @RequireAccessPermission({
    permission: "security.permission.revoke",
    resourceType: "security",
    action: "delete"
  })
  revokeGrant(@Param("grantId") grantId: string, @Body() body: RevokeGrantDto, @Req() request: { user: RequestUser }) {
    return this.accessGovernanceService.revokePermissionGrant(grantId, request.user.id, body.reason ?? null);
  }

  @Get("roles")
  @RequireAccessPermission({
    permission: "security.role.read",
    resourceType: "security",
    action: "read"
  })
  listRoleAssignments(
    @Query("includeRevoked") includeRevoked?: string,
    @Query("userId") userId?: string
  ) {
    return this.accessGovernanceService.listRoleAssignments({
      includeRevoked: (includeRevoked ?? "").trim().toLowerCase() === "true",
      userId: userId?.trim() || undefined
    });
  }

  @Post("roles")
  @RequireAccessPermission({
    permission: "security.role.write",
    resourceType: "security",
    action: "update"
  })
  assignRole(@Body() body: AssignRoleDto, @Req() request: { user: RequestUser }) {
    return this.accessGovernanceService.assignRole({
      userId: body.userId,
      role: body.role,
      scope: {
        global: body.scopeGlobal ?? false,
        sport: body.scopeSport ?? null,
        leagueId: body.scopeLeagueId ?? null,
        market: body.scopeMarket ?? null,
        horizon: body.scopeHorizon ?? null,
        environment: body.scopeEnvironment ?? null
      },
      reason: body.reason ?? null,
      grantedByUserId: request.user.id
    });
  }

  @Post("roles/:assignmentId/revoke")
  @RequireAccessPermission({
    permission: "security.role.revoke",
    resourceType: "security",
    action: "delete"
  })
  revokeRole(
    @Param("assignmentId") assignmentId: string,
    @Body() body: RevokeGrantDto,
    @Req() request: { user: RequestUser }
  ) {
    return this.accessGovernanceService.revokeRoleAssignment(assignmentId, request.user.id, body.reason ?? null);
  }

  @Get("service-identities")
  @RequireAccessPermission({
    permission: "security.service_identity.read",
    resourceType: "security",
    action: "read"
  })
  listServiceIdentities() {
    return this.accessGovernanceService.listServiceIdentities();
  }

  @Post("service-identities")
  @RequireAccessPermission({
    permission: "security.service_identity.write",
    resourceType: "security",
    action: "create"
  })
  createServiceIdentity(@Body() body: CreateServiceIdentityDto) {
    return this.accessGovernanceService.createServiceIdentity({
      key: body.key,
      name: body.name,
      description: body.description ?? null,
      environment: body.environment ?? null
    });
  }

  @Post("service-identities/:serviceIdentityId/scopes")
  @RequireAccessPermission({
    permission: "security.service_identity.scope.write",
    resourceType: "security",
    action: "update"
  })
  createServiceScope(@Param("serviceIdentityId") serviceIdentityId: string, @Body() body: CreateServiceScopeDto) {
    return this.accessGovernanceService.createServiceIdentityScope({
      serviceIdentityId,
      permission: body.permission,
      resourceType: body.resourceType,
      action: body.action,
      effect: body.effect,
      scope: {
        global: body.scopeGlobal ?? false,
        sport: body.scopeSport ?? null,
        leagueId: body.scopeLeagueId ?? null,
        market: body.scopeMarket ?? null,
        horizon: body.scopeHorizon ?? null,
        environment: body.scopeEnvironment ?? null
      }
    });
  }

  @Get("privileged-actions")
  @RequireAccessPermission({
    permission: "security.privileged_action.read",
    resourceType: "security",
    action: "read"
  })
  listPrivilegedActions() {
    return this.privilegedActionControlService.listRequests();
  }

  @Post("privileged-actions/request")
  @RequireAccessPermission({
    permission: "security.privileged_action.request",
    resourceType: "security",
    action: "create"
  })
  async createPrivilegedRequest(@Body() body: CreatePrivilegedRequestDto, @Req() request: any) {
    const actor = await this.accessGovernanceService.resolveActorFromRequest(request);
    if (!actor) {
      throw new ForbiddenException("Access denied");
    }
    return this.privilegedActionControlService.submitRequest(actor, {
      idempotencyKey: body.idempotencyKey,
      action: body.action,
      resourceType: body.resourceType,
      resourceId: body.resourceId ?? null,
      reason: body.reason,
      severity: body.severity ?? this.accessGovernanceService.severityFromAction(body.action),
      environment: body.environment ?? null,
      metadata: body.metadata ?? null
    });
  }

  @Post("privileged-actions/:requestId/approve")
  @RequireAccessPermission({
    permission: "security.privileged_action.approve",
    resourceType: "security",
    action: "update"
  })
  approvePrivilegedRequest(
    @Param("requestId") requestId: string,
    @Body() body: ApprovePrivilegedRequestDto,
    @Req() request: { user: RequestUser }
  ) {
    return this.privilegedActionControlService.approveRequest(request.user.id, {
      requestId,
      status: body.status,
      reason: body.reason ?? null
    });
  }

  @Post("privileged-actions/:requestId/execute")
  @RequireAccessPermission({
    permission: "security.privileged_action.execute",
    resourceType: "security",
    action: "update"
  })
  executePrivilegedRequest(@Param("requestId") requestId: string, @Req() request: { user: RequestUser }) {
    return this.privilegedActionControlService.executeRequest(requestId, request.user.id);
  }

  @Post("break-glass")
  @RequireAccessPermission({
    permission: "security.break_glass.grant",
    resourceType: "security",
    action: "create"
  })
  async breakGlass(@Body() body: BreakGlassDto, @Req() request: any) {
    const actor = await this.accessGovernanceService.resolveActorFromRequest(request);
    if (!actor || !actor.userId) {
      throw new ForbiddenException("Access denied");
    }
    return this.privilegedActionControlService.createBreakGlassGrant({
      requester: actor,
      approverUserId: actor.userId,
      userId: body.userId,
      permission: body.permission,
      resourceType: body.resourceType,
      action: body.action,
      environment: body.environment ?? null,
      expiresAt: new Date(body.expiresAt),
      reason: body.reason
    });
  }

  @Get("ip-allowlists")
  @RequireAccessPermission({
    permission: "security.ip_allowlist.read",
    resourceType: "security",
    action: "read"
  })
  listIpAllowlists() {
    return this.accessGovernanceService.listIpAllowlists();
  }

  @Post("ip-allowlists")
  @RequireAccessPermission({
    permission: "security.ip_allowlist.write",
    resourceType: "security",
    action: "create"
  })
  createIpAllowlist(@Body() body: CreateIpAllowlistDto, @Req() request: { user: RequestUser }) {
    return this.accessGovernanceService.createIpAllowlist({
      actorType: body.actorType,
      userId: body.userId ?? null,
      serviceIdentityId: body.serviceIdentityId ?? null,
      cidr: body.cidr,
      environment: body.environment ?? null,
      reason: body.reason ?? null,
      createdByUserId: request.user.id
    });
  }
}
