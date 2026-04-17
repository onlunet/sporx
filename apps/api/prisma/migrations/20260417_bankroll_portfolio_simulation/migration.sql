-- Bankroll / Portfolio Simulation + Ticket Construction + ROI Governance

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BankrollAccountMode') THEN
    CREATE TYPE "BankrollAccountMode" AS ENUM ('PAPER','SANDBOX','LIVE_DISABLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BankrollProfileKey') THEN
    CREATE TYPE "BankrollProfileKey" AS ENUM ('FLAT_UNIT','FRACTIONAL_KELLY','CAPPED_FRACTIONAL_KELLY','RISK_BUDGETED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StakeDecisionStatus') THEN
    CREATE TYPE "StakeDecisionStatus" AS ENUM ('CREATED','NO_STAKE','SIZED','CLIPPED','BLOCKED','SKIPPED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketDecisionStatus') THEN
    CREATE TYPE "TicketDecisionStatus" AS ENUM ('CREATED','CLIPPED','BLOCKED','SKIPPED','EXECUTED_PAPER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaperOrderStatus') THEN
    CREATE TYPE "PaperOrderStatus" AS ENUM ('OPEN','WON','LOST','VOID','PUSH','HALF_WON','HALF_LOST','CANCELLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoiGovernanceStatus') THEN
    CREATE TYPE "RoiGovernanceStatus" AS ENUM ('HEALTHY','WATCH','THROTTLED','BLOCKED','MANUAL_OVERRIDE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExposureLimitBehavior') THEN
    CREATE TYPE "ExposureLimitBehavior" AS ENUM ('ALLOW','CLIP','BLOCK');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExposureScopeType') THEN
    CREATE TYPE "ExposureScopeType" AS ENUM (
      'MATCH','LEAGUE','SPORT','MARKET_FAMILY','HORIZON','CALENDAR_DAY','ROLLING_7D','OPEN_TOTAL','CONCURRENT_OPEN'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BankrollLedgerEntryType') THEN
    CREATE TYPE "BankrollLedgerEntryType" AS ENUM (
      'ORDER_OPEN','ORDER_SETTLE','MANUAL_ADJUSTMENT','RESERVE_RELEASE','RECOMPUTE_CORRECTION'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SimulationRunStatus') THEN
    CREATE TYPE "SimulationRunStatus" AS ENUM ('queued','running','succeeded','failed','cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bankroll_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mode "BankrollAccountMode" NOT NULL DEFAULT 'PAPER',
  base_currency text NOT NULL DEFAULT 'USD',
  profile_default "BankrollProfileKey" NOT NULL DEFAULT 'CAPPED_FRACTIONAL_KELLY',
  status "RoiGovernanceStatus" NOT NULL DEFAULT 'HEALTHY',
  starting_balance double precision NOT NULL DEFAULT 1000,
  available_balance double precision NOT NULL DEFAULT 1000,
  reserved_balance double precision NOT NULL DEFAULT 0,
  realized_pnl double precision NOT NULL DEFAULT 0,
  unrealized_exposure double precision NOT NULL DEFAULT 0,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bankroll_account_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  available_balance double precision NOT NULL,
  reserved_balance double precision NOT NULL,
  total_equity double precision NOT NULL,
  realized_pnl double precision NOT NULL,
  unrealized_exposure double precision NOT NULL,
  drawdown_pct double precision,
  source text NOT NULL DEFAULT 'accounting',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bankroll_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  profile_key "BankrollProfileKey" NOT NULL,
  version integer NOT NULL,
  config_jsonb jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bankroll_account_id, profile_key, version)
);

CREATE TABLE IF NOT EXISTS staking_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staking_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staking_policy_id uuid NOT NULL REFERENCES staking_policies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text NOT NULL,
  config_jsonb jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staking_policy_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='staking_policies' AND constraint_name='staking_policies_current_version_id_fkey'
  ) THEN
    ALTER TABLE staking_policies
      ADD CONSTRAINT staking_policies_current_version_id_fkey
      FOREIGN KEY (current_version_id) REFERENCES staking_policy_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stake_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL,
  match_id uuid NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  selection text NOT NULL,
  published_prediction_id text NOT NULL,
  prediction_run_id uuid,
  model_version_id uuid,
  calibration_version_id uuid,
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  profile_key "BankrollProfileKey" NOT NULL,
  staking_policy_version_id uuid REFERENCES staking_policy_versions(id) ON DELETE SET NULL,
  calibrated_probability double precision NOT NULL,
  fair_odds double precision,
  offered_odds double precision,
  edge double precision,
  confidence double precision NOT NULL,
  publish_score double precision NOT NULL,
  freshness_score double precision,
  coverage_flags_jsonb jsonb,
  volatility_score double precision,
  provider_disagreement double precision,
  recommended_fraction double precision,
  recommended_stake double precision,
  clipped_stake double precision,
  decision_status "StakeDecisionStatus" NOT NULL DEFAULT 'CREATED',
  reasons_jsonb jsonb,
  dedup_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stake_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stake_candidate_id uuid NOT NULL UNIQUE REFERENCES stake_candidates(id) ON DELETE CASCADE,
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  profile_key "BankrollProfileKey" NOT NULL,
  staking_policy_version_id uuid REFERENCES staking_policy_versions(id) ON DELETE SET NULL,
  recommended_fraction double precision,
  recommended_stake double precision,
  clipped_stake double precision,
  decision_status "StakeDecisionStatus" NOT NULL DEFAULT 'CREATED',
  reasons_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exposure_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  scope_type "ExposureScopeType" NOT NULL,
  scope_key text NOT NULL,
  behavior "ExposureLimitBehavior" NOT NULL DEFAULT 'CLIP',
  max_fraction double precision,
  max_amount double precision,
  config_jsonb jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exposure_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  scope_type "ExposureScopeType" NOT NULL,
  scope_key text NOT NULL,
  open_exposure double precision NOT NULL,
  bankroll_value double precision NOT NULL,
  utilization double precision NOT NULL,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS correlation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  group_key text NOT NULL,
  market_family text NOT NULL,
  correlation_score double precision NOT NULL DEFAULT 0,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bankroll_account_id, group_key)
);

CREATE TABLE IF NOT EXISTS ticket_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  stake_recommendation_id uuid REFERENCES stake_recommendations(id) ON DELETE SET NULL,
  staking_policy_version_id uuid REFERENCES staking_policy_versions(id) ON DELETE SET NULL,
  ticket_type text NOT NULL DEFAULT 'SINGLE',
  total_stake double precision NOT NULL DEFAULT 0,
  effective_odds double precision,
  decision_status "TicketDecisionStatus" NOT NULL DEFAULT 'CREATED',
  reasons_jsonb jsonb,
  dedup_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  ticket_candidate_id uuid NOT NULL UNIQUE REFERENCES ticket_candidates(id) ON DELETE CASCADE,
  staking_policy_version_id uuid REFERENCES staking_policy_versions(id) ON DELETE SET NULL,
  profile_key "BankrollProfileKey" NOT NULL,
  total_stake double precision NOT NULL DEFAULT 0,
  effective_odds double precision,
  decision_status "TicketDecisionStatus" NOT NULL DEFAULT 'CREATED',
  reasons_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_decision_id uuid NOT NULL REFERENCES ticket_decisions(id) ON DELETE CASCADE,
  leg_order integer NOT NULL,
  sport text NOT NULL,
  match_id uuid NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
  market text NOT NULL,
  line double precision,
  line_key text NOT NULL,
  horizon text NOT NULL,
  selection text NOT NULL,
  published_prediction_id text NOT NULL,
  calibrated_probability double precision NOT NULL,
  fair_odds double precision,
  offered_odds double precision,
  edge double precision,
  confidence double precision NOT NULL,
  publish_score double precision NOT NULL,
  stake_amount double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_decision_id, leg_order)
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  ticket_decision_id uuid NOT NULL UNIQUE REFERENCES ticket_decisions(id) ON DELETE CASCADE,
  status "PaperOrderStatus" NOT NULL DEFAULT 'OPEN',
  stake double precision NOT NULL DEFAULT 0,
  effective_odds double precision,
  potential_return double precision,
  settled_payout double precision,
  settled_pnl double precision,
  dedup_key text NOT NULL UNIQUE,
  details_jsonb jsonb,
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlement_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  paper_order_id uuid NOT NULL UNIQUE REFERENCES paper_orders(id) ON DELETE CASCADE,
  status "PaperOrderStatus" NOT NULL DEFAULT 'OPEN',
  payout double precision NOT NULL DEFAULT 0,
  pnl double precision NOT NULL DEFAULT 0,
  settled_at timestamptz NOT NULL DEFAULT now(),
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bankroll_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  entry_type "BankrollLedgerEntryType" NOT NULL,
  amount double precision NOT NULL,
  balance_before double precision NOT NULL,
  balance_after double precision NOT NULL,
  reserved_before double precision NOT NULL,
  reserved_after double precision NOT NULL,
  realized_pnl_before double precision NOT NULL,
  realized_pnl_after double precision NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  dedup_key text NOT NULL UNIQUE,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equity_curve_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  point_at timestamptz NOT NULL DEFAULT now(),
  available_balance double precision NOT NULL,
  reserved_balance double precision NOT NULL,
  total_equity double precision NOT NULL,
  realized_pnl double precision NOT NULL,
  drawdown_pct double precision,
  source text NOT NULL DEFAULT 'accounting',
  reference_type text,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  staking_policy_version_id uuid REFERENCES staking_policy_versions(id) ON DELETE SET NULL,
  profile_key "BankrollProfileKey" NOT NULL,
  status "SimulationRunStatus" NOT NULL DEFAULT 'queued',
  simulation_name text NOT NULL,
  config_jsonb jsonb NOT NULL,
  metrics_jsonb jsonb,
  random_seed integer,
  window_start timestamptz,
  window_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_run_id uuid NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  scenario_name text NOT NULL,
  config_jsonb jsonb NOT NULL,
  metrics_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roi_governance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  target_status "RoiGovernanceStatus" NOT NULL DEFAULT 'WATCH',
  config_jsonb jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bankroll_account_id, rule_key)
);

CREATE TABLE IF NOT EXISTS drawdown_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  status "RoiGovernanceStatus" NOT NULL DEFAULT 'WATCH',
  peak_equity double precision NOT NULL,
  trough_equity double precision NOT NULL,
  drawdown_pct double precision NOT NULL,
  reason text,
  details_jsonb jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_limit_breaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  severity "DriftSeverity" NOT NULL,
  scope_type "ExposureScopeType" NOT NULL,
  scope_key text NOT NULL,
  behavior "ExposureLimitBehavior" NOT NULL,
  limit_value double precision,
  observed_value double precision,
  action_status "TicketDecisionStatus" NOT NULL,
  reason text,
  details_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bankroll_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bankroll_account_id uuid NOT NULL REFERENCES bankroll_accounts(id) ON DELETE CASCADE,
  actor text NOT NULL DEFAULT 'system',
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  reason text,
  before_jsonb jsonb,
  after_jsonb jsonb,
  metadata_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bankroll_accounts_mode_status
  ON bankroll_accounts (mode, status, created_at);
CREATE INDEX IF NOT EXISTS idx_bankroll_account_snapshots_account
  ON bankroll_account_snapshots (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bankroll_profile_versions_account
  ON bankroll_profile_versions (bankroll_account_id, profile_key, is_active);
CREATE INDEX IF NOT EXISTS idx_staking_policy_versions
  ON staking_policy_versions (staking_policy_id, is_active, version);
CREATE INDEX IF NOT EXISTS idx_stake_candidates_account
  ON stake_candidates (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stake_candidates_scope
  ON stake_candidates (sport, market, line_key, horizon, created_at);
CREATE INDEX IF NOT EXISTS idx_stake_candidates_status
  ON stake_candidates (decision_status, created_at);
CREATE INDEX IF NOT EXISTS idx_stake_recommendations_account
  ON stake_recommendations (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stake_recommendations_status
  ON stake_recommendations (decision_status, created_at);
CREATE INDEX IF NOT EXISTS idx_exposure_limits_scope
  ON exposure_limits (bankroll_account_id, scope_type, scope_key, is_active);
CREATE INDEX IF NOT EXISTS idx_exposure_snapshots_scope
  ON exposure_snapshots (bankroll_account_id, scope_type, scope_key, created_at);
CREATE INDEX IF NOT EXISTS idx_correlation_groups_family
  ON correlation_groups (bankroll_account_id, market_family, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_candidates_account
  ON ticket_candidates (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_candidates_status
  ON ticket_candidates (decision_status, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_decisions_account
  ON ticket_decisions (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_decisions_status
  ON ticket_decisions (decision_status, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_legs_scope
  ON ticket_legs (match_id, market, line_key, horizon);
CREATE INDEX IF NOT EXISTS idx_paper_orders_account_status
  ON paper_orders (bankroll_account_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_settlement_records_account
  ON settlement_records (bankroll_account_id, settled_at);
CREATE INDEX IF NOT EXISTS idx_settlement_records_status
  ON settlement_records (status, created_at);
CREATE INDEX IF NOT EXISTS idx_bankroll_ledger_account
  ON bankroll_ledger (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bankroll_ledger_reference
  ON bankroll_ledger (reference_type, reference_id, created_at);
CREATE INDEX IF NOT EXISTS idx_equity_curve_points_account
  ON equity_curve_points (bankroll_account_id, point_at);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_account
  ON simulation_runs (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_status
  ON simulation_runs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_simulation_scenarios_run
  ON simulation_scenarios (simulation_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_roi_governance_rules_account
  ON roi_governance_rules (bankroll_account_id, is_active, created_at);
CREATE INDEX IF NOT EXISTS idx_drawdown_events_account
  ON drawdown_events (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_drawdown_events_status
  ON drawdown_events (status, created_at);
CREATE INDEX IF NOT EXISTS idx_risk_limit_breaches_account
  ON risk_limit_breaches (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_risk_limit_breaches_severity
  ON risk_limit_breaches (severity, created_at);
CREATE INDEX IF NOT EXISTS idx_bankroll_audit_logs_account
  ON bankroll_audit_logs (bankroll_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bankroll_audit_logs_entity
  ON bankroll_audit_logs (entity_type, entity_id, created_at);
