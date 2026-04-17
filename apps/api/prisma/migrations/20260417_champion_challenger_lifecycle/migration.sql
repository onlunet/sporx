-- Champion/Challenger Automation + Retraining & Drift Orchestration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ServingAliasType') THEN
    CREATE TYPE "ServingAliasType" AS ENUM (
      'CHAMPION',
      'CHALLENGER',
      'SHADOW',
      'CANARY',
      'ROLLBACK_CANDIDATE',
      'RETIRED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PromotionDecisionStatus') THEN
    CREATE TYPE "PromotionDecisionStatus" AS ENUM (
      'PROMOTE',
      'KEEP_CHAMPION',
      'EXTEND_SHADOW',
      'BLOCK_PROMOTION',
      'FORCE_PROMOTE',
      'FORCE_KEEP'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DriftSeverity') THEN
    CREATE TYPE "DriftSeverity" AS ENUM ('INFO','WARNING','CRITICAL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DriftMonitorCategory') THEN
    CREATE TYPE "DriftMonitorCategory" AS ENUM ('UNLABELED','LABELED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RetrainingTriggerType') THEN
    CREATE TYPE "RetrainingTriggerType" AS ENUM (
      'SCHEDULE',
      'DRIFT_THRESHOLD',
      'NEW_LABELS',
      'MANUAL',
      'CANARY_UNDERPERFORMANCE',
      'SEASONAL_RESET'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LifecycleRunStatus') THEN
    CREATE TYPE "LifecycleRunStatus" AS ENUM ('queued','running','succeeded','failed','cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS training_datasets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  feature_set_version text,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  dataset_hash text NOT NULL UNIQUE,
  inclusion_boundaries_jsonb jsonb,
  leakage_checks_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  training_dataset_id text NOT NULL REFERENCES training_datasets(id) ON DELETE CASCADE,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  horizon text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  feature_snapshot_id text REFERENCES feature_snapshots(id) ON DELETE SET NULL,
  label_jsonb jsonb,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (training_dataset_id, match_id, horizon, cutoff_at)
);

CREATE TABLE IF NOT EXISTS label_collection_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  status "LifecycleRunStatus" NOT NULL DEFAULT 'queued',
  dedup_key text NOT NULL UNIQUE,
  labels_collected integer NOT NULL DEFAULT 0,
  from_match_date timestamptz,
  to_match_date timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  trigger_type "RetrainingTriggerType",
  training_dataset_id text REFERENCES training_datasets(id) ON DELETE SET NULL,
  model_version_id text REFERENCES "ModelVersion"(id) ON DELETE SET NULL,
  status "LifecycleRunStatus" NOT NULL DEFAULT 'queued',
  dedup_key text NOT NULL UNIQUE,
  config_jsonb jsonb,
  metrics_jsonb jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_registry_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  feature_set_version text,
  training_dataset_id text REFERENCES training_datasets(id) ON DELETE SET NULL,
  evaluation_window_start timestamptz,
  evaluation_window_end timestamptz,
  status text NOT NULL DEFAULT 'registered',
  decision_reasons_jsonb jsonb,
  actor text NOT NULL DEFAULT 'system',
  metadata_jsonb jsonb,
  effective_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_aliases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  alias_type "ServingAliasType" NOT NULL,
  model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  feature_set_version text,
  policy_version text,
  rollout_percent double precision NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  effective_at timestamptz,
  actor text NOT NULL DEFAULT 'system',
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, market, line_key, horizon, scope_league_key, alias_type)
);

CREATE TABLE IF NOT EXISTS calibration_aliases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  alias_type "ServingAliasType" NOT NULL,
  calibration_version_id text NOT NULL REFERENCES "PredictionCalibration"(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  effective_at timestamptz,
  actor text NOT NULL DEFAULT 'system',
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, market, line_key, horizon, scope_league_key, alias_type)
);

CREATE TABLE IF NOT EXISTS shadow_eval_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  champion_model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  challenger_model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  evaluation_window_start timestamptz NOT NULL,
  evaluation_window_end timestamptz NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  status "LifecycleRunStatus" NOT NULL DEFAULT 'queued',
  metrics_jsonb jsonb,
  coverage_jsonb jsonb,
  latency_jsonb jsonb,
  fallback_rate double precision,
  dedup_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS challenger_evaluations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  champion_model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  challenger_model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  shadow_eval_run_id text REFERENCES shadow_eval_runs(id) ON DELETE SET NULL,
  evaluation_window_start timestamptz NOT NULL,
  evaluation_window_end timestamptz NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  metrics_jsonb jsonb NOT NULL,
  segment_metrics_jsonb jsonb,
  status text NOT NULL DEFAULT 'shadow_completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_decisions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  champion_model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  challenger_model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  champion_calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  challenger_calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  challenger_evaluation_id text REFERENCES challenger_evaluations(id) ON DELETE SET NULL,
  status "PromotionDecisionStatus" NOT NULL,
  decision_reasons_jsonb jsonb NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  minimum_sample_size_met boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz
);

CREATE TABLE IF NOT EXISTS rollback_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  from_model_version_id text REFERENCES "ModelVersion"(id) ON DELETE SET NULL,
  to_model_version_id text REFERENCES "ModelVersion"(id) ON DELETE SET NULL,
  from_calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  to_calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  reason text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz,
  metadata_jsonb jsonb
);

CREATE TABLE IF NOT EXISTS serving_alias_history (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  model_alias_id text NOT NULL REFERENCES model_aliases(id) ON DELETE CASCADE,
  previous_model_version_id text REFERENCES "ModelVersion"(id) ON DELETE SET NULL,
  new_model_version_id text REFERENCES "ModelVersion"(id) ON DELETE SET NULL,
  previous_calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  new_calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  actor text NOT NULL DEFAULT 'system',
  reason text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz
);

CREATE TABLE IF NOT EXISTS drift_monitors (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  monitor_name text NOT NULL,
  category "DriftMonitorCategory" NOT NULL,
  threshold_warning double precision,
  threshold_critical double precision,
  baseline_jsonb jsonb,
  config_jsonb jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, market, line_key, horizon, scope_league_key, monitor_name)
);

CREATE TABLE IF NOT EXISTS drift_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  drift_monitor_id text REFERENCES drift_monitors(id) ON DELETE SET NULL,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  severity "DriftSeverity" NOT NULL,
  metric_name text NOT NULL,
  metric_value double precision NOT NULL,
  baseline_value double precision,
  threshold_value double precision,
  window_start timestamptz,
  window_end timestamptz,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS retraining_triggers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  trigger_type "RetrainingTriggerType" NOT NULL,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  reason_payload_jsonb jsonb NOT NULL,
  source_metric_snapshot_jsonb jsonb,
  dedup_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued',
  final_action_taken text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS rollout_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  alias_type "ServingAliasType" NOT NULL,
  bucket_start integer NOT NULL,
  bucket_end integer NOT NULL,
  model_alias_id text REFERENCES model_aliases(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_health_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  scope_league_key text NOT NULL DEFAULT 'global',
  model_version_id text NOT NULL REFERENCES "ModelVersion"(id) ON DELETE CASCADE,
  calibration_version_id text REFERENCES "PredictionCalibration"(id) ON DELETE SET NULL,
  alias_type "ServingAliasType",
  sample_size integer NOT NULL DEFAULT 0,
  log_loss double precision,
  brier_score double precision,
  calibration_drift double precision,
  publish_rate double precision,
  abstain_rate double precision,
  latency_p95_ms double precision,
  fallback_rate double precision,
  error_rate double precision,
  coverage_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_datasets_scope
  ON training_datasets (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_dataset_snapshots_lookup
  ON dataset_snapshots (match_id, horizon, cutoff_at);

CREATE INDEX IF NOT EXISTS idx_label_collection_runs_scope
  ON label_collection_runs (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_training_runs_scope
  ON training_runs (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_training_runs_status
  ON training_runs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_model_registry_entries_scope
  ON model_registry_entries (sport, market, line_key, horizon, scope_league_key, status);

CREATE INDEX IF NOT EXISTS idx_model_registry_entries_model
  ON model_registry_entries (model_version_id, created_at);

CREATE INDEX IF NOT EXISTS idx_model_aliases_scope
  ON model_aliases (sport, market, line_key, horizon, scope_league_key, is_active);

CREATE INDEX IF NOT EXISTS idx_model_aliases_model
  ON model_aliases (model_version_id, created_at);

CREATE INDEX IF NOT EXISTS idx_calibration_aliases_scope
  ON calibration_aliases (sport, market, line_key, horizon, scope_league_key, is_active);

CREATE INDEX IF NOT EXISTS idx_shadow_eval_runs_scope
  ON shadow_eval_runs (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_shadow_eval_runs_status
  ON shadow_eval_runs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_challenger_evaluations_scope
  ON challenger_evaluations (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_challenger_evaluations_models
  ON challenger_evaluations (champion_model_version_id, challenger_model_version_id, created_at);

CREATE INDEX IF NOT EXISTS idx_promotion_decisions_scope
  ON promotion_decisions (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_promotion_decisions_status
  ON promotion_decisions (status, created_at);

CREATE INDEX IF NOT EXISTS idx_rollback_events_scope
  ON rollback_events (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_serving_alias_history_alias
  ON serving_alias_history (model_alias_id, created_at);

CREATE INDEX IF NOT EXISTS idx_drift_monitors_active
  ON drift_monitors (is_active, created_at);

CREATE INDEX IF NOT EXISTS idx_drift_events_severity
  ON drift_events (severity, created_at);

CREATE INDEX IF NOT EXISTS idx_drift_events_scope
  ON drift_events (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_retraining_triggers_status
  ON retraining_triggers (status, created_at);

CREATE INDEX IF NOT EXISTS idx_retraining_triggers_scope
  ON retraining_triggers (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_rollout_assignments_scope
  ON rollout_assignments (sport, market, line_key, horizon, scope_league_key, alias_type, is_active);

CREATE INDEX IF NOT EXISTS idx_model_health_snapshots_scope
  ON model_health_snapshots (sport, market, line_key, horizon, scope_league_key, created_at);

CREATE INDEX IF NOT EXISTS idx_model_health_snapshots_model
  ON model_health_snapshots (model_version_id, created_at);
