-- Security hardening phase 2: authorization + access governance

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessActorType') THEN
    CREATE TYPE "AccessActorType" AS ENUM ('USER', 'ADMIN', 'SERVICE', 'SYSTEM');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PermissionEffect') THEN
    CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PrivilegedActionSeverity') THEN
    CREATE TYPE "PrivilegedActionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PrivilegedActionStatus') THEN
    CREATE TYPE "PrivilegedActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'CANCELLED', 'EXPIRED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS access_policies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  current_version_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_policy_versions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  policy_id text NOT NULL REFERENCES access_policies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text NOT NULL,
  matrix_jsonb jsonb NOT NULL,
  conditions_jsonb jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'access_policies' AND constraint_name = 'access_policies_current_version_id_fkey'
  ) THEN
    ALTER TABLE access_policies
      ADD CONSTRAINT access_policies_current_version_id_fkey
      FOREIGN KEY (current_version_id) REFERENCES access_policy_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_identities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  secret_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  environment text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ip_allowlists (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_type "AccessActorType" NOT NULL,
  user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  service_identity_id text REFERENCES service_identities(id) ON DELETE SET NULL,
  cidr text NOT NULL,
  environment text,
  is_active boolean NOT NULL DEFAULT true,
  reason text,
  created_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ip_allowlists_scope
  ON ip_allowlists (actor_type, user_id, service_identity_id, environment, is_active);

CREATE TABLE IF NOT EXISTS permission_grants (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_type "AccessActorType" NOT NULL,
  actor_id text,
  service_identity_id text REFERENCES service_identities(id) ON DELETE SET NULL,
  role text,
  permission text NOT NULL,
  resource_type text NOT NULL,
  action text NOT NULL,
  effect "PermissionEffect" NOT NULL DEFAULT 'ALLOW',
  policy_version_id text REFERENCES access_policy_versions(id) ON DELETE SET NULL,
  scope_global boolean NOT NULL DEFAULT false,
  scope_sport text,
  scope_league_id text,
  scope_market text,
  scope_horizon text,
  scope_environment text,
  ip_allowlist_id text REFERENCES ip_allowlists(id) ON DELETE SET NULL,
  expires_at timestamptz,
  reason text,
  granted_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  revoked_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permission_grants_actor
  ON permission_grants (actor_type, actor_id, service_identity_id, role);
CREATE INDEX IF NOT EXISTS idx_permission_grants_permission
  ON permission_grants (permission, resource_type, action, scope_environment);
CREATE INDEX IF NOT EXISTS idx_permission_grants_scope
  ON permission_grants (scope_sport, scope_league_id, scope_market, scope_horizon);

CREATE TABLE IF NOT EXISTS role_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role text NOT NULL,
  scope_global boolean NOT NULL DEFAULT false,
  scope_sport text,
  scope_league_id text,
  scope_market text,
  scope_horizon text,
  scope_environment text,
  reason text,
  granted_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  revoked_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_assignments_user
  ON role_assignments (user_id, role, revoked_at);
CREATE INDEX IF NOT EXISTS idx_role_assignments_scope
  ON role_assignments (scope_sport, scope_league_id, scope_market, scope_horizon, scope_environment);

CREATE TABLE IF NOT EXISTS privileged_action_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  idempotency_key text NOT NULL UNIQUE,
  actor_type "AccessActorType" NOT NULL,
  actor_id text REFERENCES "User"(id) ON DELETE SET NULL,
  service_identity_id text REFERENCES service_identities(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  scope_jsonb jsonb,
  environment text,
  severity "PrivilegedActionSeverity" NOT NULL,
  status "PrivilegedActionStatus" NOT NULL DEFAULT 'PENDING',
  reason text NOT NULL,
  policy_version_id text REFERENCES access_policy_versions(id) ON DELETE SET NULL,
  requires_step_up boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  executed_at timestamptz,
  expires_at timestamptz,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privileged_action_requests_status
  ON privileged_action_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_privileged_action_requests_action
  ON privileged_action_requests (action, resource_type, environment, severity);

CREATE TABLE IF NOT EXISTS privileged_action_approvals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_id text NOT NULL REFERENCES privileged_action_requests(id) ON DELETE CASCADE,
  approver_user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  status "PrivilegedActionStatus" NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privileged_action_approvals_request
  ON privileged_action_approvals (request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_privileged_action_approvals_approver
  ON privileged_action_approvals (approver_user_id, created_at);

CREATE TABLE IF NOT EXISTS service_identity_scopes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  service_identity_id text NOT NULL REFERENCES service_identities(id) ON DELETE CASCADE,
  permission text NOT NULL,
  resource_type text NOT NULL,
  action text NOT NULL,
  effect "PermissionEffect" NOT NULL DEFAULT 'ALLOW',
  scope_global boolean NOT NULL DEFAULT false,
  scope_sport text,
  scope_league_id text,
  scope_market text,
  scope_horizon text,
  scope_environment text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_identity_scopes
  ON service_identity_scopes (service_identity_id, permission, resource_type, action, is_active);

CREATE TABLE IF NOT EXISTS environment_policy_overrides (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  policy_version_id text NOT NULL REFERENCES access_policy_versions(id) ON DELETE CASCADE,
  environment text NOT NULL,
  override_jsonb jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_environment_policy_overrides_lookup
  ON environment_policy_overrides (policy_version_id, environment, is_active);
