-- Publish Selection Engine + Abstain Policy + Strategy Layer

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublishDecisionStatus') THEN
    CREATE TYPE "PublishDecisionStatus" AS ENUM ('APPROVED','ABSTAINED','SUPPRESSED','BLOCKED','MANUALLY_FORCED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ManualOverrideAction') THEN
    CREATE TYPE "ManualOverrideAction" AS ENUM ('FORCE','BLOCK');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS publish_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publish_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES publish_policies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text NOT NULL,
  config_jsonb jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'publish_policies' AND constraint_name = 'publish_policies_current_version_id_fkey'
  ) THEN
    ALTER TABLE publish_policies
      ADD CONSTRAINT publish_policies_current_version_id_fkey
      FOREIGN KEY (current_version_id) REFERENCES publish_policy_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS publish_strategy_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES publish_policy_versions(id) ON DELETE CASCADE,
  profile_key text NOT NULL,
  name text NOT NULL,
  description text,
  league_id uuid REFERENCES "League"(id) ON DELETE SET NULL,
  market text,
  horizon text,
  config_jsonb jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prediction_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  selection text NOT NULL,
  prediction_run_id uuid NOT NULL REFERENCES prediction_runs(id) ON DELETE CASCADE,
  meta_model_run_id uuid REFERENCES meta_model_runs(id) ON DELETE SET NULL,
  model_version_id uuid REFERENCES "ModelVersion"(id) ON DELETE SET NULL,
  calibration_version_id text,
  core_probability double precision NOT NULL,
  refined_probability double precision,
  calibrated_probability double precision NOT NULL,
  confidence double precision NOT NULL,
  publish_score double precision NOT NULL,
  fair_odds double precision,
  edge double precision,
  freshness_score double precision,
  coverage_flags_jsonb jsonb,
  volatility_score double precision,
  provider_disagreement double precision,
  lineup_coverage double precision,
  event_coverage double precision,
  strategy_profile text NOT NULL,
  policy_version_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prediction_run_id, selection)
);

CREATE TABLE IF NOT EXISTS publish_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE REFERENCES prediction_candidates(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  selection text NOT NULL,
  prediction_run_id uuid NOT NULL REFERENCES prediction_runs(id) ON DELETE CASCADE,
  model_version_id uuid REFERENCES "ModelVersion"(id) ON DELETE SET NULL,
  calibration_version_id text,
  policy_version_id uuid REFERENCES publish_policy_versions(id) ON DELETE SET NULL,
  strategy_profile text NOT NULL,
  status "PublishDecisionStatus" NOT NULL,
  shadow_mode boolean NOT NULL DEFAULT false,
  selection_score double precision NOT NULL,
  confidence double precision NOT NULL,
  publish_score double precision NOT NULL,
  fair_odds double precision,
  edge double precision,
  freshness_score double precision,
  coverage_flags_jsonb jsonb,
  volatility_score double precision,
  provider_disagreement double precision,
  abstain_reasons_jsonb jsonb,
  details_jsonb jsonb,
  is_public_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS abstain_reason_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES publish_decisions(id) ON DELETE CASCADE,
  reason_code text NOT NULL,
  reason_text text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_conflict_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES publish_policy_versions(id) ON DELETE CASCADE,
  market_family text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  max_picks_per_match integer NOT NULL DEFAULT 1,
  allow_multi_horizon boolean NOT NULL DEFAULT false,
  suppress_correlated boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  config_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manual_publish_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  selection text,
  action "ManualOverrideAction" NOT NULL,
  reason text NOT NULL,
  actor_user_id uuid REFERENCES "User"(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_evaluation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  selection text NOT NULL,
  candidate_id uuid REFERENCES prediction_candidates(id) ON DELETE SET NULL,
  decision_id uuid REFERENCES publish_decisions(id) ON DELETE SET NULL,
  policy_version_id uuid REFERENCES publish_policy_versions(id) ON DELETE SET NULL,
  strategy_profile text NOT NULL,
  shadow_mode boolean NOT NULL DEFAULT false,
  approved boolean NOT NULL DEFAULT false,
  abstained boolean NOT NULL DEFAULT false,
  suppressed boolean NOT NULL DEFAULT false,
  blocked boolean NOT NULL DEFAULT false,
  candidate_metrics_jsonb jsonb,
  decision_metrics_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE published_predictions
  ADD COLUMN IF NOT EXISTS publish_decision_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'published_predictions' AND constraint_name = 'published_predictions_publish_decision_id_fkey'
  ) THEN
    ALTER TABLE published_predictions
      ADD CONSTRAINT published_predictions_publish_decision_id_fkey
      FOREIGN KEY (publish_decision_id) REFERENCES publish_decisions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS published_predictions_publish_decision_id_key
  ON published_predictions (publish_decision_id)
  WHERE publish_decision_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publish_policy_versions_lookup
  ON publish_policy_versions (policy_id, is_active, version);

CREATE INDEX IF NOT EXISTS idx_publish_strategy_profiles_lookup
  ON publish_strategy_profiles (policy_version_id, profile_key, is_active);

CREATE INDEX IF NOT EXISTS idx_publish_strategy_profiles_scope
  ON publish_strategy_profiles (league_id, market, horizon);

CREATE INDEX IF NOT EXISTS idx_prediction_candidates_lookup
  ON prediction_candidates (match_id, market, line_key, horizon, selection);

CREATE INDEX IF NOT EXISTS idx_prediction_candidates_profile
  ON prediction_candidates (strategy_profile, created_at);

CREATE INDEX IF NOT EXISTS idx_publish_decisions_lookup
  ON publish_decisions (match_id, market, line_key, horizon);

CREATE INDEX IF NOT EXISTS idx_publish_decisions_status
  ON publish_decisions (status, strategy_profile, created_at);

CREATE INDEX IF NOT EXISTS idx_publish_decisions_policy
  ON publish_decisions (policy_version_id, created_at);

CREATE INDEX IF NOT EXISTS idx_abstain_reason_logs_decision
  ON abstain_reason_logs (decision_id, reason_code);

CREATE INDEX IF NOT EXISTS idx_abstain_reason_logs_reason
  ON abstain_reason_logs (reason_code, created_at);

CREATE INDEX IF NOT EXISTS idx_market_conflict_rules_lookup
  ON market_conflict_rules (policy_version_id, market_family, is_active);

CREATE INDEX IF NOT EXISTS idx_manual_publish_overrides_lookup
  ON manual_publish_overrides (match_id, market, line_key, horizon, selection, active);

CREATE INDEX IF NOT EXISTS idx_manual_publish_overrides_created_at
  ON manual_publish_overrides (created_at);

CREATE INDEX IF NOT EXISTS idx_policy_evaluation_snapshots_profile
  ON policy_evaluation_snapshots (strategy_profile, created_at);

CREATE INDEX IF NOT EXISTS idx_policy_evaluation_snapshots_lookup
  ON policy_evaluation_snapshots (match_id, market, line_key, horizon);
