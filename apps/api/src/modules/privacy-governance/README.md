# Privacy Governance (Phase 5)

This module implements concrete governance controls for privacy, retention, and compliance workflows.
It is designed as policy-driven operational hardening and does not claim any formal compliance certification.

## Scope

Phase 5 adds:
- explicit data classification metadata
- retention policy governance with dry-run and execution paths
- policy decision hooks for privacy export/deletion style operations
- legal-hold blocking hooks
- immutable audit linkage for governance actions

## Feature flags

- `PRIVACY_GOVERNANCE_ENABLED`
- `RETENTION_CLEANUP_ENABLED`
- `PRIVACY_EXPORT_ENABLED`
- `PRIVACY_DELETION_ENABLED`
- `LEGAL_HOLD_HOOKS_ENABLED`
- `COMPLIANCE_POLICY_ENFORCED`
- `COMPLIANCE_POLICY_VERSION`
- `LEGAL_HOLD_DOMAINS`

## Data classification

`DataClassificationService` manages table/field-to-class mappings.

Supported classes:
- `PUBLIC`
- `INTERNAL`
- `CONFIDENTIAL`
- `RESTRICTED`
- `PII`

Key behaviors:
- default mappings can be synced to DB with policy version tags
- classification metadata is queryable for internal/admin governance tooling
- role-aware redaction decisions are derived from classification level
- unknown mappings safely fall back to `INTERNAL` classification defaults

## Retention governance

`RetentionGovernanceService` controls retention by policy rows (`retention_policies`).

Key behaviors:
- policy scope by domain/table/data class/action/retention window
- dry-run report generation with deterministic report key
- legal-hold and compliance decision checks applied before execution
- immutable-protected rows (for audit/security style history) are blocked from destructive cleanup paths
- cleanup actions produce auditable event records

Dry-run and execute are intentionally separated:
- dry-run: impact report only, no destructive writes
- execute: only non-blocked/non-immutable candidates are processed

## Privacy workflow policy hooks

`ComplianceGovernanceService` provides policy decisions for operations such as:
- `privacy_export`
- `privacy_delete`
- `retention_cleanup`
- `data_access`

Decision characteristics:
- deterministic `decisionKey` from stable input scope + policy version
- environment/flag-aware behavior
- legal-hold domain blocking hooks
- immutable data guard for restricted retention cleanup
- explicit rejection of privacy delete execution when legal basis is missing

Each decision emits:
- audit event (`compliance.policy.decision`)
- security event (`compliance_policy_decision`)

## Idempotency and determinism

Implemented deterministic surfaces:
- compliance policy decision key: same policy version + same decision scope => same key
- retention dry-run report key: same report input + same candidate counts => same key

Operational expectations:
- retries should reuse stable keys where possible
- dry-run and execute remain separate auditable actions
- immutable-protected audit/security style records are never casually deleted

## Public exposure boundaries

- public APIs must not expose internal governance/security/provider internals
- compliance/security/audit details are internal/admin-only concerns
- sensitive values should be masked/redacted before logs or downstream responses
