# Bankroll / Portfolio Layer (v1, paper-only)

Flow:

`published selection -> stake candidate -> stake sizing -> exposure check -> correlation check -> ticket construction (single) -> paper execution -> settlement -> ledger accounting -> equity curve -> ROI governance`

Core rules:

- Only `APPROVED` / `MANUALLY_FORCED` published selections are consumed.
- Public prediction decisions are never mutated by bankroll processing.
- v1 is paper-only (`PAPER` / `SANDBOX` account modes).
- Default profile is `CAPPED_FRACTIONAL_KELLY`.
- All monetary mutations are ledger-based and idempotent.

Queue stages (`bankroll`):

1. `stakeCandidateBuild`
2. `stakeSizing`
3. `exposureCheck`
4. `correlationCheck`
5. `ticketConstruction`
6. `portfolioDecision`
7. `paperExecution`
8. `settlement`
9. `bankrollAccounting`
10. `simulationAnalytics`
11. `roiGovernance`

Admin endpoints:

- `GET /api/v1/admin/bankroll/summary`
- `GET /api/v1/admin/bankroll/equity-curve`
- `GET /api/v1/admin/bankroll/exposure`
- `GET /api/v1/admin/bankroll/stake-funnel`
- `GET /api/v1/admin/bankroll/settlements`
- `GET /api/v1/admin/bankroll/governance`
- `POST /api/v1/admin/bankroll/simulate`
- `POST /api/v1/admin/bankroll/governance/evaluate`

Feature flags (`SystemSetting`):

- `bankroll_layer_enabled`
- `paper_execution_enabled`
- `staking_profile_default`
- `correlation_checks_enabled`
- `exposure_governance_enabled`
- `roi_governance_enabled`
- `research_mode_multileg_enabled`
- `bankroll_emergency_kill_switch`
