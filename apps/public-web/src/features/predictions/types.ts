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

export type MatchPredictionItem = {
  matchId: string;
  modelVersionId?: string | null;
  predictionType: PredictionType;
  marketKey?: string;
  selectionLabel?: string;
  line?: number;
  probabilities?: PredictionProbabilities;
  expectedScore?: { home?: number; away?: number };
  scorelineDistribution?: ScorelineDistributionItem[];
  commentary?: MatchCommentary;
  supportingSignals?: SupportingSignal[];
  contradictionSignals?: ContradictionSignal[];
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
  halfTimeFullTime: "İY/MS",
  bothTeamsToScore: "KG Var/Yok",
  totalGoalsOverUnder: "Alt/Üst",
  correctScore: "Doğru Skor",
  goalRange: "Gol Aralığı",
  firstHalfGoals: "İlk Yarı Golleri",
  secondHalfGoals: "İkinci Yarı Golleri"
};

export const PREDICTION_TABS: Array<{ key: PredictionTabKey; label: string }> = [
  { key: "general", label: "Genel" },
  { key: "firstHalfFullTime", label: "İY/MS" },
  { key: "btts", label: "KG Var/Yok" },
  { key: "overUnder", label: "Alt/Üst" },
  { key: "scoreline", label: "Skor Dağılımı" },
  { key: "firstHalf", label: "İlk Yarı" },
  { key: "secondHalf", label: "İkinci Yarı" },
  { key: "commentary", label: "Yorumlar" }
];
