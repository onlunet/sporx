# System Convergence + Integration Readiness Report

Date: 2026-04-18
Repo Baseline: D:\sporx\sports-analytics-platform
Execution Mode: Hard Cutover + Quarantine First + Prod/Staging Strict
Scope: Integration/enforcement/simplification/dead-path cleanup (no new product features)

## 1) Confirmed End-to-End Flows

### 1.1 Prediction serving convergence
- Public prediction APIs now read immutable pipeline outputs (`published_predictions`) in runtime serving paths.
- Public list/by-match/high-confidence no longer execute active legacy mutable `prediction` read branches.
- Selection/abstain/publish path remains connected to publish decisions and published outputs.

Evidence:
- `apps/api/src/modules/predictions/predictions.service.ts` (published source runtime queries).
- API tests: `src/modules/predictions/predictions.service.spec.ts` passed.

### 1.2 Public/Admin security boundary
- Public proxy now blocks `admin`, `security`, `compliance`, `internal` route roots, including encoded bypass attempts.
- Denied responses are sanitized (`PUBLIC_ROUTE_FORBIDDEN`) and do not leak internal route details.

Evidence:
- `apps/public-web/app/api/v1/[...path]/route.ts`
- `apps/public-web/src/api/public-proxy-boundary.spec.ts` passed.

### 1.3 Access governance enforcement hardening
- `ACCESS_GOVERNANCE_ENABLED` now defaults strict in `production`/`staging` when unset.
- Roles guard closes privileged admin-write bypass in strict environments.
- Emergency controls continue to block admin writes and emit security events.

Evidence:
- `apps/api/src/modules/access-governance/access-governance.service.ts`
- `apps/api/src/common/guards/roles.guard.ts`
- Tests: `access-governance.service.spec.ts`, `roles.guard.spec.ts` passed.

### 1.4 Queue/scheduler security convergence
- Queue payload validation (`InternalRuntimeSecurityService.validateQueuePayload`) now enforced on enqueue/process for:
  - bankroll
  - research-lab
  - model-lifecycle
- Scheduler payloads include required runtime security fields (`runId`, internal authority, service identity) where needed.
- Malformed/public-authority privileged payload rejection covered by tests.

Evidence:
- `apps/api/src/modules/bankroll/bankroll-orchestration.service.ts`
- `apps/api/src/modules/research-lab/research-lab-orchestration.service.ts`
- `apps/api/src/modules/predictions/model-lifecycle-orchestration.service.ts`
- Tests: new/updated specs passed.

### 1.5 Ingestion runtime topology alignment
- Removed fake/no-op multi-stage ingestion flow for runtime path.
- Ingestion pipeline now enqueues executable job type directly (telemetry/architecture aligned with real execution).

Evidence:
- `apps/api/src/modules/ingestion/ingestion-queue.service.ts`
- `apps/api/src/modules/ingestion/ingestion-queue.service.spec.ts` updated and passed.

### 1.6 Bankroll publish separation
- Bankroll orchestration processes only publish-approved selections (`APPROVED` / `MANUALLY_FORCED`) and cannot rewrite publish decisions.

Evidence:
- `apps/api/src/modules/bankroll/bankroll-orchestration.service.ts`
- Existing and new bankroll tests passed.

## 2) Partially Integrated Components

1. `BacktestService` remains effectively unimplemented placeholder.
   - File: `apps/api/src/modules/backtest/backtest.service.ts`
2. Shadow comparison still reads legacy `prediction` for old-baseline side of challenger comparison.
   - File: `apps/api/src/modules/predictions/shadow-evaluation.service.ts`
3. Admin failure view still depends on `failedPredictionAnalysis` legacy-linked dataset.
   - File: `apps/api/src/modules/admin/admin-predictions.controller.ts` (`GET /failed`)
4. Pipeline rollout config service remains present while public serving is hard-cutover to published outputs.
   - Files: `pipeline-rollout.service.ts`, admin rollout endpoints.

## 3) Dead Code / Dead Schema / Dead Flags Inventory

### 3.1 Dead or stale code paths
- `PredictionsService` still contains legacy helper artifacts no longer used by active serving path:
  - `resolvePublicSource`
  - `fetchLegacyRows`
  - legacy normalization/include helpers

### 3.2 Dead or quarantined schema integrations
- `WebhookSigningKey` runtime usage is currently disconnected (no `prisma.webhookSigningKey` references in API runtime code).
  - Status: quarantined (no DROP in this pass).

### 3.3 Dead/overlapping flags
- `pipeline.rollout.*` no longer controls public serving runtime output after hard cutover.
- Overlap/conflict cluster to consolidate:
  - `pipeline.rollout.emergency_rollback`
  - `selection_engine_emergency_rollback`
  - `security.emergency.feature_flag_rollback`

## 4) Schema + Migration Audit Outputs

### 4.1 Model usage matrix (Phase 1-5 + pipeline/security/governance)

Status legend:
- active: runtime references in non-test code and validated by passing integration tests
- partial: referenced but with limited/no full runtime coverage in this pass
- dead/quarantined: schema exists, runtime references absent

| Model | Status | Runtime refs (non-test) | Notes |
|---|---|---:|---|
| `auditEvent` | active | 7 | security/audit pipeline connected |
| `securityEvent` | active | 5 | security event stream connected |
| `securityAlert` | active | 2 | alert reads/writes connected |
| `incidentResponseEvent` | active | 4 | incident lifecycle connected |
| `abuseEvent` | active | 4 | abuse/rate-limit + queue anomaly hooks |
| `secretRotationEvent` | active | 3 | secret governance metadata active |
| `apiKeyRegistry` | active | 3 | API key governance active |
| `apiKeyUsage` | active | 3 | usage tracking active |
| `queueAccessScope` | active | 3 | queue scope enforcement active |
| `rateLimitBucket` | active | 2 | rate-limit persistence active |
| `webhookSigningKey` | dead/quarantined | 0 | no runtime integration yet |
| `securityScanRun` | active | 3 | supply-chain scan tracking active |
| `vulnerabilityFinding` | active | 5 | vuln ingestion/governance active |
| `releaseAttestation` | active | 2 | release lineage active |
| `dependencyInventorySnapshot` | active | 2 | inventory snapshots active |
| `dataClassification` | active | 6 | privacy classification active |
| `retentionPolicy` | active | 6 | retention governance active |
| `deletionRequest` | active | 10 | deletion workflow active |
| `dataAccessRequest` | active | 7 | access request workflow active |
| `consentRecord` | active | 4 | consent hooks active |
| `privacyExportJob` | active | 12 | export workflow active |
| `privacyDeletionJob` | active | 12 | deletion workflow active |
| `featureSnapshot` | active | 8 | PIT snapshot path active |
| `predictionRun` | active | 10 | immutable prediction runtime active |
| `predictionCandidate` | active | 1 | selection pipeline active |
| `publishDecision` | active | 5 | publish policy path active |
| `publishedPrediction` | active | 16 | public serving source active |
| `shadowPredictionComparison` | partial | 2 | still legacy baseline dependency for old side |
| `duplicateSuppressionStat` | active | 2 | dedup telemetry active |
| `prediction` | partial | 3 | residual legacy/shadow helper usage |

### 4.2 Idempotency constraints/index checks
- Confirmed stable uniqueness/index anchors in schema:
  - `PublishedPrediction @@id([matchId, market, lineKey, horizon])`
  - `PredictionCandidate @@unique([predictionRunId, selection])`
  - `QueueAccessScope @@unique([queueName, serviceIdentityId, environment])`
  - `ShadowPredictionComparison @@unique([matchId, market, lineKey, horizon])`
  - `RateLimitBucket bucketKey @unique`
  - `PrivacyExportJob jobKey @unique`
  - `PrivacyDeletionJob jobKey @unique`
  - `SecurityScanRun runKey @unique`
  - `VulnerabilityFinding findingKey @unique`
  - `DuplicateSuppressionStat dedupKey @unique`

### 4.3 Migration consistency (20260417_* / 20260418_*)
- Migration set present and ordered for Phase 1-5 packages.
- No destructive drop operations detected in audited migration SQL set (`DROP TABLE`, `DROP INDEX`, `ALTER TABLE ... DROP COLUMN` not found).
- Quarantine-first schema strategy preserved in this pass.

## 5) Production Blockers (P0)

P0 required items in this convergence pass are closed in code and test/build evidence.
No open P0 blockers were found after this implementation pass.

## 6) Prioritized Remediation Plan

### P1 (should fix before wider rollout)
1. Champion/challenger fallback transparency
   - Owner: X/API
   - Action: Make alias fallback explicit in serving telemetry and incident/audit path when fallback is used.
   - Verify: unit tests for fallback event emission + admin visibility endpoint checks.
2. Horizon/cutoff consistency audit extension
   - Owner: W/Workers + X/API
   - Action: add explicit runtime-vs-training parity assertions for horizon/cutoff.
   - Verify: deterministic parity tests on snapshot->prediction->dataset paths.
3. Enrichment fallback observability normalization
   - Owner: W/Workers
   - Action: standardize missing lineup/event/odds fallback signals across runtime and research.
   - Verify: event/log assertions + dashboard feed consistency tests.
4. Remove overlapping scheduler outcomes by domain
   - Owner: W/Workers
   - Action: deduplicate any remaining semantically-overlapping periodic jobs.
   - Verify: scheduler registration snapshot tests + queue metrics checks.

### P2 (cleanup/optimization)
1. Remove residual dead legacy helpers in `PredictionsService`.
   - Owner: X/API
   - Verify: typecheck + predictions tests + grep for unreachable legacy helpers.
2. Keep `webhook_signing_keys` quarantined until integrated or formally deprecated.
   - Owner: X/API
   - Verify: integration plan doc + explicit usage or deprecation ticket.
3. Consolidate overlapping rollback/emergency flags.
   - Owner: X/API + Security
   - Verify: single control matrix in config docs + regression tests.
4. Consolidate architecture/readiness docs into one canonical reference.
   - Owner: Coordinator
   - Verify: docs review and stale doc redirect/removal.

## 7) Runtime Evidence Snippets

### 7.1 Build/test gates
- `@sporx/api`
  - `typecheck` passed
  - `test --runInBand` passed (67 suites, 160 tests)
  - `build` passed
- `@sporx/public-web`
  - `test` passed (3 suites, 15 tests)
  - `build` passed
  - `typecheck` passed after Next type generation during build
- `@sporx/admin-web`
  - `test` passed (7 suites, 18 tests)
  - `build` passed
  - `typecheck` passed after Next type generation during build

### 7.2 Queue/security checks
- Privileged queue payload validation tests passed for bankroll/research/model-lifecycle/ingestion paths.
- Public-authority payload rejection behavior covered in runtime security tests.

### 7.3 Boundary checks
- Public proxy boundary tests confirm restricted route denial and no upstream forwarding for blocked routes.

---
Conclusion: The platform is materially converged for production-readiness scope in this pass, with P0 closed and remaining work concentrated in P1/P2 cleanup/transparency hardening.
