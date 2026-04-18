export type PredictionType =
  | "fullTimeResult"
  | "firstHalfResult"
  | "halfTimeFullTime"
  | "bothTeamsToScore"
  | "totalGoalsOverUnder"
  | "correctScore"
  | "goalRange"
  | "firstHalfGoals"
  | "secondHalfGoals";

export type PredictionTabKey =
  | "general"
  | "firstHalfFullTime"
  | "btts"
  | "overUnder"
  | "scoreline"
  | "firstHalf"
  | "secondHalf"
  | "commentary";

export type PredictionProbabilities = Record<string, number>;

export type ScorelineDistributionItem = {
  home: number;
  away: number;
  probability: number;
  label: string;
};

export type ExpectedTotalLine = {
  line: number;
  over: number;
  under: number;
};

export type PredictionExpectedScore = {
  home?: number;
  away?: number;
  expectedPossessions?: number;
  paceBucket?: string;
  expectedTotal?: number;
  expectedSpreadHome?: number;
  firstHalfTotal?: number;
  secondHalfTotal?: number;
  totalLines?: ExpectedTotalLine[];
  marketAgreementLevel?: string;
  marketCoverageScore?: number;
};

export type RiskFlag = {
  code: string;
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  message: string;
};

export type SupportingSignal = {
  key: string;
  label: string;
  detail?: string;
  value?: string;
};

export type ContradictionSignal = {
  key: string;
  label: string;
  detail?: string;
  value?: string;
};

export type MatchCommentary = {
  shortComment?: string;
  detailedComment?: string;
  expertComment?: string;
  confidenceNote?: string;
};

export type PredictionMarketAnalysis = {
  modelProbability?: number;
  marketImpliedProbability?: number;
  fairMarketProbability?: number | null;
  probabilityGap?: number;
  movementDirection?: string;
  volatilityScore?: number;
  consensusScore?: number;
  contradictionScore?: number;
  line?: number | null;
  updatedAt?: string;
};

export type PredictionMovementSummary = {
  direction?: string;
  volatilityScore?: number;
};

export type PredictionRecommendation = {
  isRecommended?: boolean;
  primaryMarket?: "moneyline" | "spread" | "total" | "pass";
  side?: "home" | "away" | "over" | "under" | null;
  reason?: string | null;
};

export type MatchPredictionItem = {
  matchId: string;
  modelVersionId?: string | null;
  leagueId?: string;
  leagueName?: string;
  leagueCode?: string;
  predictionType: PredictionType;
  marketKey?: string;
  selectionLabel?: string;
  line?: number;
  probabilities?: PredictionProbabilities;
  expectedScore?: PredictionExpectedScore;
  scorelineDistribution?: ScorelineDistributionItem[];
  quarterBreakdown?: {
    q1: { home: number; away: number };
    q2: { home: number; away: number };
    q3: { home: number; away: number };
    q4: { home: number; away: number };
    source: "provider_period_scores" | "projected" | "estimated_from_final_score" | "estimated_from_half_time_and_final";
  };
  commentary?: MatchCommentary;
  supportingSignals?: SupportingSignal[];
  contradictionSignals?: ContradictionSignal[];
  marketAnalysis?: PredictionMarketAnalysis;
  marketAgreementLevel?: string;
  marketImpliedProbabilities?: Record<string, number>;
  movementSummary?: PredictionMovementSummary;
  recommendation?: PredictionRecommendation;
  riskFlags?: RiskFlag[];
  confidenceScore?: number;
  summary?: string;
  avoidReason?: string | null;
  updatedAt?: string | null;
  matchStatus?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  halfTimeHomeScore?: number | null;
  halfTimeAwayScore?: number | null;
  isPlayed?: boolean;
  homeTeam?: string;
  awayTeam?: string;
  matchDateTimeUTC?: string;
};

export type MatchPredictionGroup = Partial<Record<PredictionType, MatchPredictionItem[]>>;

export type PredictionSignals = {
  supportingSignals: SupportingSignal[];
  contradictionSignals: ContradictionSignal[];
};

export const PREDICTION_TYPE_ORDER: PredictionType[] = [
  "fullTimeResult",
  "firstHalfResult",
  "halfTimeFullTime",
  "bothTeamsToScore",
  "totalGoalsOverUnder",
  "correctScore",
  "goalRange",
  "firstHalfGoals",
  "secondHalfGoals"
];

export const PREDICTION_TYPE_LABELS: Record<PredictionType, string> = {
  fullTimeResult: "Maç Sonucu",
  firstHalfResult: "İlk Yarı Sonucu",
  halfTimeFullTime: "IY/MS",
  bothTeamsToScore: "KG Var/Yok",
  totalGoalsOverUnder: "Alt/Üst",
  correctScore: "Doğru Skor",
  goalRange: "Gol Aralığı",
  firstHalfGoals: "İlk Yarı Golleri",
  secondHalfGoals: "İkinci Yarı Golleri"
};

export const PREDICTION_TABS: Array<{ key: PredictionTabKey; label: string }> = [
  { key: "general", label: "Genel" },
  { key: "firstHalfFullTime", label: "IY/MS" },
  { key: "btts", label: "KG Var/Yok" },
  { key: "overUnder", label: "Alt/Üst" },
  { key: "scoreline", label: "Skor Dağılımı" },
  { key: "firstHalf", label: "İlk Yarı" },
  { key: "secondHalf", label: "İkinci Yarı" },
  { key: "commentary", label: "Yorumlar" }
];
