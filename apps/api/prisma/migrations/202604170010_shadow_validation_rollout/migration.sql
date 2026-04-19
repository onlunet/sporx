-- Shadow validation + rollout control tables (additive, safe for existing pipeline)
-- published_predictions nullable line safety is guaranteed via line_key primary key
-- (equivalent to NULLS NOT DISTINCT behavior for line in composite uniqueness).

CREATE TABLE IF NOT EXISTS shadow_prediction_comparisons (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  old_probability double precision,
  new_probability double precision,
  old_confidence double precision,
  new_confidence double precision,
  old_log_loss double precision,
  new_log_loss double precision,
  old_brier double precision,
  new_brier double precision,
  calibration_bins jsonb,
  coverage jsonb,
  latency_ms_old integer,
  latency_ms_new integer,
  duplicate_suppressed boolean NOT NULL DEFAULT false,
  leakage_violation boolean NOT NULL DEFAULT false,
  details jsonb,
  prediction_run_id text REFERENCES prediction_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, market, line_key, horizon)
);

CREATE INDEX IF NOT EXISTS idx_shadow_prediction_comparisons_created_at
  ON shadow_prediction_comparisons (created_at);
CREATE INDEX IF NOT EXISTS idx_shadow_prediction_comparisons_prediction_run
  ON shadow_prediction_comparisons (prediction_run_id);

CREATE TABLE IF NOT EXISTS leakage_check_results (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  horizon text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  source_leak_rows integer NOT NULL DEFAULT 0,
  odds_leak_rows integer NOT NULL DEFAULT 0,
  passed boolean NOT NULL DEFAULT true,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leakage_check_results_lookup
  ON leakage_check_results (match_id, horizon, cutoff_at);
CREATE INDEX IF NOT EXISTS idx_leakage_check_results_created_at
  ON leakage_check_results (created_at);

CREATE TABLE IF NOT EXISTS publish_failure_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id text,
  job_id text,
  match_id text,
  market text,
  line_key text,
  horizon text,
  dedup_key text,
  error_code text,
  error_message text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_publish_failure_logs_created_at
  ON publish_failure_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_publish_failure_logs_run_id
  ON publish_failure_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_publish_failure_logs_lookup
  ON publish_failure_logs (match_id, market, line_key, horizon);

CREATE TABLE IF NOT EXISTS duplicate_suppression_stats (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dedup_key text NOT NULL UNIQUE,
  match_id text,
  market text,
  line_key text,
  horizon text,
  suppressed_count integer NOT NULL DEFAULT 0,
  first_suppressed_at timestamptz NOT NULL DEFAULT now(),
  last_suppressed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_duplicate_suppression_stats_lookup
  ON duplicate_suppression_stats (match_id, market, line_key, horizon);
CREATE INDEX IF NOT EXISTS idx_duplicate_suppression_stats_last_suppressed_at
  ON duplicate_suppression_stats (last_suppressed_at);
