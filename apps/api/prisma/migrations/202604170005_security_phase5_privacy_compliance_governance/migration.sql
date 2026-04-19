-- Security / Compliance / Access Governance Hardening - Phase 5
-- Privacy + Compliance + Retention + Governance

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DataClassificationLevel') THEN
    CREATE TYPE "DataClassificationLevel" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'PII');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RetentionActionType') THEN
    CREATE TYPE "RetentionActionType" AS ENUM ('DELETE', 'ANONYMIZE', 'ARCHIVE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GovernanceRequestType') THEN
    CREATE TYPE "GovernanceRequestType" AS ENUM ('DATA_ACCESS', 'PRIVACY_EXPORT', 'PRIVACY_DELETE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GovernanceRequestStatus') THEN
    CREATE TYPE "GovernanceRequestStatus" AS ENUM (
      'OPEN',
      'POLICY_REVIEW',
      'APPROVED',
      'REJECTED',
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConsentStatus') THEN
    CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'DENIED', 'REVOKED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PrivacyJobStatus') THEN
    CREATE TYPE "PrivacyJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LegalBasisHook') THEN
    CREATE TYPE "LegalBasisHook" AS ENUM (
      'CONSENT',
      'CONTRACT',
      'LEGAL_OBLIGATION',
      'LEGITIMATE_INTEREST',
      'OPERATIONAL_SECURITY',
      'OTHER'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS data_classifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  domain text NOT NULL,
  entity text NOT NULL,
  field_name text,
  data_class "DataClassificationLevel" NOT NULL,
  redaction_strategy text,
  policy_version text NOT NULL,
  legal_basis_hook "LegalBasisHook",
  active boolean NOT NULL DEFAULT true,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_classifications_domain_entity_field_policy
  ON data_classifications (domain, entity, field_name, policy_version);
CREATE INDEX IF NOT EXISTS idx_data_classifications_domain_class_active
  ON data_classifications (domain, data_class, active);

CREATE TABLE IF NOT EXISTS retention_policies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  policy_key text UNIQUE NOT NULL,
  domain text NOT NULL,
  table_name text,
  data_class "DataClassificationLevel",
  retention_days integer NOT NULL,
  action "RetentionActionType" NOT NULL,
  legal_hold_blockable boolean NOT NULL DEFAULT true,
  immutable_protected boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL,
  legal_basis_hook "LegalBasisHook",
  reason text,
  active boolean NOT NULL DEFAULT true,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_domain_table_active
  ON retention_policies (domain, table_name, active);
CREATE INDEX IF NOT EXISTS idx_retention_policies_class_active_created
  ON retention_policies (data_class, active, created_at DESC);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_key text UNIQUE,
  user_id text,
  actor_type "AccessActorType",
  actor_id text,
  service_identity_id text,
  target_domain text NOT NULL,
  target_entity text,
  target_id text,
  request_type "GovernanceRequestType" NOT NULL DEFAULT 'PRIVACY_DELETE',
  status "GovernanceRequestStatus" NOT NULL DEFAULT 'OPEN',
  legal_basis_hook "LegalBasisHook",
  policy_version text,
  reason text,
  dry_run boolean NOT NULL DEFAULT true,
  audit_event_id text,
  security_event_id text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status_created
  ON deletion_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_user_domain_created
  ON deletion_requests (user_id, target_domain, created_at DESC);

CREATE TABLE IF NOT EXISTS data_access_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_key text UNIQUE,
  user_id text,
  actor_type "AccessActorType",
  actor_id text,
  service_identity_id text,
  target_domain text NOT NULL,
  target_entity text,
  target_id text,
  request_type "GovernanceRequestType" NOT NULL DEFAULT 'DATA_ACCESS',
  status "GovernanceRequestStatus" NOT NULL DEFAULT 'OPEN',
  legal_basis_hook "LegalBasisHook",
  policy_version text,
  reason text,
  dry_run boolean NOT NULL DEFAULT true,
  audit_event_id text,
  security_event_id text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_access_requests_status_created
  ON data_access_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_access_requests_user_domain_created
  ON data_access_requests (user_id, target_domain, created_at DESC);

CREATE TABLE IF NOT EXISTS consent_records (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  consent_key text UNIQUE,
  user_id text,
  actor_type "AccessActorType",
  actor_id text,
  service_identity_id text,
  subject_domain text NOT NULL,
  purpose text NOT NULL,
  status "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
  legal_basis_hook "LegalBasisHook",
  policy_version text,
  reason text,
  granted_at timestamptz,
  revoked_at timestamptz,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_user_domain_created
  ON consent_records (user_id, subject_domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_records_status_created
  ON consent_records (status, created_at DESC);

CREATE TABLE IF NOT EXISTS privacy_export_jobs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_key text UNIQUE,
  request_id text,
  user_id text,
  status "PrivacyJobStatus" NOT NULL DEFAULT 'QUEUED',
  policy_version text,
  legal_basis_hook "LegalBasisHook",
  dry_run boolean NOT NULL DEFAULT true,
  legal_hold_blocked boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  input_scope_jsonb jsonb,
  output_ref text,
  error_message text,
  audit_event_id text,
  security_event_id text,
  metadata_jsonb jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privacy_export_jobs_status_created
  ON privacy_export_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_export_jobs_request_user_created
  ON privacy_export_jobs (request_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS privacy_deletion_jobs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_key text UNIQUE,
  request_id text,
  user_id text,
  status "PrivacyJobStatus" NOT NULL DEFAULT 'QUEUED',
  policy_version text,
  legal_basis_hook "LegalBasisHook",
  dry_run boolean NOT NULL DEFAULT true,
  legal_hold_blocked boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  input_scope_jsonb jsonb,
  deleted_count integer NOT NULL DEFAULT 0,
  anonymized_count integer NOT NULL DEFAULT 0,
  skipped_protected_count integer NOT NULL DEFAULT 0,
  error_message text,
  audit_event_id text,
  security_event_id text,
  metadata_jsonb jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privacy_deletion_jobs_status_created
  ON privacy_deletion_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_deletion_jobs_request_user_created
  ON privacy_deletion_jobs (request_id, user_id, created_at DESC);
