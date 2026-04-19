-- Strategy Research Lab + Auto-Tuning / Policy Optimization (offline only)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResearchRunStatus') THEN
    CREATE TYPE "ResearchRunStatus" AS ENUM ('queued','running','succeeded','failed','cancelled','pruned');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TuningSearchType') THEN
    CREATE TYPE "TuningSearchType" AS ENUM ('GRID','RANDOM','OPTUNA_COMPAT');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StrategyObjective') THEN
    CREATE TYPE "StrategyObjective" AS ENUM (
      'LOG_GROWTH',
      'ROI',
      'YIELD',
      'MIN_MAX_DRAWDOWN',
      'SHARPE',
      'CALIBRATION_QUALITY',
      'RISK_OF_RUIN',
      'COMPOSITE'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PolicyCandidateStatus') THEN
    CREATE TYPE "PolicyCandidateStatus" AS ENUM (
      'DRAFT',
      'CANDIDATE',
      'UNDER_REVIEW',
      'APPROVED_FOR_SHADOW',
      'APPROVED_FOR_CANARY',
      'REJECTED',
      'RETIRED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PolicyPromotionDecisionStatus') THEN
    CREATE TYPE "PolicyPromotionDecisionStatus" AS ENUM (
      'APPROVE_SHADOW',
      'APPROVE_CANARY',
      'REQUIRE_MORE_EVIDENCE',
      'REJECT',
      'FORCE_APPROVE',
      'FORCE_REJECT'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS research_projects (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  sport text NOT NULL DEFAULT 'football',
  active boolean NOT NULL DEFAULT true,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_experiments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  objective "StrategyObjective" NOT NULL,
  objective_definition_jsonb jsonb NOT NULL,
  seed integer,
  status "ResearchRunStatus" NOT NULL DEFAULT 'queued',
  data_window_start timestamptz,
  data_window_end timestamptz,
  sport text NOT NULL DEFAULT 'football',
  market_scope_jsonb jsonb,
  horizon_scope_jsonb jsonb,
  league_scope_jsonb jsonb,
  feature_set_version text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS strategy_config_sets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  experiment_id text NOT NULL REFERENCES research_experiments(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  scope_jsonb jsonb,
  is_active boolean NOT NULL DEFAULT true,
  current_version_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, key)
);

CREATE TABLE IF NOT EXISTS strategy_config_versions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  config_set_id text NOT NULL REFERENCES strategy_config_sets(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text NOT NULL,
  config_hash text NOT NULL,
  config_jsonb jsonb NOT NULL,
  immutable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (config_set_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'strategy_config_sets' AND constraint_name = 'strategy_config_sets_current_version_id_fkey'
  ) THEN
    ALTER TABLE strategy_config_sets
      ADD CONSTRAINT strategy_config_sets_current_version_id_fkey
      FOREIGN KEY (current_version_id) REFERENCES strategy_config_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tuning_search_spaces (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  experiment_id text NOT NULL REFERENCES research_experiments(id) ON DELETE CASCADE,
  key text NOT NULL,
  version integer NOT NULL,
  search_type "TuningSearchType" NOT NULL,
  search_space_jsonb jsonb NOT NULL,
  constraints_jsonb jsonb,
  seed integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, key, version)
);

CREATE TABLE IF NOT EXISTS research_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  experiment_id text NOT NULL REFERENCES research_experiments(id) ON DELETE CASCADE,
  strategy_config_set_id text REFERENCES strategy_config_sets(id) ON DELETE SET NULL,
  strategy_config_version_id text REFERENCES strategy_config_versions(id) ON DELETE SET NULL,
  search_space_id text REFERENCES tuning_search_spaces(id) ON DELETE SET NULL,
  run_key text NOT NULL UNIQUE,
  status "ResearchRunStatus" NOT NULL DEFAULT 'queued',
  data_window_start timestamptz NOT NULL,
  data_window_end timestamptz NOT NULL,
  sport text NOT NULL DEFAULT 'football',
  league_scope_jsonb jsonb,
  market_scope_jsonb jsonb,
  horizon_scope_jsonb jsonb,
  objective_metric text NOT NULL,
  secondary_metrics_jsonb jsonb,
  seed integer,
  dataset_hashes_jsonb jsonb NOT NULL,
  feature_set_version text,
  model_refs_jsonb jsonb,
  policy_refs_jsonb jsonb,
  bankroll_profile text,
  notes text,
  tags_jsonb jsonb,
  metrics_jsonb jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_run_artifacts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  research_run_id text NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  artifact_key text NOT NULL,
  artifact_uri text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_run_id, artifact_key)
);

CREATE TABLE IF NOT EXISTS tuning_trials (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  research_run_id text NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  strategy_config_version_id text REFERENCES strategy_config_versions(id) ON DELETE SET NULL,
  trial_number integer NOT NULL,
  trial_key text NOT NULL UNIQUE,
  status "ResearchRunStatus" NOT NULL DEFAULT 'queued',
  config_hash text NOT NULL,
  config_jsonb jsonb NOT NULL,
  seed integer,
  pruned boolean NOT NULL DEFAULT false,
  prune_reason text,
  metrics_jsonb jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_run_id, trial_number)
);

CREATE TABLE IF NOT EXISTS tuning_trial_metrics (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tuning_trial_id text NOT NULL REFERENCES tuning_trials(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  metric_value double precision NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tuning_trial_id, metric_key)
);

CREATE TABLE IF NOT EXISTS tuning_trial_artifacts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tuning_trial_id text NOT NULL REFERENCES tuning_trials(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  artifact_key text NOT NULL,
  artifact_uri text,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tuning_trial_id, artifact_key)
);

CREATE TABLE IF NOT EXISTS robustness_test_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  research_run_id text NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  status "ResearchRunStatus" NOT NULL DEFAULT 'queued',
  robustness_score double precision,
  summary_jsonb jsonb,
  flags_jsonb jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS robustness_test_results (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  robustness_test_run_id text NOT NULL REFERENCES robustness_test_runs(id) ON DELETE CASCADE,
  check_name text NOT NULL,
  passed boolean NOT NULL,
  score double precision,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segment_scorecards (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  research_run_id text NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  segment_type text NOT NULL,
  segment_key text NOT NULL,
  metrics_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_candidates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  experiment_id text NOT NULL REFERENCES research_experiments(id) ON DELETE CASCADE,
  research_run_id text NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  best_trial_id text REFERENCES tuning_trials(id) ON DELETE SET NULL,
  strategy_config_version_id text REFERENCES strategy_config_versions(id) ON DELETE SET NULL,
  search_space_id text REFERENCES tuning_search_spaces(id) ON DELETE SET NULL,
  robustness_test_run_id text REFERENCES robustness_test_runs(id) ON DELETE SET NULL,
  key text NOT NULL UNIQUE,
  status "PolicyCandidateStatus" NOT NULL DEFAULT 'DRAFT',
  summary_jsonb jsonb,
  objective_definition_jsonb jsonb,
  dataset_hashes_jsonb jsonb,
  immutable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_aliases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sport text NOT NULL DEFAULT 'football',
  league_id text REFERENCES "League"(id) ON DELETE SET NULL,
  market text,
  horizon text,
  alias_key text NOT NULL,
  policy_candidate_id text REFERENCES policy_candidates(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, league_id, market, horizon, alias_key)
);

CREATE TABLE IF NOT EXISTS policy_promotion_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  policy_candidate_id text NOT NULL REFERENCES policy_candidates(id) ON DELETE CASCADE,
  research_run_id text REFERENCES research_runs(id) ON DELETE SET NULL,
  requested_by text NOT NULL DEFAULT 'system',
  reason text,
  evidence_jsonb jsonb,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS policy_promotion_decisions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  policy_promotion_request_id text NOT NULL UNIQUE REFERENCES policy_promotion_requests(id) ON DELETE CASCADE,
  policy_candidate_id text NOT NULL REFERENCES policy_candidates(id) ON DELETE CASCADE,
  decision_status "PolicyPromotionDecisionStatus" NOT NULL,
  decision_reasons_jsonb jsonb NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz
);

CREATE TABLE IF NOT EXISTS experiment_notes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text REFERENCES research_projects(id) ON DELETE SET NULL,
  experiment_id text REFERENCES research_experiments(id) ON DELETE SET NULL,
  research_run_id text REFERENCES research_runs(id) ON DELETE SET NULL,
  author text NOT NULL DEFAULT 'system',
  note_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiment_tags (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text REFERENCES research_projects(id) ON DELETE SET NULL,
  experiment_id text REFERENCES research_experiments(id) ON DELETE SET NULL,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_projects_lookup
  ON research_projects (sport, active, created_at);
CREATE INDEX IF NOT EXISTS idx_research_experiments_project
  ON research_experiments (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_research_experiments_status
  ON research_experiments (sport, status, created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_config_sets_experiment
  ON strategy_config_sets (experiment_id, is_active, created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_config_versions_set
  ON strategy_config_versions (config_set_id, created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_config_versions_hash
  ON strategy_config_versions (config_hash);
CREATE INDEX IF NOT EXISTS idx_tuning_search_spaces_experiment
  ON tuning_search_spaces (experiment_id, is_active, created_at);
CREATE INDEX IF NOT EXISTS idx_research_runs_scope
  ON research_runs (project_id, experiment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_research_runs_status
  ON research_runs (sport, status, created_at);
CREATE INDEX IF NOT EXISTS idx_research_run_artifacts_lookup
  ON research_run_artifacts (research_run_id, artifact_type, created_at);
CREATE INDEX IF NOT EXISTS idx_tuning_trials_lookup
  ON tuning_trials (research_run_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tuning_trials_hash
  ON tuning_trials (config_hash);
CREATE INDEX IF NOT EXISTS idx_tuning_trial_metrics_metric
  ON tuning_trial_metrics (metric_key, created_at);
CREATE INDEX IF NOT EXISTS idx_tuning_trial_artifacts_lookup
  ON tuning_trial_artifacts (tuning_trial_id, artifact_type, created_at);
CREATE INDEX IF NOT EXISTS idx_robustness_test_runs_lookup
  ON robustness_test_runs (research_run_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_robustness_test_results_lookup
  ON robustness_test_results (robustness_test_run_id, check_name);
CREATE INDEX IF NOT EXISTS idx_segment_scorecards_lookup
  ON segment_scorecards (research_run_id, segment_type, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_candidates_lookup
  ON policy_candidates (project_id, experiment_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_candidates_run
  ON policy_candidates (research_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_aliases_lookup
  ON policy_aliases (sport, is_active, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_promotion_requests_lookup
  ON policy_promotion_requests (policy_candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_promotion_requests_status
  ON policy_promotion_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_promotion_decisions_lookup
  ON policy_promotion_decisions (policy_candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_promotion_decisions_status
  ON policy_promotion_decisions (decision_status, created_at);
CREATE INDEX IF NOT EXISTS idx_experiment_notes_lookup
  ON experiment_notes (project_id, experiment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_experiment_notes_run
  ON experiment_notes (research_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_experiment_tags_lookup
  ON experiment_tags (project_id, experiment_id, tag);
CREATE INDEX IF NOT EXISTS idx_experiment_tags_tag
  ON experiment_tags (tag, created_at);
