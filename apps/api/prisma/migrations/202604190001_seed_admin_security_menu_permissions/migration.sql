-- Seed default role grants for production admin security/compliance menu pages.
-- These grants are read-scoped and idempotent; privileged write actions remain explicitly controlled.

WITH grants(permission, resource_type, action) AS (
  VALUES
    ('security.secrets.read', 'security', 'read'),
    ('security.runtime.read', 'security', 'read'),
    ('security.abuse.read', 'security', 'read'),
    ('security.queue.read', 'security', 'read'),
    ('security.vulnerability.read', 'security', 'read'),
    ('security.release.read', 'security', 'read'),
    ('security.compliance.classification.read', 'security', 'read'),
    ('security.compliance.retention.read', 'security', 'read'),
    ('security.compliance.privacy_delete.read', 'security', 'read'),
    ('security.compliance.privacy_export.read', 'security', 'read'),
    ('security.compliance.data_access.read', 'security', 'read'),
    ('security.compliance.retention.dry_run', 'security', 'read'),
    ('security.compliance.legal_hold.read', 'security', 'read'),
    ('security.compliance.supply_chain.read', 'security', 'read'),
    ('security.compliance.audit.read', 'security', 'read')
),
roles(role_name) AS (
  VALUES ('super_admin'), ('admin')
)
INSERT INTO permission_grants (
  id,
  actor_type,
  role,
  permission,
  resource_type,
  action,
  effect,
  scope_global,
  reason,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid()::text,
  'ADMIN'::"AccessActorType",
  roles.role_name,
  grants.permission,
  grants.resource_type,
  grants.action,
  'ALLOW'::"PermissionEffect",
  true,
  'seed_admin_security_menu_permissions',
  now(),
  now()
FROM grants
CROSS JOIN roles
WHERE NOT EXISTS (
  SELECT 1
  FROM permission_grants existing
  WHERE existing.actor_type = 'ADMIN'::"AccessActorType"
    AND existing.role = roles.role_name
    AND existing.permission = grants.permission
    AND existing.resource_type = grants.resource_type
    AND existing.action = grants.action
    AND existing.revoked_at IS NULL
);
