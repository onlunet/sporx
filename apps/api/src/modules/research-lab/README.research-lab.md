# Strategy Research Lab (Offline)

Bu modül canlı tahmin akışını değiştirmeden, **offline strateji araştırması** yapar.

## Akış

`freezeDataset -> generateConfigSet -> runTrial -> simulateTrial -> aggregateTrialMetrics -> runRobustnessChecks -> registerPolicyCandidate -> evaluatePromotionGate -> exportArtifacts`

- Tüm adımlar `research-lab` BullMQ kuyruğunda çalışır.
- Canlı ingestion/publish/bankroll kuyruklarından ayrıdır.
- Stage dedup anahtarı: `project + experiment + window + dataset_hash + seed + searchType`.

## Temel Varlıklar

- `research_projects`, `research_experiments`
- `strategy_config_sets`, `strategy_config_versions`
- `tuning_search_spaces`, `research_runs`
- `tuning_trials`, `tuning_trial_metrics`, `tuning_trial_artifacts`
- `robustness_test_runs`, `robustness_test_results`
- `segment_scorecards`
- `policy_candidates`, `policy_aliases`
- `policy_promotion_requests`, `policy_promotion_decisions`
- `experiment_notes`, `experiment_tags`

## Güvenlik ve Sınırlar

- Araştırma koşuları `published_predictions`, `model_aliases`, `prediction_runs`, `bankroll_*` canlı karar tabanını **doğrudan mutate etmez**.
- Promotion sonucu sadece research tablolarına yazılır; canlı cutover ayrı adım gerektirir.
- Trial pruning deterministic ve reason-logged çalışır.

## Admin Endpointleri

- `POST /api/v1/admin/research/projects`
- `POST /api/v1/admin/research/experiments`
- `POST /api/v1/admin/research/runs`
- `GET /api/v1/admin/research/runs`
- `GET /api/v1/admin/research/runs/compare?runIds=...`
- `GET /api/v1/admin/research/trials?runId=...`
- `GET /api/v1/admin/research/candidates`
- `POST /api/v1/admin/research/candidates/:id/promotion-request`
- `POST /api/v1/admin/research/promotion-gate/evaluate`
- `PATCH /api/v1/admin/research/flags`
- `GET /api/v1/admin/research/health`

## Flags

- `research_lab_enabled`
- `auto_tuning_enabled`
- `trial_pruning_enabled`
- `policy_candidate_registry_enabled`
- `policy_shadow_promotion_enabled`
- `policy_canary_promotion_enabled`
