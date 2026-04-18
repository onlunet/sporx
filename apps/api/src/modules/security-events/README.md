# Security Events / Incident Readiness (Phase 3)

This module introduces structured security telemetry and incident lifecycle controls.

## Tables

- `audit_events`: immutable audit trail for privileged/security operations.
- `security_events`: structured event stream for security-relevant signals.
- `security_alerts`: rule-driven alerts derived from security/abuse signals.
- `incident_response_events`: append-only incident timeline with lifecycle transitions.
- `abuse_events`: abuse/rate-limit and suspicious invocation events.

## Event flow

1. Critical action triggers `emitAuditEvent` and/or `emitSecurityEvent`.
2. Security stream runs alert rules (`refresh_token_reuse`, denial spikes, repeated break-glass, etc.).
3. Alerts are stored in `security_alerts`.
4. Incident actions append to `incident_response_events`.

## Incident lifecycle

Supported statuses:

- `OPEN`
- `ACKNOWLEDGED`
- `MITIGATING`
- `CONTAINED`
- `RESOLVED`
- `POSTMORTEM_PENDING`
- `CLOSED`

Transitions are validated server-side.

## Emergency controls

Managed through `SystemSetting` keys:

- `security.emergency.disable_refresh_global`
- `security.emergency.disable_admin_write_actions`
- `security.emergency.admin_read_only_mode`
- `security.emergency.disabled_provider_path`
- `security.emergency.feature_flag_rollback`

Every emergency action is audited and emitted to security events.

## Feature flags

- `SECURITY_AUDIT_ENABLED`
- `SECURITY_EVENT_STREAM_ENABLED`
- `INCIDENT_READINESS_ENABLED`
- `EMERGENCY_CONTROLS_ENABLED`
- `SECURITY_ALERTING_ENABLED`
