# Security Hardening - Phase 4

Phase 4 extends the security/compliance package with practical v1 hardening for secrets, API/runtime boundaries, queue controls, and dependency hygiene.

## What is added

- `SecretGovernanceService`
  - secret startup validation by environment
  - masking/redaction utilities for secret-shaped fields
  - rotation metadata lifecycle (`PLANNED -> ACTIVE -> RETIRING -> REVOKED`)
- `APISecurityService`
  - strict validation toggle hooks
  - request correlation ID assignment (`x-request-id`, `x-correlation-id`, `x-trace-id`)
  - API security header policy and CSP hook support
  - strict CORS policy validation
  - rate-limit bucket persistence support
- `AdminSecurityBoundaryService`
  - admin route origin/IP/service-identity boundary enforcement
  - explicit block for public authority contexts
- `InternalRuntimeSecurityService`
  - queue payload validation before enqueue and execution
  - scoped queue access checks by service identity (`queue_access_scopes`)
  - poison/anomaly handling hooks with abuse events
- `StorageSecurityService`
  - safe cache-key construction with sensitive token hashing
  - namespace/TTL helpers
  - raw-query usage audit hook
- `RuntimeHardeningService`
  - startup policy checks for secrets/CORS/debug/headers/token TTL
  - fail-fast on critical production hardening violations
  - release attestation metadata storage
- `SupplyChainSecurityService`
  - dependency inventory snapshotting
  - scan run ingestion
  - vulnerability finding ingestion/dedup
  - ignore-with-expiry behavior and gate evaluation

## Data model (Phase 4)

New tables:

- `secret_rotation_events`
- `api_key_registry`
- `api_key_usages`
- `queue_access_scopes`
- `rate_limit_buckets`
- `webhook_signing_keys`
- `security_scan_runs`
- `vulnerability_findings`
- `release_attestations`
- `dependency_inventory_snapshots`

Migration: `apps/api/prisma/migrations/202604170004_security_phase4_runtime_hardening/migration.sql`

## API/runtime wiring

- API bootstrap (`main.ts`)
  - request body size limits
  - correlation ID middleware
  - security header middleware
  - strict validation pipe options
  - admin boundary checks
  - startup hardening checks before listen
- Worker bootstrap (`worker.ts`)
  - startup hardening checks before queue worker start
- Ingestion queue
  - payload validation and scope checks before enqueue/process
  - anomaly quarantine signal on failure paths

## Admin endpoints (Phase 4)

Under `/api/v1/admin/security/phase4`:

- `GET /secret-rotations`
- `POST /secret-rotations`
- `GET /runtime-status`
- `GET /environment-checks`
- `GET /rate-limit-buckets`
- `GET /queue-security`
- `POST /queue-security/scopes`
- `GET /vulnerabilities`
- `POST /vulnerabilities/:findingId/ignore`
- `GET /release-attestations`
- `GET /dependency-snapshots/capture`

## Feature flags / env toggles

- `SECRET_GOVERNANCE_ENABLED`
- `STRICT_API_VALIDATION_ENABLED`
- `STRICT_CORS_ENABLED`
- `STRICT_SECURITY_HEADERS_ENABLED`
- `QUEUE_SECURITY_ENFORCED`
- `RUNTIME_HARDENING_CHECKS_ENABLED`
- `VULNERABILITY_GATE_ENABLED`

## Practical defaults

- production favors restrictive checks and fail-fast startup for critical issues
- vendor-specific secret managers are optional (metadata model is manager-agnostic)
- sensitive values are redacted/masked before exposure in metadata/log-like surfaces
