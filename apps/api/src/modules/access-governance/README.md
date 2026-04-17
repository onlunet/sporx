# Access Governance (Phase 2)

This module adds deterministic, deny-by-default authorization controls on top of existing JWT/RBAC.

## Core model

- `AccessPolicy` + `AccessPolicyVersion`: versioned policy matrix (`ALLOW`/`DENY`) with optional environment overrides.
- `PermissionGrant`: explicit grants/revokes for user/admin/service actors and role-scoped grants.
- `RoleAssignment`: auditable role assignment history (grant/revoke with actors and reasons).
- `ServiceIdentity` + `ServiceIdentityScope`: non-human identities with least-privilege scoped permissions.
- `PrivilegedActionRequest` + `PrivilegedActionApproval`: auditable privileged action workflow with idempotency key.
- `IpAllowlist`: actor-aware network restriction support.

## Evaluation flow

`AccessGovernanceService.evaluateAccess()`:

1. Feature flag check (`ACCESS_GOVERNANCE_ENABLED`).
2. IP allowlist check (if entries exist for actor/global).
3. Explicit grant resolution (`PermissionGrant` / `ServiceIdentityScope`).
4. Policy matrix resolution from active policy versions.
5. Final fallback: **deny**.

If no matching allow exists, access is rejected by default.

## Privileged action flow

`PrivilegedActionControlService`:

1. Submit request with idempotency key.
2. Require approval for high/critical actions when enabled.
3. Execute only approved, non-expired requests.
4. Write immutable audit entries for request/approval/execution.

Break-glass uses the same workflow and issues an explicit temporary permission grant with expiry.

## Flags

- `ACCESS_GOVERNANCE_ENABLED`
- `SCOPED_PERMISSION_ENFORCEMENT_ENABLED`
- `SERVICE_IDENTITY_SCOPE_ENFORCED`
- `PRIVILEGED_ACTION_APPROVAL_ENABLED`
- `BREAK_GLASS_ENABLED`

## Admin surface

`AdminAccessGovernanceController` provides policy, grant, role assignment, service identity, privileged action, break-glass, and allowlist management endpoints under:

- `/api/v1/admin/security/access/*`

All endpoints are server-side enforced through JWT + role + access permission checks.
