import { SetMetadata } from "@nestjs/common";
import { AccessScope } from "../../modules/access-governance/access-governance.types";

export const ACCESS_PERMISSION_KEY = "access_permission";

export type AccessPermissionMetadata = {
  permission: string;
  resourceType: string;
  action: string;
  scope?: AccessScope;
};

export const RequireAccessPermission = (metadata: AccessPermissionMetadata) =>
  SetMetadata(ACCESS_PERMISSION_KEY, metadata);
