-- Security / Compliance / Access Governance Hardening - Phase 4
-- Secrets + API + Runtime Hardening

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SecretLifecycleStatus') THEN
    CREATE TYPE "SecretLifecycleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'RETIRING', 'REVOKED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SecretCategory') THEN
    CREATE TYPE "SecretCategory" AS ENUM (
      'JWT_SIGNING_KEY',
      'REFRESH_SECRET',
      'PROVIDER_API_KEY',
      'DB_CREDENTIAL',
      'REDIS_CREDENTIAL',
      'WEBHOOK_SIGNING_KEY',
      'OTHER'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApiKeyStatus') THEN
    CREATE TYPE "ApiKeyStatus" AS ENUM ('PLANNED', 'ACTIVE', 'RETIRING', 'REVOKED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QueueAccessScopeClass') THEN
    CREATE TYPE "QueueAccessScopeClass" AS ENUM ('OPERATIONAL', 'RESEARCH', 'BACKGROUND');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VulnerabilitySeverity') THEN
    CREATE TYPE "VulnerabilitySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VulnerabilityDisposition') THEN
    CREATE TYPE "VulnerabilityDisposition" AS ENUM ('OPEN', 'IGNORED', 'RESOLVED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SecurityScanRunStatus') THEN
    CREATE TYPE "SecurityScanRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS secret_rotation_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rotation_key text UNIQUE,
  category "SecretCategory" NOT NULL,
  secret_ref text NOT NULL,
  lifecycle_status "SecretLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  reason text,
  planned_at timestamptz,
  activated_at timestamptz,
  retiring_at timestamptz,
  revoked_at timestamptz,
  actor_type "AccessActorType",
  actor_id text,
  service_identity_id text,
  correlation_id text,
  trace_id text,
  request_id text,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secret_rotation_events_category_status_created
  ON secret_rotation_events (category, lifecycle_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_secret_rotation_events_secret_ref_env_created
  ON secret_rotation_events (secret_ref, environment, created_at DESC);

CREATE TABLE IF NOT EXISTS api_key_registry (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key_hash text UNIQUE NOT NULL,
  key_prefix text,
  owner_service text,
  status "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  scopes_jsonb jsonb,
  expires_at timestamptz,
  retired_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  rotated_from_key_hash text,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_key_registry_owner_status_created
  ON api_key_registry (owner_service, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_registry_env_status_created
  ON api_key_registry (environment, status, created_at DESC);

CREATE TABLE IF NOT EXISTS api_key_usages (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  usage_key text UNIQUE,
  api_key_hash text,
  service_identity_id text,
  method text,
  path text,
  status_code integer,
  request_id text,
  correlation_id text,
  trace_id text,
  ip text,
  user_agent text,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usages_key_created
  ON api_key_usages (api_key_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usages_service_created
  ON api_key_usages (service_identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usages_path_method_created
  ON api_key_usages (path, method, created_at DESC);

CREATE TABLE IF NOT EXISTS queue_access_scopes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  queue_name text NOT NULL,
  service_identity_id text NOT NULL,
  scope_class "QueueAccessScopeClass" NOT NULL DEFAULT 'OPERATIONAL',
  allow_enqueue boolean NOT NULL DEFAULT true,
  allow_process boolean NOT NULL DEFAULT false,
  allowed_jobs_jsonb jsonb,
  environment text NOT NULL,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_access_scopes_scope
  ON queue_access_scopes (queue_name, service_identity_id, environment);
CREATE INDEX IF NOT EXISTS idx_queue_access_scopes_class_env_queue
  ON queue_access_scopes (scope_class, environment, queue_name);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  bucket_key text UNIQUE NOT NULL,
  rule_id text NOT NULL,
  actor_type "AccessActorType",
  actor_id text,
  ip text,
  hits integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  window_seconds integer NOT NULL,
  limit_value integer NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_blocked_at timestamptz,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_rule_env_seen
  ON rate_limit_buckets (rule_id, environment, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_ip_seen
  ON rate_limit_buckets (ip, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS webhook_signing_keys (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key_ref text UNIQUE,
  provider text NOT NULL,
  key_id text NOT NULL,
  algorithm text NOT NULL DEFAULT 'HMAC-SHA256',
  secret_ref text NOT NULL,
  lifecycle_status "SecretLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  activated_at timestamptz,
  retiring_at timestamptz,
  revoked_at timestamptz,
  environment text NOT NULL,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_signing_keys_provider_keyid_env
  ON webhook_signing_keys (provider, key_id, environment);
CREATE INDEX IF NOT EXISTS idx_webhook_signing_keys_provider_status_created
  ON webhook_signing_keys (provider, lifecycle_status, created_at DESC);

CREATE TABLE IF NOT EXISTS security_scan_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_key text UNIQUE,
  source text NOT NULL,
  status "SecurityScanRunStatus" NOT NULL DEFAULT 'QUEUED',
  started_at timestamptz,
  completed_at timestamptz,
  summary_jsonb jsonb,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_scan_runs_status_created
  ON security_scan_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_scan_runs_source_created
  ON security_scan_runs (source, created_at DESC);

CREATE TABLE IF NOT EXISTS vulnerability_findings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  finding_key text UNIQUE,
  scan_run_id text,
  package_name text NOT NULL,
  package_version text NOT NULL,
  advisory_id text,
  severity "VulnerabilitySeverity" NOT NULL,
  title text NOT NULL,
  description text,
  fixed_version text,
  cvss_score double precision,
  disposition "VulnerabilityDisposition" NOT NULL DEFAULT 'OPEN',
  ignore_reason text,
  ignore_expires_at timestamptz,
  resolved_at timestamptz,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vulnerability_findings_severity_disposition_created
  ON vulnerability_findings (severity, disposition, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vulnerability_findings_package_advisory_created
  ON vulnerability_findings (package_name, advisory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vulnerability_findings_scan_created
  ON vulnerability_findings (scan_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dependency_inventory_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  snapshot_key text UNIQUE,
  scope text NOT NULL,
  manifest_path text,
  lockfile_hash text,
  package_count integer NOT NULL DEFAULT 0,
  packages_jsonb jsonb NOT NULL,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dependency_inventory_snapshots_scope_created
  ON dependency_inventory_snapshots (scope, created_at DESC);

CREATE TABLE IF NOT EXISTS release_attestations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  attestation_key text UNIQUE,
  git_sha text NOT NULL,
  build_time timestamptz NOT NULL,
  environment text NOT NULL,
  dependency_snapshot_id text,
  scan_run_id text,
  scan_status "SecurityScanRunStatus",
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_release_attestations_environment_created
  ON release_attestations (environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_attestations_gitsha_created
  ON release_attestations (git_sha, created_at DESC);
