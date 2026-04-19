-- Odds Meta-Model + Lineup/Event Enrichment schema expansion
-- additive migration with point-in-time correctness support

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'PlayerAvailabilityStatus'
  ) THEN
    CREATE TYPE "PlayerAvailabilityStatus" AS ENUM (
      'AVAILABLE',
      'BENCH',
      'OUT',
      'SUSPENDED',
      'INJURY_UNKNOWN'
    );
  END IF;
END $$;

ALTER TABLE prediction_runs
  ADD COLUMN IF NOT EXISTS refined_probability double precision,
  ADD COLUMN IF NOT EXISTS publish_score double precision,
  ADD COLUMN IF NOT EXISTS risk_adjusted_confidence double precision,
  ADD COLUMN IF NOT EXISTS refined_source text;

CREATE TABLE IF NOT EXISTS canonical_lineups (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  provider_id text REFERENCES "Provider"(id) ON DELETE SET NULL,
  provider_key text,
  formation text,
  source_updated_at timestamptz,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  lineup_hash text NOT NULL,
  payload_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, team_id, provider_key, lineup_hash)
);

CREATE INDEX IF NOT EXISTS idx_canonical_lineups_match_team_time
  ON canonical_lineups (match_id, team_id, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_canonical_lineups_provider_time
  ON canonical_lineups (provider_id, source_updated_at);

CREATE TABLE IF NOT EXISTS canonical_lineup_player_availability (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_lineup_id text NOT NULL REFERENCES canonical_lineups(id) ON DELETE CASCADE,
  player_id text REFERENCES "Player"(id) ON DELETE SET NULL,
  player_name text NOT NULL,
  position text,
  jersey_number integer,
  availability "PlayerAvailabilityStatus" NOT NULL,
  is_starter boolean NOT NULL DEFAULT false,
  sort_order integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_lineup_player_availability_lookup
  ON canonical_lineup_player_availability (canonical_lineup_id, availability, is_starter);
CREATE INDEX IF NOT EXISTS idx_canonical_lineup_player_availability_player
  ON canonical_lineup_player_availability (player_id);

CREATE TABLE IF NOT EXISTS lineup_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  horizon text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  lineup_hash text NOT NULL,
  lineup_jsonb jsonb NOT NULL,
  coverage_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, horizon, cutoff_at, lineup_hash)
);

CREATE INDEX IF NOT EXISTS idx_lineup_snapshots_match_horizon_cutoff
  ON lineup_snapshots (match_id, horizon, cutoff_at);

CREATE TABLE IF NOT EXISTS event_aggregate_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  horizon text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  aggregate_hash text NOT NULL,
  aggregate_jsonb jsonb NOT NULL,
  coverage_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, horizon, cutoff_at, aggregate_hash)
);

CREATE INDEX IF NOT EXISTS idx_event_aggregate_snapshots_match_horizon_cutoff
  ON event_aggregate_snapshots (match_id, horizon, cutoff_at);

CREATE TABLE IF NOT EXISTS market_consensus_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  horizon text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  consensus_hash text NOT NULL,
  consensus_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, horizon, cutoff_at, consensus_hash)
);

CREATE INDEX IF NOT EXISTS idx_market_consensus_snapshots_match_horizon_cutoff
  ON market_consensus_snapshots (match_id, horizon, cutoff_at);

CREATE TABLE IF NOT EXISTS meta_model_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  prediction_run_id text REFERENCES prediction_runs(id) ON DELETE SET NULL,
  lineup_snapshot_id text REFERENCES lineup_snapshots(id) ON DELETE SET NULL,
  event_aggregate_snapshot_id text REFERENCES event_aggregate_snapshots(id) ON DELETE SET NULL,
  market_consensus_snapshot_id text REFERENCES market_consensus_snapshots(id) ON DELETE SET NULL,
  model_version text NOT NULL,
  core_probability double precision NOT NULL,
  refined_probability double precision NOT NULL,
  publish_score double precision NOT NULL,
  risk_adjusted_confidence double precision NOT NULL,
  is_fallback boolean NOT NULL DEFAULT false,
  fallback_reason text,
  feature_coverage_jsonb jsonb,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_model_runs_lookup
  ON meta_model_runs (match_id, market, line_key, horizon, cutoff_at);
CREATE INDEX IF NOT EXISTS idx_meta_model_runs_prediction_run
  ON meta_model_runs (prediction_run_id);
CREATE INDEX IF NOT EXISTS idx_meta_model_runs_model_version
  ON meta_model_runs (model_version, created_at);
