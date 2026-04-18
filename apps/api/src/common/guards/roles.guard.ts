import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { RoleName } from "@sporx/shared-types";
import { AccessActorType, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { ACCESS_PERMISSION_KEY, AccessPermissionMetadata } from "../decorators/access-permission.decorator";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { AccessGovernanceService } from "../../modules/access-governance/access-governance.service";
import { IncidentReadinessService } from "../../modules/security-events/incident-readiness.service";
import { SecurityEventService } from "../../modules/security-events/security-event.service";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessGovernanceService: AccessGovernanceService,
    private readonly incidentReadinessService: IncidentReadinessService,
    private readonly securityEventService: SecurityEventService
  ) {}

  private inferPermission(request: Request): AccessPermissionMetadata {
    const rawPath = request.path.replace(/^\/+/, "");
    const segments = rawPath.split("/").filter(Boolean);
    const resourceType =
      segments[0] === "api" && segments[1] === "v1"
        ? segments[2] ?? "unknown"
        : segments[0] ?? "unknown";
    const method = request.method.trim().toLowerCase();
    const action =
      method === "get"
        ? "read"
        : method === "post"
          ? "create"
          : method === "patch"
            ? "update"
            : method === "delete"
              ? "delete"
              : method;

    return {
      permission: `${resourceType}.${action}`,
      resourceType,
      action
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    const request = context.switchToHttp().getRequest<Request & { user?: { role?: RoleName } }>();
    const userRole = request.user?.role;
    const path = request.path.trim().toLowerCase();
    const isAdminPath =
      path.startsWith("/api/v1/admin") ||
      path.startsWith("api/v1/admin") ||
      path.startsWith("/admin") ||
      path.startsWith("admin");
    const method = request.method.trim().toUpperCase();
    const isWriteMethod = !["GET", "HEAD", "OPTIONS"].includes(method);
    const isPrivilegedAdminWrite = isAdminPath && isWriteMethod;

    if (isAdminPath && isWriteMethod) {
      const [writeDisabled, readOnlyMode] = await Promise.all([
        this.incidentReadinessService.isEmergencyControlActive("disable_admin_write_actions"),
        this.incidentReadinessService.isEmergencyControlActive("admin_read_only_mode")
      ]);

      if (writeDisabled || readOnlyMode) {
        await this.securityEventService.emitSecurityEvent({
          sourceDomain: SecurityEventSourceDomain.ACCESS,
          eventType: "admin_write_blocked_by_emergency_control",
          severity: SecurityEventSeverity.CRITICAL,
          actorType: userRole ? AccessActorType.ADMIN : AccessActorType.USER,
          reason: writeDisabled ? "disable_admin_write_actions" : "admin_read_only_mode",
          targetResourceType: "admin_route",
          targetResourceId: path,
          context: this.securityEventService.resolveRequestContext(request),
          metadata: {
            method,
            role: userRole ?? null
          }
        });
        throw new ForbiddenException("Access denied");
      }
    }

    if (requiredRoles && requiredRoles.length > 0) {
      if (!userRole || !requiredRoles.includes(userRole)) {
        throw new ForbiddenException("Insufficient role scope");
      }
    }

    const governanceEnabled = this.accessGovernanceService.isEnabled();
    if (!governanceEnabled) {
      const environment = this.accessGovernanceService.resolveEnvironment(request);
      const isStrictEnvironment = environment === "production" || environment === "staging";
      if (isPrivilegedAdminWrite && isStrictEnvironment) {
        throw new ForbiddenException("Access denied");
      }
      return true;
    }

    const metadata = this.reflector.getAllAndOverride<AccessPermissionMetadata | undefined>(ACCESS_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!metadata && !this.accessGovernanceService.isScopedPermissionEnforced() && !isPrivilegedAdminWrite) {
      return true;
    }

    const actor = await this.accessGovernanceService.resolveActorFromRequest(request);
    if (!actor) {
      throw new ForbiddenException("Access denied");
    }

    const requirement = metadata ?? this.inferPermission(request);
    await this.accessGovernanceService.assertAccessOrThrow(actor, {
      permission: requirement.permission,
      resourceType: requirement.resourceType,
      action: requirement.action,
      scope: this.accessGovernanceService.extractScopeFromRequest(request, requirement.scope)
    });

    return true;
  }
}
