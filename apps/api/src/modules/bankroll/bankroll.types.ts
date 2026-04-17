import {
  BankrollProfileKey,
  ExposureLimitBehavior,
  ExposureScopeType,
  PaperOrderStatus,
  RoiGovernanceStatus,
  StakeDecisionStatus,
  TicketDecisionStatus
} from "@prisma/client";

export type BankrollSettings = {
  bankrollLayerEnabled: boolean;
  paperExecutionEnabled: boolean;
  correlationChecksEnabled: boolean;
  exposureGovernanceEnabled: boolean;
  roiGovernanceEnabled: boolean;
  researchModeMultilegEnabled: boolean;
  stakingProfileDefault: BankrollProfileKey;
  emergencyKillSwitch: boolean;
};

export type StakingProfileConfig = {
  kellyFraction: number;
  hardMaxFractionPerBet: number;
  minStake: number;
  maxStake: number;
  minEdge: number;
  minConfidence: number;
  minPublishScore: number;
  flatUnit: number;
  riskBudgetFraction: number;
};

export type StakeSizingInput = {
  profile: BankrollProfileKey;
  bankrollAvailable: number;
  calibratedProbability: number;
  fairOdds: number | null;
  offeredOdds: number | null;
  edge: number | null;
  confidence: number;
  publishScore: number;
  config: StakingProfileConfig;
};

export type StakeSizingResult = {
  status: StakeDecisionStatus;
  recommendedFraction: number;
  recommendedStake: number;
  clippedStake: number;
  reasons: string[];
};

export type ExposureCheckInput = {
  accountId: string;
  bankrollValue: number;
  proposedStake: number;
  sportCode: string;
  leagueId: string | null;
  matchId: string;
  marketFamily: string;
  horizon: string;
  calendarKey: string;
  openExposureTotal: number;
  openExposureByMatch: number;
  openExposureByLeague: number;
  openExposureBySport: number;
  openExposureByFamily: number;
  openExposureByHorizon: number;
  openTickets: number;
};

export type ExposureRuleEvaluation = {
  scopeType: ExposureScopeType;
  behavior: ExposureLimitBehavior;
  scopeKey: string;
  allowedStake: number;
  blocked: boolean;
  breached: boolean;
  reason: string;
};

export type ExposureCheckResult = {
  status: StakeDecisionStatus;
  stakeAfterGovernance: number;
  reasons: string[];
  evaluations: ExposureRuleEvaluation[];
};

export type CorrelationCheckInput = {
  matchId: string;
  market: string;
  selection: string;
  line: number | null;
  horizon: string;
  proposedStake: number;
  existingOpenLegs: Array<{
    market: string;
    selection: string;
    line: number | null;
    horizon: string;
  }>;
};

export type CorrelationCheckResult = {
  status: StakeDecisionStatus;
  stakeAfterCorrelation: number;
  correlationGroupKey: string;
  reasons: string[];
};

export type TicketConstructionResult = {
  status: TicketDecisionStatus;
  stake: number;
  effectiveOdds: number | null;
  reasons: string[];
};

export type SettlementOutcome = {
  status: PaperOrderStatus;
  payout: number;
  pnl: number;
  reason: string;
};

export type GovernanceEvaluation = {
  status: RoiGovernanceStatus;
  reasons: string[];
  drawdownPct: number;
  riskOfRuinEstimate: number;
};
