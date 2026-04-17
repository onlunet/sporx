import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { RoleName } from "@sporx/shared-types";
import { ACCESS_PERMISSION_KEY, AccessPermissionMetadata } from "../decorators/access-permission.decorator";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { AccessGovernanceService } from "../../modules/access-governance/access-governance.service";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessGovernanceService: AccessGovernanceService
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

    if (requiredRoles && requiredRoles.length > 0) {
      if (!userRole || !requiredRoles.includes(userRole)) {
        throw new ForbiddenException("Insufficient role scope");
      }
    }

    if (!this.accessGovernanceService.isEnabled()) {
      return true;
    }

    const metadata = this.reflector.getAllAndOverride<AccessPermissionMetadata | undefined>(ACCESS_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!metadata && !this.accessGovernanceService.isScopedPermissionEnforced()) {
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
