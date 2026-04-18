import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  AccessActorType,
  PermissionEffect,
  Prisma,
  PrivilegedActionSeverity,
  SecurityEventSeverity,
  SecurityEventSourceDomain
} from "@prisma/client";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AccessActor,
  AccessEvaluationResult,
  AccessRequirement,
  AccessScope
} from "./access-governance.types";
import { SecurityEventService } from "../security-events/security-event.service";

const ADMIN_ROLE_SET = new Set(["super_admin", "admin", "analyst", "viewer"]);

type PolicyMatrixRule = {
  id?: string;
  effect?: "ALLOW" | "DENY";
  permission?: string;
  permissions?: string[];
  resourceType?: string;
  action?: string;
  actions?: string[];
  actorType?: "USER" | "ADMIN" | "SERVICE" | "SYSTEM";
  roles?: string[];
  scope?: {
    global?: boolean;
    sport?: string;
    leagueId?: string;
    market?: string;
    horizon?: string;
    environment?: string;
  };
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isStrictEnvironmentName(value: string | undefined | null) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "production" || normalized === "staging";
}

@Injectable()
export class AccessGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService
  ) {}

  private async emitGovernanceAudit(input: {
    actorType: AccessActorType;
    actorId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    reason?: string | null;
    decisionResult?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    await this.securityEventService.emitAuditEvent({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      reason: input.reason ?? null,
      decisionResult: input.decisionResult ?? null,
      severity: SecurityEventSeverity.MEDIUM,
      metadata: input.metadata ?? null
    });

    await this.securityEventService.emitSecurityEvent({
      sourceDomain: SecurityEventSourceDomain.ACCESS,
      eventType: input.action.replace(/\./g, "_"),
      severity: SecurityEventSeverity.MEDIUM,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      targetResourceType: input.resourceType,
      targetResourceId: input.resourceId ?? null,
      reason: input.reason ?? null,
      decisionResult: input.decisionResult ?? null,
      metadata: input.metadata ?? null
    });
  }

  isEnabled() {
    const runtimeEnvironment = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
    const strictByDefault = isStrictEnvironmentName(runtimeEnvironment);
    return parseBoolean(process.env.ACCESS_GOVERNANCE_ENABLED, strictByDefault);
  }

  isScopedPermissionEnforced() {
    return parseBoolean(process.env.SCOPED_PERMISSION_ENFORCEMENT_ENABLED, false);
  }

  isServiceIdentityScopeEnforced() {
    return parseBoolean(process.env.SERVICE_IDENTITY_SCOPE_ENFORCED, true);
  }

  resolveEnvironment(request?: Request) {
    const headerValue =
      request?.headers["x-app-environment"] ??
      request?.headers["x-environment"] ??
      request?.headers["x-runtime-env"];
    if (typeof headerValue === "string" && headerValue.trim().length > 0) {
      return headerValue.trim().toLowerCase();
    }
    if (Array.isArray(headerValue) && headerValue[0]) {
      return String(headerValue[0]).trim().toLowerCase();
    }
    return (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
  }

  parseClientIp(request?: Request): string | null {
    if (!request) {
      return null;
    }
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0]?.trim() ?? request.ip ?? null;
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return forwarded[0]?.trim() ?? request.ip ?? null;
    }
    return request.ip ?? null;
  }

  extractScopeFromRequest(request: Request, baseScope?: AccessScope): AccessScope {
    const query = request.query as Record<string, unknown>;
    const params = request.params as Record<string, unknown>;
    const body = asRecord(request.body) ?? {};
    const scope: AccessScope = {
      global: false,
      sport:
        normalizeString(baseScope?.sport) ??
        normalizeString(query.sport) ??
        normalizeString(params.sport) ??
        normalizeString(body.sport),
      leagueId:
        normalizeString(baseScope?.leagueId) ??
        normalizeString(query.leagueId) ??
        normalizeString(params.leagueId) ??
        normalizeString(body.leagueId),
      market:
        normalizeString(baseScope?.market) ??
        normalizeString(query.market) ??
        normalizeString(params.market) ??
        normalizeString(body.market),
      horizon:
        normalizeString(baseScope?.horizon) ??
        normalizeString(query.horizon) ??
        normalizeString(params.horizon) ??
        normalizeString(body.horizon),
      environment:
        normalizeString(baseScope?.environment) ?? this.resolveEnvironment(request)
    };
    return scope;
  }

  private matchesText(ruleValue: string | null | undefined, actualValue: string | null | undefined) {
    if (!ruleValue) {
      return true;
    }
    if (!actualValue) {
      return false;
    }
    return ruleValue.trim().toLowerCase() === actualValue.trim().toLowerCase();
  }

  private matchesScope(
    ruleScope: {
      global?: boolean | null;
      sport?: string | null;
      leagueId?: string | null;
      market?: string | null;
      horizon?: string | null;
      environment?: string | null;
    },
    requestedScope: AccessScope
  ) {
    if (ruleScope.global) {
      return true;
    }
    if (!this.matchesText(ruleScope.sport ?? null, requestedScope.sport ?? null)) {
      return false;
    }
    if (!this.matchesText(ruleScope.leagueId ?? null, requestedScope.leagueId ?? null)) {
      return false;
    }
    if (!this.matchesText(ruleScope.market ?? null, requestedScope.market ?? null)) {
      return false;
    }
    if (!this.matchesText(ruleScope.horizon ?? null, requestedScope.horizon ?? null)) {
      return false;
    }
    if (!this.matchesText(ruleScope.environment ?? null, requestedScope.environment ?? null)) {
      return false;
    }
    return true;
  }

  private ipMatchesRule(ip: string, cidr: string) {
    const normalized = cidr.trim();
    if (normalized === ip) {
      return true;
    }
    if (normalized.endsWith("*")) {
      const prefix = normalized.slice(0, -1);
      return ip.startsWith(prefix);
    }
    return false;
  }

  private async validateIpAllowlist(actor: AccessActor): Promise<boolean> {
    const ip = actor.ipAddress?.trim();
    if (!ip) {
      return true;
    }

    const principalConditions: Prisma.IpAllowlistWhereInput[] = [{ userId: null, serviceIdentityId: null }];
    if (actor.userId) {
      principalConditions.push({ userId: actor.userId });
    }
    if (actor.serviceIdentityId) {
      principalConditions.push({ serviceIdentityId: actor.serviceIdentityId });
    }

    const environmentConditions: Prisma.IpAllowlistWhereInput[] = [{ environment: null }];
    if (actor.environment) {
      environmentConditions.push({ environment: actor.environment });
    }

    const allowlists = await this.prisma.ipAllowlist.findMany({
      where: {
        isActive: true,
        actorType: actor.actorType,
        AND: [
          { OR: principalConditions },
          { OR: environmentConditions }
        ]
      }
    });

    if (allowlists.length === 0) {
      return true;
    }

    return allowlists.some((item) => this.ipMatchesRule(ip, item.cidr));
  }

  private evaluatePolicyMatrixRule(
    actor: AccessActor,
    requirement: AccessRequirement,
    rule: PolicyMatrixRule
  ) {
    const permissions = [
      ...(typeof rule.permission === "string" ? [rule.permission] : []),
      ...asArray(rule.permissions).map((item) => String(item))
    ]
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const actions = [
      ...(typeof rule.action === "string" ? [rule.action] : []),
      ...asArray(rule.actions).map((item) => String(item))
    ]
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);

    if (rule.actorType && rule.actorType !== actor.actorType) {
      return null;
    }
    if (rule.roles && rule.roles.length > 0) {
      if (!actor.role || !rule.roles.map((item) => item.toLowerCase()).includes(actor.role.toLowerCase())) {
        return null;
      }
    }
    if (permissions.length > 0 && !permissions.includes(requirement.permission)) {
      return null;
    }
    if (rule.resourceType && rule.resourceType.trim().toLowerCase() !== requirement.resourceType.trim().toLowerCase()) {
      return null;
    }
    if (actions.length > 0 && !actions.includes(requirement.action.trim().toLowerCase())) {
      return null;
    }

    const ruleScope = rule.scope ?? {};
    if (!this.matchesScope(
      {
        global: ruleScope.global ?? false,
        sport: ruleScope.sport ?? null,
        leagueId: ruleScope.leagueId ?? null,
        market: ruleScope.market ?? null,
        horizon: ruleScope.horizon ?? null,
        environment: ruleScope.environment ?? null
      },
      requirement.scope ?? {}
    )) {
      return null;
    }

    return (rule.effect ?? "ALLOW").toUpperCase() === "DENY" ? PermissionEffect.DENY : PermissionEffect.ALLOW;
  }

  private async evaluatePolicyMatrix(
    actor: AccessActor,
    requirement: AccessRequirement
  ): Promise<AccessEvaluationResult | null> {
    const policies = await this.prisma.accessPolicy.findMany({
      where: {
        isActive: true,
        currentVersion: {
          is: {
            isActive: true
          }
        }
      },
      include: {
        currentVersion: {
          include: {
            environmentOverrides: {
              where: {
                isActive: true,
                environment: requirement.scope?.environment ?? actor.environment
              },
              orderBy: {
                createdAt: "desc"
              },
              take: 1
            }
          }
        }
      }
    });

    const matchedEffects: Array<{ effect: PermissionEffect; policyKey: string }> = [];
    for (const policy of policies) {
      const version = policy.currentVersion;
      if (!version) {
        continue;
      }

      const override = version.environmentOverrides[0];
      const matrixSource = override?.overrideJson ?? version.matrixJson;
      const matrix = asRecord(matrixSource);
      const rules = asArray(matrix?.rules)
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));

      for (const entry of rules) {
        const effect = this.evaluatePolicyMatrixRule(actor, requirement, {
          id: normalizeString(entry.id) ?? undefined,
          effect: normalizeString(entry.effect)?.toUpperCase() as "ALLOW" | "DENY" | undefined,
          permission: normalizeString(entry.permission) ?? undefined,
          permissions: asArray(entry.permissions).map((item) => String(item)),
          resourceType: normalizeString(entry.resourceType) ?? undefined,
          action: normalizeString(entry.action) ?? undefined,
          actions: asArray(entry.actions).map((item) => String(item)),
          actorType: normalizeString(entry.actorType)?.toUpperCase() as
            | "USER"
            | "ADMIN"
            | "SERVICE"
            | "SYSTEM"
            | undefined,
          roles: asArray(entry.roles).map((item) => String(item)),
          scope: asRecord(entry.scope) as PolicyMatrixRule["scope"]
        });
        if (!effect) {
          continue;
        }
        matchedEffects.push({
          effect,
          policyKey: policy.key
        });
      }
    }

    if (matchedEffects.length === 0) {
      return null;
    }
    const denyMatch = matchedEffects.find((item) => item.effect === PermissionEffect.DENY);
    if (denyMatch) {
      return {
        allowed: false,
        effect: PermissionEffect.DENY,
        reason: `policy_matrix_deny:${denyMatch.policyKey}`,
        source: "policy_matrix"
      };
    }
    return {
      allowed: true,
      effect: PermissionEffect.ALLOW,
      reason: `policy_matrix_allow:${matchedEffects[0]?.policyKey ?? "unknown"}`,
      source: "policy_matrix"
    };
  }

  private mapGrantToScope(grant: {
    scopeGlobal: boolean;
    scopeSport: string | null;
    scopeLeagueId: string | null;
    scopeMarket: string | null;
    scopeHorizon: string | null;
    scopeEnvironment: string | null;
  }) {
    return {
      global: grant.scopeGlobal,
      sport: grant.scopeSport,
      leagueId: grant.scopeLeagueId,
      market: grant.scopeMarket,
      horizon: grant.scopeHorizon,
      environment: grant.scopeEnvironment
    };
  }

  async evaluateAccess(actor: AccessActor, requirement: AccessRequirement): Promise<AccessEvaluationResult> {
    const normalizedRequirement: AccessRequirement = {
      ...requirement,
      action: requirement.action.trim().toLowerCase(),
      resourceType: requirement.resourceType.trim().toLowerCase(),
      permission: requirement.permission.trim(),
      scope: {
        global: requirement.scope?.global ?? false,
        sport: requirement.scope?.sport ?? null,
        leagueId: requirement.scope?.leagueId ?? null,
        market: requirement.scope?.market ?? null,
        horizon: requirement.scope?.horizon ?? null,
        environment: requirement.scope?.environment ?? actor.environment
      }
    };

    if (!this.isEnabled()) {
      return {
        allowed: true,
        effect: PermissionEffect.ALLOW,
        reason: "access_governance_disabled",
        source: "default"
      };
    }

    const ipAllowed = await this.validateIpAllowlist(actor);
    if (!ipAllowed) {
      return {
        allowed: false,
        effect: PermissionEffect.DENY,
        reason: "ip_allowlist_denied",
        source: "default"
      };
    }

    const now = new Date();
    const whereBase: Prisma.PermissionGrantWhereInput = {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      permission: normalizedRequirement.permission,
      resourceType: normalizedRequirement.resourceType,
      action: normalizedRequirement.action
    };

    const directGrants = await this.prisma.permissionGrant.findMany({
      where: {
        ...whereBase,
        actorType: actor.actorType,
        ...(actor.userId ? { actorId: actor.userId } : {}),
        ...(actor.serviceIdentityId ? { serviceIdentityId: actor.serviceIdentityId } : {})
      },
      orderBy: [{ createdAt: "asc" }]
    });

    const roleGrants =
      actor.userId && actor.role
        ? await this.prisma.permissionGrant.findMany({
            where: {
              ...whereBase,
              role: actor.role,
              actorType: {
                in: [AccessActorType.USER, AccessActorType.ADMIN]
              }
            },
            orderBy: [{ createdAt: "asc" }]
          })
        : [];

    const serviceScopes =
      actor.serviceIdentityId && this.isServiceIdentityScopeEnforced()
        ? await this.prisma.serviceIdentityScope.findMany({
            where: {
              serviceIdentityId: actor.serviceIdentityId,
              isActive: true,
              permission: normalizedRequirement.permission,
              resourceType: normalizedRequirement.resourceType,
              action: normalizedRequirement.action
            },
            orderBy: [{ createdAt: "asc" }]
          })
        : [];

    const matchedGrantEffects: Array<{ effect: PermissionEffect; source: AccessEvaluationResult["source"] }> = [];
    for (const grant of directGrants) {
      if (!this.matchesScope(this.mapGrantToScope(grant), normalizedRequirement.scope ?? {})) {
        continue;
      }
      matchedGrantEffects.push({
        effect: grant.effect,
        source: "grant"
      });
    }
    for (const grant of roleGrants) {
      if (!this.matchesScope(this.mapGrantToScope(grant), normalizedRequirement.scope ?? {})) {
        continue;
      }
      matchedGrantEffects.push({
        effect: grant.effect,
        source: "role_assignment"
      });
    }
    for (const scope of serviceScopes) {
      if (!this.matchesScope(
        {
          global: scope.scopeGlobal,
          sport: scope.scopeSport,
          leagueId: scope.scopeLeagueId,
          market: scope.scopeMarket,
          horizon: scope.scopeHorizon,
          environment: scope.scopeEnvironment
        },
        normalizedRequirement.scope ?? {}
      )) {
        continue;
      }
      matchedGrantEffects.push({
        effect: scope.effect,
        source: "service_scope"
      });
    }

    const deny = matchedGrantEffects.find((item) => item.effect === PermissionEffect.DENY);
    if (deny) {
      return {
        allowed: false,
        effect: PermissionEffect.DENY,
        reason: "explicit_deny",
        source: deny.source
      };
    }

    const allow = matchedGrantEffects.find((item) => item.effect === PermissionEffect.ALLOW);
    if (allow) {
      return {
        allowed: true,
        effect: PermissionEffect.ALLOW,
        reason: "explicit_allow",
        source: allow.source
      };
    }

    const policyMatch = await this.evaluatePolicyMatrix(actor, normalizedRequirement);
    if (policyMatch) {
      return policyMatch;
    }

    return {
      allowed: false,
      effect: PermissionEffect.DENY,
      reason: "deny_by_default",
      source: "default"
    };
  }

  async resolveActorFromRequest(request: Request): Promise<AccessActor | null> {
    const user = request.user as { id?: string; role?: string } | undefined;
    const environment = this.resolveEnvironment(request);
    const ipAddress = this.parseClientIp(request);

    if (user?.id) {
      const actorType = user.role && ADMIN_ROLE_SET.has(user.role) ? AccessActorType.ADMIN : AccessActorType.USER;
      return {
        actorType,
        userId: user.id,
        role: user.role,
        environment,
        ipAddress
      };
    }

    const serviceKeyHeader = request.headers["x-service-identity-key"];
    const serviceSecretHeader = request.headers["x-service-identity-secret"];
    const serviceKey = typeof serviceKeyHeader === "string" ? serviceKeyHeader.trim() : "";
    const serviceSecret = typeof serviceSecretHeader === "string" ? serviceSecretHeader.trim() : "";
    if (!serviceKey || !serviceSecret) {
      return null;
    }

    const identity = await this.prisma.serviceIdentity.findUnique({
      where: { key: serviceKey }
    });
    if (!identity || !identity.isActive) {
      return null;
    }
    const secretOk = await bcrypt.compare(serviceSecret, identity.secretHash);
    if (!secretOk) {
      return null;
    }

    await this.prisma.serviceIdentity.update({
      where: { id: identity.id },
      data: {
        lastUsedAt: new Date()
      }
    });

    return {
      actorType: AccessActorType.SERVICE,
      serviceIdentityId: identity.id,
      environment: identity.environment ?? environment,
      ipAddress
    };
  }

  async assertAccessOrThrow(actor: AccessActor, requirement: AccessRequirement) {
    const decision = await this.evaluateAccess(actor, requirement);
    if (!decision.allowed) {
      const deniedEventType =
        requirement.permission.startsWith("security.") || requirement.permission.includes("privileged_action")
          ? "privileged_action_denied"
          : "access_denied";
      await this.securityEventService.emitSecurityEvent({
        sourceDomain: SecurityEventSourceDomain.ACCESS,
        eventType: deniedEventType,
        severity: SecurityEventSeverity.HIGH,
        actorType: actor.actorType,
        actorId: actor.userId ?? null,
        serviceIdentityId: actor.serviceIdentityId ?? null,
        targetResourceType: requirement.resourceType,
        reason: decision.reason,
        decisionResult: "DENY",
        metadata: {
          permission: requirement.permission,
          action: requirement.action,
          scope: requirement.scope ?? null
        },
        context: {
          ipAddress: actor.ipAddress ?? null,
          environment: actor.environment
        }
      });
      throw new ForbiddenException("Access denied");
    }
    return decision;
  }

  async createPolicy(input: { key: string; name: string; description?: string | null }) {
    const created = await this.prisma.accessPolicy.create({
      data: {
        key: input.key.trim().toLowerCase(),
        name: input.name.trim(),
        description: input.description ?? null
      }
    });
    await this.emitGovernanceAudit({
      actorType: AccessActorType.SYSTEM,
      action: "policy.create",
      resourceType: "access_policy",
      resourceId: created.id,
      reason: "policy_created",
      decisionResult: "ALLOW",
      metadata: { key: created.key }
    });
    return created;
  }

  async listPolicies() {
    return this.prisma.accessPolicy.findMany({
      include: {
        currentVersion: true,
        versions: {
          orderBy: {
            version: "desc"
          },
          take: 5
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  async createPolicyVersion(input: {
    policyId: string;
    label: string;
    matrix: Prisma.InputJsonValue;
    conditions?: Prisma.InputJsonValue | null;
    createdByUserId?: string | null;
    makeCurrent?: boolean;
  }) {
    const created = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.accessPolicyVersion.findFirst({
        where: { policyId: input.policyId },
        orderBy: { version: "desc" }
      });
      const version = (latest?.version ?? 0) + 1;
      const created = await tx.accessPolicyVersion.create({
        data: {
          policyId: input.policyId,
          version,
          label: input.label,
          matrixJson: input.matrix,
          conditionsJson: input.conditions ?? undefined,
          createdByUserId: input.createdByUserId ?? null
        }
      });
      if (input.makeCurrent ?? true) {
        await tx.accessPolicy.update({
          where: { id: input.policyId },
          data: {
            currentVersionId: created.id
          }
        });
      }
      return created;
    });
    await this.emitGovernanceAudit({
      actorType: input.createdByUserId ? AccessActorType.ADMIN : AccessActorType.SYSTEM,
      actorId: input.createdByUserId ?? null,
      action: "policy.version.create",
      resourceType: "access_policy_version",
      resourceId: created.id,
      reason: "policy_version_created",
      decisionResult: "ALLOW",
      metadata: {
        policyId: input.policyId,
        label: input.label,
        makeCurrent: input.makeCurrent ?? true
      }
    });
    return created;
  }

  async createEnvironmentOverride(input: {
    policyVersionId: string;
    environment: string;
    overrideJson: Prisma.InputJsonValue;
    createdByUserId?: string | null;
  }) {
    const created = await this.prisma.environmentPolicyOverride.create({
      data: {
        policyVersionId: input.policyVersionId,
        environment: input.environment.trim().toLowerCase(),
        overrideJson: input.overrideJson,
        createdByUserId: input.createdByUserId ?? null
      }
    });
    await this.emitGovernanceAudit({
      actorType: input.createdByUserId ? AccessActorType.ADMIN : AccessActorType.SYSTEM,
      actorId: input.createdByUserId ?? null,
      action: "policy.environment_override",
      resourceType: "environment_policy_override",
      resourceId: created.id,
      reason: "policy_override_created",
      decisionResult: "ALLOW",
      metadata: {
        policyVersionId: input.policyVersionId,
        environment: created.environment
      }
    });
    return created;
  }

  async createPermissionGrant(input: {
    actorType: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    role?: string | null;
    permission: string;
    resourceType: string;
    action: string;
    effect?: PermissionEffect;
    policyVersionId?: string | null;
    scope?: AccessScope;
    ipAllowlistId?: string | null;
    expiresAt?: Date | null;
    reason?: string | null;
    grantedByUserId?: string | null;
  }) {
    const created = await this.prisma.permissionGrant.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        role: input.role ?? null,
        permission: input.permission.trim(),
        resourceType: input.resourceType.trim().toLowerCase(),
        action: input.action.trim().toLowerCase(),
        effect: input.effect ?? PermissionEffect.ALLOW,
        policyVersionId: input.policyVersionId ?? null,
        scopeGlobal: input.scope?.global ?? false,
        scopeSport: input.scope?.sport ?? null,
        scopeLeagueId: input.scope?.leagueId ?? null,
        scopeMarket: input.scope?.market ?? null,
        scopeHorizon: input.scope?.horizon ?? null,
        scopeEnvironment: input.scope?.environment ?? null,
        ipAllowlistId: input.ipAllowlistId ?? null,
        expiresAt: input.expiresAt ?? null,
        reason: input.reason ?? null,
        grantedByUserId: input.grantedByUserId ?? null
      }
    });
    await this.emitGovernanceAudit({
      actorType: input.grantedByUserId ? AccessActorType.ADMIN : AccessActorType.SYSTEM,
      actorId: input.grantedByUserId ?? null,
      action: "permission.grant",
      resourceType: "permission_grant",
      resourceId: created.id,
      reason: input.reason ?? "permission_granted",
      decisionResult: created.effect,
      metadata: {
        actorType: created.actorType,
        actorId: created.actorId,
        role: created.role,
        permission: created.permission,
        resourceType: created.resourceType,
        action: created.action
      }
    });
    return created;
  }

  async revokePermissionGrant(grantId: string, revokedByUserId: string, reason?: string | null) {
    const revoked = await this.prisma.permissionGrant.update({
      where: { id: grantId },
      data: {
        revokedAt: new Date(),
        revokedByUserId,
        reason: reason ?? undefined
      }
    });
    await this.emitGovernanceAudit({
      actorType: AccessActorType.ADMIN,
      actorId: revokedByUserId,
      action: "permission.revoke",
      resourceType: "permission_grant",
      resourceId: grantId,
      reason: reason ?? "permission_revoked",
      decisionResult: "DENY",
      metadata: {
        permission: revoked.permission,
        targetActorId: revoked.actorId,
        targetRole: revoked.role
      }
    });
    return revoked;
  }

  async listPermissionGrants(options?: { includeRevoked?: boolean }) {
    return this.prisma.permissionGrant.findMany({
      where: options?.includeRevoked ? undefined : { revokedAt: null },
      orderBy: [{ createdAt: "desc" }]
    });
  }

  async assignRole(input: {
    userId: string;
    role: string;
    scope?: AccessScope;
    reason?: string | null;
    grantedByUserId?: string | null;
  }) {
    const created = await this.prisma.roleAssignment.create({
      data: {
        userId: input.userId,
        role: input.role.trim().toLowerCase(),
        scopeGlobal: input.scope?.global ?? false,
        scopeSport: input.scope?.sport ?? null,
        scopeLeagueId: input.scope?.leagueId ?? null,
        scopeMarket: input.scope?.market ?? null,
        scopeHorizon: input.scope?.horizon ?? null,
        scopeEnvironment: input.scope?.environment ?? null,
        reason: input.reason ?? null,
        grantedByUserId: input.grantedByUserId ?? null
      }
    });
    await this.emitGovernanceAudit({
      actorType: input.grantedByUserId ? AccessActorType.ADMIN : AccessActorType.SYSTEM,
      actorId: input.grantedByUserId ?? null,
      action: "role.assignment.create",
      resourceType: "role_assignment",
      resourceId: created.id,
      reason: input.reason ?? "role_assigned",
      decisionResult: "ALLOW",
      metadata: {
        userId: created.userId,
        role: created.role
      }
    });
    return created;
  }

  async revokeRoleAssignment(assignmentId: string, revokedByUserId: string, reason?: string | null) {
    const revoked = await this.prisma.roleAssignment.update({
      where: { id: assignmentId },
      data: {
        revokedAt: new Date(),
        revokedByUserId,
        reason: reason ?? undefined
      }
    });
    await this.emitGovernanceAudit({
      actorType: AccessActorType.ADMIN,
      actorId: revokedByUserId,
      action: "role.assignment.revoke",
      resourceType: "role_assignment",
      resourceId: assignmentId,
      reason: reason ?? "role_revoked",
      decisionResult: "DENY",
      metadata: {
        userId: revoked.userId,
        role: revoked.role
      }
    });
    return revoked;
  }

  async listRoleAssignments(options?: { includeRevoked?: boolean; userId?: string }) {
    return this.prisma.roleAssignment.findMany({
      where: {
        ...(options?.includeRevoked ? {} : { revokedAt: null }),
        ...(options?.userId ? { userId: options.userId } : {})
      },
      orderBy: [{ createdAt: "desc" }]
    });
  }

  async createServiceIdentity(input: {
    key: string;
    name: string;
    description?: string | null;
    environment?: string | null;
  }) {
    const generatedSecret = randomBytes(24).toString("hex");
    const secretHash = await bcrypt.hash(generatedSecret, 10);
    const created = await this.prisma.serviceIdentity.create({
      data: {
        key: input.key.trim().toLowerCase(),
        name: input.name.trim(),
        description: input.description ?? null,
        environment: input.environment?.trim().toLowerCase() ?? null,
        secretHash
      }
    });
    await this.emitGovernanceAudit({
      actorType: AccessActorType.SYSTEM,
      action: "service_identity.create",
      resourceType: "service_identity",
      resourceId: created.id,
      reason: "service_identity_created",
      decisionResult: "ALLOW",
      metadata: {
        key: created.key,
        environment: created.environment
      }
    });
    return {
      ...created,
      generatedSecret
    };
  }

  async listServiceIdentities() {
    return this.prisma.serviceIdentity.findMany({
      include: {
        scopes: {
          where: { isActive: true }
        }
      },
      orderBy: [{ createdAt: "desc" }]
    });
  }

  async createServiceIdentityScope(input: {
    serviceIdentityId: string;
    permission: string;
    resourceType: string;
    action: string;
    effect?: PermissionEffect;
    scope?: AccessScope;
  }) {
    const created = await this.prisma.serviceIdentityScope.create({
      data: {
        serviceIdentityId: input.serviceIdentityId,
        permission: input.permission.trim(),
        resourceType: input.resourceType.trim().toLowerCase(),
        action: input.action.trim().toLowerCase(),
        effect: input.effect ?? PermissionEffect.ALLOW,
        scopeGlobal: input.scope?.global ?? false,
        scopeSport: input.scope?.sport ?? null,
        scopeLeagueId: input.scope?.leagueId ?? null,
        scopeMarket: input.scope?.market ?? null,
        scopeHorizon: input.scope?.horizon ?? null,
        scopeEnvironment: input.scope?.environment ?? null
      }
    });
    await this.emitGovernanceAudit({
      actorType: AccessActorType.SYSTEM,
      action: "service_identity.scope.create",
      resourceType: "service_identity_scope",
      resourceId: created.id,
      reason: "service_identity_scope_created",
      decisionResult: created.effect,
      metadata: {
        serviceIdentityId: created.serviceIdentityId,
        permission: created.permission,
        resourceType: created.resourceType,
        action: created.action
      }
    });
    return created;
  }

  async createIpAllowlist(input: {
    actorType: AccessActorType;
    userId?: string | null;
    serviceIdentityId?: string | null;
    cidr: string;
    environment?: string | null;
    reason?: string | null;
    createdByUserId?: string | null;
  }) {
    const created = await this.prisma.ipAllowlist.create({
      data: {
        actorType: input.actorType,
        userId: input.userId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        cidr: input.cidr.trim(),
        environment: input.environment?.trim().toLowerCase() ?? null,
        reason: input.reason ?? null,
        createdByUserId: input.createdByUserId ?? null
      }
    });
    await this.emitGovernanceAudit({
      actorType: input.createdByUserId ? AccessActorType.ADMIN : AccessActorType.SYSTEM,
      actorId: input.createdByUserId ?? null,
      action: "security.ip_allowlist.create",
      resourceType: "ip_allowlist",
      resourceId: created.id,
      reason: input.reason ?? "ip_allowlist_created",
      decisionResult: "ALLOW",
      metadata: {
        actorType: created.actorType,
        userId: created.userId,
        serviceIdentityId: created.serviceIdentityId,
        cidr: created.cidr,
        environment: created.environment
      }
    });
    return created;
  }

  async listIpAllowlists() {
    return this.prisma.ipAllowlist.findMany({
      orderBy: [{ createdAt: "desc" }]
    });
  }

  severityFromAction(action: string): PrivilegedActionSeverity {
    const normalized = action.trim().toLowerCase();
    if (
      [
        "model.alias.switch",
        "model.rollback",
        "security.compliance.change",
        "role.escalation",
        "break_glass.grant"
      ].includes(normalized)
    ) {
      return PrivilegedActionSeverity.CRITICAL;
    }
    if (
      [
        "publish.force",
        "publish.block",
        "bankroll.override",
        "provider.quarantine.override",
        "environment.override"
      ].includes(normalized)
    ) {
      return PrivilegedActionSeverity.HIGH;
    }
    if (["policy.strategy.change", "policy.permission.grant", "policy.permission.revoke"].includes(normalized)) {
      return PrivilegedActionSeverity.MEDIUM;
    }
    return PrivilegedActionSeverity.LOW;
  }
}
