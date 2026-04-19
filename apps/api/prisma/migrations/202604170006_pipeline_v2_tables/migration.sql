-- Pipeline v2 additive tables (raw -> canonical -> features -> odds -> prediction runs -> published)

CREATE TABLE IF NOT EXISTS raw_provider_payloads (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider text NOT NULL,
  entity_type text NOT NULL,
  provider_entity_id text,
  source_updated_at timestamptz,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NOT NULL,
  payload_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, entity_type, provider_entity_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_raw_provider_payloads_lookup
  ON raw_provider_payloads (provider, entity_type, provider_entity_id, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_raw_provider_payloads_pulled_at
  ON raw_provider_payloads (pulled_at);

CREATE TABLE IF NOT EXISTS canonical_match_revisions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  source_priority integer NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  payload_hash text NOT NULL,
  merged_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_canonical_match_revisions_current
  ON canonical_match_revisions (match_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_canonical_match_revisions_valid_from
  ON canonical_match_revisions (match_id, valid_from);

CREATE TABLE IF NOT EXISTS feature_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  horizon text NOT NULL,
  feature_set_version text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  feature_hash text NOT NULL,
  features_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, horizon, feature_set_version, cutoff_at, feature_hash)
);

CREATE INDEX IF NOT EXISTS idx_feature_snapshots_lookup
  ON feature_snapshots (match_id, horizon, cutoff_at);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  provider text,
  bookmaker text NOT NULL,
  market text NOT NULL,
  line double precision,
  selection text NOT NULL,
  decimal_odds double precision NOT NULL,
  raw_implied_prob double precision NOT NULL,
  normalized_prob double precision NOT NULL,
  shin_prob double precision,
  collected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odds_snapshots_match_market
  ON odds_snapshots (match_id, market, line, collected_at);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_bookmaker_market
  ON odds_snapshots (bookmaker, market, line, collected_at);

CREATE TABLE IF NOT EXISTS prediction_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  feature_snapshot_id text REFERENCES feature_snapshots(id) ON DELETE SET NULL,
  odds_snapshot_id text REFERENCES odds_snapshots(id) ON DELETE SET NULL,
  model_version_id text REFERENCES "ModelVersion"(id) ON DELETE SET NULL,
  calibration_version_id text,
  probability double precision NOT NULL,
  fair_odds double precision,
  edge double precision,
  confidence double precision NOT NULL,
  risk_flags_jsonb jsonb NOT NULL,
  explanation_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prediction_runs_match_created
  ON prediction_runs (match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prediction_runs_market_line
  ON prediction_runs (market, line, horizon, created_at);
CREATE INDEX IF NOT EXISTS idx_prediction_runs_model_version
  ON prediction_runs (model_version_id, created_at);

CREATE TABLE IF NOT EXISTS published_predictions (
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  prediction_run_id text NOT NULL REFERENCES prediction_runs(id) ON DELETE CASCADE,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, market, line_key, horizon)
);

CREATE INDEX IF NOT EXISTS idx_published_predictions_run
  ON published_predictions (prediction_run_id);
