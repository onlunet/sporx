-- Security / Compliance / Access Governance Hardening - Phase 3
-- Audit Logging + Security Events + Incident Readiness

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SecurityEventSeverity') THEN
    CREATE TYPE "SecurityEventSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SecurityEventSourceDomain') THEN
    CREATE TYPE "SecurityEventSourceDomain" AS ENUM ('AUTH', 'ACCESS', 'ADMIN', 'PROVIDER', 'DATA', 'QUEUE', 'RUNTIME', 'COMPLIANCE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SecurityAlertStatus') THEN
    CREATE TYPE "SecurityAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IncidentStatus') THEN
    CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'MITIGATING', 'CONTAINED', 'RESOLVED', 'POSTMORTEM_PENDING', 'CLOSED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IncidentEventType') THEN
    CREATE TYPE "IncidentEventType" AS ENUM ('OPENED', 'STATUS_CHANGED', 'NOTE', 'LINKED_EVENT', 'EMERGENCY_CONTROL', 'OWNER_ASSIGNED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AbuseEventType') THEN
    CREATE TYPE "AbuseEventType" AS ENUM ('RATE_LIMIT_EXCEEDED', 'AUTH_BRUTE_FORCE', 'SUSPICIOUS_ADMIN_ACCESS', 'QUEUE_INVOCATION_ANOMALY', 'PROVIDER_ABUSE', 'OTHER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_key text UNIQUE,
  actor_type "AccessActorType" NOT NULL,
  actor_id text,
  service_identity_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  scope_jsonb jsonb,
  policy_version_id text,
  decision_result text,
  reason text,
  severity "SecurityEventSeverity" NOT NULL DEFAULT 'INFO',
  correlation_id text,
  trace_id text,
  request_id text,
  ip text,
  user_agent text,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_severity
  ON audit_events (created_at DESC, severity);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_resource
  ON audit_events (action, resource_type, environment);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON audit_events (actor_type, actor_id, service_identity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_key text UNIQUE,
  source_domain "SecurityEventSourceDomain" NOT NULL,
  event_type text NOT NULL,
  severity "SecurityEventSeverity" NOT NULL DEFAULT 'INFO',
  actor_type "AccessActorType",
  actor_id text,
  service_identity_id text,
  target_resource_type text,
  target_resource_id text,
  scope_jsonb jsonb,
  policy_version_id text,
  decision_result text,
  reason text,
  correlation_id text,
  trace_id text,
  request_id text,
  ip text,
  user_agent text,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_source_type_created
  ON security_events (source_domain, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_severity_created
  ON security_events (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_actor
  ON security_events (actor_type, actor_id, service_identity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_alerts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  alert_key text UNIQUE,
  source_domain "SecurityEventSourceDomain" NOT NULL,
  rule_key text NOT NULL,
  severity "SecurityEventSeverity" NOT NULL,
  status "SecurityAlertStatus" NOT NULL DEFAULT 'OPEN',
  title text NOT NULL,
  summary text,
  event_id text,
  owner_user_id text,
  correlation_id text,
  trace_id text,
  request_id text,
  environment text,
  reason text,
  metadata_jsonb jsonb,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_status_severity_created
  ON security_alerts (status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_alerts_source_rule_created
  ON security_alerts (source_domain, rule_key, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_response_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  incident_id text NOT NULL,
  event_key text UNIQUE,
  event_type "IncidentEventType" NOT NULL,
  status "IncidentStatus" NOT NULL,
  severity "SecurityEventSeverity" NOT NULL,
  title text NOT NULL,
  note text,
  owner_user_id text,
  actor_type "AccessActorType",
  actor_id text,
  service_identity_id text,
  action text,
  target_resource_type text,
  target_resource_id text,
  related_audit_event_id text,
  related_security_event_id text,
  related_alert_id text,
  scope_jsonb jsonb,
  policy_version_id text,
  decision_result text,
  reason text,
  correlation_id text,
  trace_id text,
  request_id text,
  ip text,
  user_agent text,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_response_events_incident_created
  ON incident_response_events (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_incident_response_events_status_severity
  ON incident_response_events (status, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS abuse_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_key text UNIQUE,
  event_type "AbuseEventType" NOT NULL,
  source_domain "SecurityEventSourceDomain" NOT NULL,
  severity "SecurityEventSeverity" NOT NULL DEFAULT 'LOW',
  actor_type "AccessActorType",
  actor_id text,
  service_identity_id text,
  target_resource_type text,
  target_resource_id text,
  method text,
  path text,
  reason text,
  count integer NOT NULL DEFAULT 1,
  window_seconds integer,
  correlation_id text,
  trace_id text,
  request_id text,
  ip text,
  user_agent text,
  environment text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abuse_events_type_created
  ON abuse_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abuse_events_severity_created
  ON abuse_events (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abuse_events_ip_created
  ON abuse_events (ip, created_at DESC);
