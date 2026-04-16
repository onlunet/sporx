"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MatchPredictionItem,
  PredictionType,
  predictionTypeLabel,
  usePredictionsByType,
  bestScorelineSummary,
  isCompletedMatchStatus,
  isLiveMatchStatus,
  normalizeMatchStatus
} from "../../features/predictions";
import { PredictionRiskBadges } from "./PredictionRiskBadges";
import { Brain, TrendingUp, ShieldAlert, Target, Clock, Sparkles, BarChart3, Zap, ChevronRight, Search } from "lucide-react";

type FilterOption = PredictionType | "all";
type SportScope = "football" | "basketball";
type QuarterSource = NonNullable<MatchPredictionItem["quarterBreakdown"]>["source"];
type MatchOption = { matchId: string; label: string; kickoff?: string };

const FOOTBALL_FILTERS: Array<{ value: FilterOption; label: string; icon: typeof Brain }> = [
  { value: "all", label: "Tum Tahminler", icon: Target },
  { value: "fullTimeResult", label: "Mac Sonucu", icon: TrendingUp },
  { value: "firstHalfResult", label: "Ilk Yari", icon: Clock },
  { value: "halfTimeFullTime", label: "IY/MS", icon: Clock },
  { value: "bothTeamsToScore", label: "KG Var/Yok", icon: ShieldAlert },
  { value: "totalGoalsOverUnder", label: "Alt/Ust", icon: BarChart3 },
  { value: "correctScore", label: "Dogru Skor", icon: Target }
];

const BASKETBALL_FILTERS: Array<{ value: FilterOption; label: string; icon: typeof Brain }> = [
  { value: "all", label: "Tum Tahminler", icon: Target },
  { value: "fullTimeResult", label: "Mac Kazanani", icon: TrendingUp },
  { value: "firstHalfResult", label: "Ilk 2 Periyot", icon: Clock },
  { value: "totalGoalsOverUnder", label: "Toplam Sayi Alt/Ust", icon: BarChart3 },
  { value: "firstHalfGoals", label: "Ilk 2 Periyot Sayi", icon: Clock },
  { value: "secondHalfGoals", label: "Son 2 Periyot Sayi", icon: Clock },
  { value: "correctScore", label: "Skor Dagilimi", icon: Target }
];

const BASKETBALL_TYPE_LABELS: Partial<Record<PredictionType, string>> = {
  fullTimeResult: "Mac Kazanani",
  firstHalfResult: "Ilk 2 Periyot Kazanani",
  halfTimeFullTime: "Devre/Mac Sonucu",
  bothTeamsToScore: "Takim Skor Analizi",
  totalGoalsOverUnder: "Toplam Sayi Alt/Ust",
  correctScore: "Skor Dagilimi",
  goalRange: "Sayi Araligi",
  firstHalfGoals: "Ilk 2 Periyot Toplam Sayi",
  secondHalfGoals: "Son 2 Periyot Toplam Sayi"
};

function getFilters(sport?: SportScope) {
  return sport === "basketball" ? BASKETBALL_FILTERS : FOOTBALL_FILTERS;
}

function predictionBadgeLabel(predictionType: PredictionType, sport?: SportScope) {
  if (sport === "basketball") {
    return BASKETBALL_TYPE_LABELS[predictionType] ?? predictionTypeLabel(predictionType);
  }
  return predictionTypeLabel(predictionType);
}

function getConfidenceColor(score: number): string {
  if (score >= 0.75) return "from-neon-green to-emerald-400";
  if (score >= 0.6) return "from-neon-cyan to-cyan-400";
  if (score >= 0.5) return "from-neon-amber to-yellow-400";
  return "from-neon-red to-rose-400";
}

function getConfidenceGlow(score: number): string {
  if (score >= 0.75) return "shadow-glow-green";
  if (score >= 0.6) return "shadow-glow-cyan";
  if (score >= 0.5) return "shadow-glow-amber";
  return "shadow-glow-red";
}

function probabilitySummary(item: MatchPredictionItem, sport?: SportScope) {
  const p = item.probabilities ?? {};

  if (sport === "basketball") {
    if (typeof p.home === "number" || typeof p.away === "number") {
      const rows = [
        { label: "Ev", value: Math.round((p.home ?? 0) * 100), color: "bg-neon-cyan" },
        { label: "Dep.", value: Math.round((p.away ?? 0) * 100), color: "bg-neon-amber" }
      ];
      if (typeof p.draw === "number" && p.draw >= 0.03) {
        rows.splice(1, 0, { label: "Uzat.", value: Math.round((p.draw ?? 0) * 100), color: "bg-neon-purple" });
      }
      return rows;
    }
    if (typeof p.over === "number" || typeof p.under === "number") {
      return [
        { label: "Ust", value: Math.round((p.over ?? 0) * 100), color: "bg-neon-cyan" },
        { label: "Alt", value: Math.round((p.under ?? 0) * 100), color: "bg-neon-purple" }
      ];
    }
  }

  if (typeof p.home === "number" || typeof p.draw === "number" || typeof p.away === "number") {
    return [
      { label: "Ev", value: Math.round((p.home ?? 0) * 100), color: "bg-neon-cyan" },
      { label: "Ber.", value: Math.round((p.draw ?? 0) * 100), color: "bg-neon-purple" },
      { label: "Dep.", value: Math.round((p.away ?? 0) * 100), color: "bg-neon-amber" }
    ];
  }
  if (typeof p.yes === "number" || typeof p.no === "number") {
    return [
      { label: "Evet", value: Math.round((p.yes ?? 0) * 100), color: "bg-neon-green" },
      { label: "Hayir", value: Math.round((p.no ?? 0) * 100), color: "bg-neon-red" }
    ];
  }
  if (typeof p.over === "number" || typeof p.under === "number") {
    return [
      { label: "Ust", value: Math.round((p.over ?? 0) * 100), color: "bg-neon-cyan" },
      { label: "Alt", value: Math.round((p.under ?? 0) * 100), color: "bg-neon-purple" }
    ];
  }
  return null;
}

function sortPredictions(items: MatchPredictionItem[], scope: "upcoming" | "completed") {
  return items.slice().sort((a, b) => {
    const aKickoff = new Date(a.matchDateTimeUTC ?? 0).getTime();
    const bKickoff = new Date(b.matchDateTimeUTC ?? 0).getTime();
    const dateDiff = scope === "upcoming" ? aKickoff - bKickoff : bKickoff - aKickoff;
    if (dateDiff !== 0) return dateDiff;
    return (b.confidenceScore ?? -1) - (a.confidenceScore ?? -1);
  });
}

function normalizeText(value?: string | null) {
  return (value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function matchesTeamQuery(teamName: string | undefined, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }
  return normalizeText(teamName).includes(normalizedQuery);
}

function uniqueSortedTeamNames(items: MatchPredictionItem[], pick: "home" | "away") {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    const rawName = pick === "home" ? item.homeTeam : item.awayTeam;
    const name = rawName?.trim();
    if (!name) {
      continue;
    }
    const key = normalizeText(name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, "tr"));
}

function formatKickoff(value?: string) {
  if (!value) {
    return "Tarih bilinmiyor";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Tarih bilinmiyor";
  }
  return date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

function predictionListKey(item: MatchPredictionItem, index: number) {
  const linePart = item.line !== undefined ? String(item.line) : "na";
  const marketPart = item.marketKey ?? "market";
  const selectionPart = item.selectionLabel ?? "selection";
  return `${item.matchId}-${item.predictionType}-${linePart}-${marketPart}-${selectionPart}-${index}`;
}

function isPredictionPlayed(item: MatchPredictionItem) {
  const normalizedStatus = normalizeMatchStatus(item.matchStatus);
  const hasScore = item.homeScore !== null && item.homeScore !== undefined && item.awayScore !== null && item.awayScore !== undefined;
  const kickoff = item.matchDateTimeUTC ? new Date(item.matchDateTimeUTC).getTime() : undefined;
  const now = Date.now();
  const isHistoric = kickoff !== undefined && Number.isFinite(kickoff) && kickoff <= now - 6 * 60 * 60 * 1000;

  if (isLiveMatchStatus(normalizedStatus)) {
    return false;
  }
  if (isCompletedMatchStatus(normalizedStatus)) {
    return true;
  }
  if (normalizedStatus.length > 0) {
    return false;
  }
  if (item.isPlayed === true) {
    return true;
  }
  if (hasScore && isHistoric) {
    return true;
  }
  return false;
}

function resolveMatchState(item: MatchPredictionItem) {
  const normalizedStatus = normalizeMatchStatus(item.matchStatus);
  const isPlayed = isPredictionPlayed(item);

  if (isLiveMatchStatus(normalizedStatus)) {
    return { label: "Oynaniyor", className: "bg-red-500/10 text-red-300 border-red-500/30", isPlayed: false };
  }
  if (isPlayed) {
    return { label: "Tamamlandi", className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", isPlayed: true };
  }
  if (normalizedStatus === "postponed") {
    return { label: "Ertelendi", className: "bg-amber-500/10 text-amber-300 border-amber-500/30", isPlayed: false };
  }
  if (normalizedStatus === "cancelled") {
    return { label: "Iptal", className: "bg-rose-500/10 text-rose-300 border-rose-500/30", isPlayed: false };
  }
  return { label: "Henuz Oynanmadi", className: "bg-slate-500/10 text-slate-300 border-slate-500/30", isPlayed: false };
}

function detailHref(matchId: string, sport?: SportScope) {
  if (sport === "basketball") {
    return `/basketball/matches/${matchId}`;
  }
  return `/matches/${matchId}`;
}

function quarterBreakdownLine(item: MatchPredictionItem) {
  const quarter = item.quarterBreakdown;
  if (!quarter) {
    return null;
  }
  return `Q1 ${quarter.q1.home}-${quarter.q1.away} | Q2 ${quarter.q2.home}-${quarter.q2.away} | Q3 ${quarter.q3.home}-${quarter.q3.away} | Q4 ${quarter.q4.home}-${quarter.q4.away}`;
}

function quarterSourceLabel(source?: QuarterSource) {
  if (source === "provider_period_scores") {
    return "provider periyot skor verisi";
  }
  if (source === "projected") {
    return "model projeksiyonu";
  }
  return "skordan tahmini dagilim";
}

function asPct(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return `%${Math.round(value * 100)}`;
}

function marketDirectionLabel(direction?: string) {
  if (!direction) {
    return "yatay";
  }
  const normalized = direction.trim().toLowerCase();
  if (normalized === "up") {
    return "yukari";
  }
  if (normalized === "down") {
    return "asagi";
  }
  return "yatay";
}

function PredictionCard({ item, index, sport }: { item: MatchPredictionItem; index: number; sport?: SportScope }) {
  const topScore = bestScorelineSummary(item);
  const probs = probabilitySummary(item, sport);
  const confidence = item.confidenceScore ?? 0;
  const confidenceGradient = getConfidenceColor(confidence);
  const matchState = resolveMatchState(item);
  const hasScore = item.homeScore !== null && item.homeScore !== undefined && item.awayScore !== null && item.awayScore !== undefined;
  const scoreText = hasScore ? `${item.homeScore} - ${item.awayScore}` : null;
  const matchLabel = item.homeTeam && item.awayTeam ? `${item.homeTeam} - ${item.awayTeam}` : `Mac ${item.matchId.slice(0, 8)}`;
  const expectedHome = item.expectedScore?.home;
  const expectedAway = item.expectedScore?.away;
  const hasExpected = Number.isFinite(expectedHome) && Number.isFinite(expectedAway);
  const expectedTotal = hasExpected ? (expectedHome ?? 0) + (expectedAway ?? 0) : null;
  const expectedPossessions = item.expectedScore?.expectedPossessions;
  const expectedSpreadHome = item.expectedScore?.expectedSpreadHome;
  const marketGap = item.marketAnalysis?.probabilityGap;
  const marketVolatility =
    item.marketAnalysis?.volatilityScore ?? item.movementSummary?.volatilityScore ?? undefined;
  const marketDirection = item.marketAnalysis?.movementDirection ?? item.movementSummary?.direction;
  const quarterLine = sport === "basketball" ? quarterBreakdownLine(item) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="group relative"
    >
      <Link
        href={detailHref(item.matchId, sport)}
        aria-label={`${matchLabel} mac detayina git`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/70 rounded-2xl"
      >
        <div className="absolute -inset-0.5 bg-gradient-to-r from-neon-cyan/20 to-neon-purple/20 rounded-2xl opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />

        <div className="relative glass-card rounded-2xl p-5 overflow-hidden">
          <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${confidenceGradient}`} />

          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-display tracking-wider uppercase bg-white/5 text-slate-400 border border-white/10">
                  {predictionBadgeLabel(item.predictionType, sport)}
                </span>
                {item.line !== undefined && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-display tracking-wider bg-neon-amber/10 text-neon-amber border border-neon-amber/20">
                    Cizgi {item.line.toFixed(1)}
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-display tracking-wider border ${matchState.className}`}>
                  {matchState.label}
                </span>
              </div>

              <h3 className="text-lg font-display font-semibold text-white group-hover:text-neon-cyan transition-colors">
                {item.homeTeam && item.awayTeam ? `${item.homeTeam} vs ${item.awayTeam}` : `Mac #${item.matchId.slice(0, 8)}`}
              </h3>

              {item.matchDateTimeUTC && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                  <Clock className="w-3 h-3" />
                  <span>
                    {new Date(item.matchDateTimeUTC).toLocaleString("tr-TR", {
                      dateStyle: "medium",
                      timeStyle: "short"
                    })}
                  </span>
                </div>
              )}
              {scoreText && matchState.isPlayed ? (
                <p className="mt-1 text-xs text-emerald-300">{sport === "basketball" ? "Mac Skoru" : "Mac Sonucu"}: {scoreText}</p>
              ) : null}
            </div>

            <div className="relative">
              <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${confidenceGradient} p-[2px]`}>
                <div className="w-full h-full rounded-full bg-surface flex flex-col items-center justify-center">
                  <span className="text-lg font-display font-bold text-white">{Math.round(confidence * 100)}%</span>
                  <span className="text-[8px] text-slate-500 uppercase tracking-wider">Guven</span>
                </div>
              </div>
              <div className={`absolute inset-0 rounded-full ${getConfidenceGlow(confidence)} opacity-50`} />
            </div>
          </div>

          {probs && (
            <div className="space-y-2 mb-4">
              {probs.map((prob) => (
                <div key={prob.label} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-14">{prob.label}</span>
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${prob.value}%` }}
                      transition={{ duration: 0.8, delay: index * 0.05 + 0.2 }}
                      className={`h-full ${prob.color} rounded-full`}
                    />
                  </div>
                  <span className="text-xs font-medium text-white w-8 text-right">{prob.value}%</span>
                </div>
              ))}
            </div>
          )}

          {sport === "basketball" && hasExpected ? (
            <div className="flex items-center gap-2 mb-3 p-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/10">
              <Target className="w-4 h-4 text-neon-cyan" />
              <span className="text-sm text-slate-300">
                Beklenen Skor:{" "}
                <span className="text-neon-cyan font-semibold">
                  {Number(expectedHome).toFixed(1)} - {Number(expectedAway).toFixed(1)}
                </span>
                {expectedTotal !== null ? <span className="text-slate-400"> (Toplam: {expectedTotal.toFixed(1)})</span> : null}
              </span>
            </div>
          ) : null}
          {sport === "basketball" && (expectedPossessions !== undefined || expectedSpreadHome !== undefined) ? (
            <div className="mb-3 grid gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-slate-300 md:grid-cols-2">
              <div>
                Tempolu Oyun Tahmini:{" "}
                <span className="text-slate-100">
                  {expectedPossessions !== undefined ? expectedPossessions.toFixed(1) : "-"} pozisyon
                </span>
              </div>
              <div>
                Spread (Ev):{" "}
                <span className="text-slate-100">
                  {expectedSpreadHome !== undefined
                    ? `${expectedSpreadHome >= 0 ? "+" : ""}${expectedSpreadHome.toFixed(1)}`
                    : "-"}
                </span>
              </div>
            </div>
          ) : null}

          {item.marketAnalysis ? (
            <div className="mb-3 rounded-lg border border-neon-purple/20 bg-neon-purple/5 p-3 text-xs text-slate-200">
              <p className="font-medium text-neon-purple">Piyasa Karsilastirmasi</p>
              <div className="mt-1 grid gap-1 md:grid-cols-2">
                <span>
                  Model olasiligi: <span className="text-slate-100">{asPct(item.marketAnalysis.modelProbability)}</span>
                </span>
                <span>
                  Piyasa olasiligi: <span className="text-slate-100">{asPct(item.marketAnalysis.marketImpliedProbability)}</span>
                </span>
                <span>
                  Sapma:{" "}
                  <span className="text-slate-100">
                    {marketGap !== undefined ? `%${Math.round(Math.abs(marketGap) * 100)}` : "-"}
                  </span>
                </span>
                <span>
                  Hareket: <span className="text-slate-100">{marketDirectionLabel(marketDirection)}</span>
                </span>
                <span>
                  Oynaklik:{" "}
                  <span className="text-slate-100">
                    {marketVolatility !== undefined ? marketVolatility.toFixed(2) : "-"}
                  </span>
                </span>
                <span>
                  Uyum: <span className="text-slate-100">{item.marketAgreementLevel ?? "-"}</span>
                </span>
              </div>
            </div>
          ) : null}

          {sport === "basketball" && quarterLine ? (
            <div className="mb-3 rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-slate-400">4 Periyot Dagilimi ({quarterSourceLabel(item.quarterBreakdown?.source)})</p>
              <p className="mt-1 text-sm text-slate-200">{quarterLine}</p>
            </div>
          ) : null}

          {item.summary && <p className="text-sm text-slate-300 leading-relaxed mb-3">{item.summary}</p>}

          {topScore && (
            <div className="flex items-center gap-2 mb-3 p-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/10">
              <Target className="w-4 h-4 text-neon-cyan" />
              <span className="text-sm text-slate-300">
                {sport === "basketball" ? "Olasi skor dagilimi" : "Tahmini Skor"}:{" "}
                <span className="text-neon-cyan font-semibold">{topScore.label}</span>{" "}
                (<span className="text-slate-400">%{Math.round(topScore.probability * 100)}</span>)
              </span>
            </div>
          )}

          {item.avoidReason && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-neon-red/5 border border-neon-red/20 mb-3">
              <ShieldAlert className="w-4 h-4 text-neon-red flex-shrink-0 mt-0.5" />
              <span className="text-sm text-slate-300">{item.avoidReason}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <PredictionRiskBadges prediction={item} />
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-slate-500">
            <span>Mac detayi ve analizlere git</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1 group-hover:text-neon-cyan" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

type PredictionsExplorerProps = {
  scope?: "upcoming" | "completed";
  sport?: SportScope;
  title?: string;
  description?: string;
};

export function PredictionsExplorer({ scope = "upcoming", sport, title, description }: PredictionsExplorerProps) {
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const [homeTeamQuery, setHomeTeamQuery] = useState("");
  const [awayTeamQuery, setAwayTeamQuery] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const filters = useMemo(() => getFilters(sport), [sport]);
  const completedLink = sport ? `/${sport}/predictions/completed` : "/football/predictions/completed";
  const requestedStatus = scope === "completed" ? "finished" : "scheduled,live";
  const fallbackStatus =
    scope === "completed" ? "finished,scheduled,live,postponed,cancelled" : "scheduled,live,finished,postponed,cancelled";
  const requestedTake = scope === "completed" ? 260 : 120;
  const fallbackTake = scope === "completed" ? 520 : 220;
  const query = usePredictionsByType(activeFilter, requestedStatus, requestedTake, sport);
  const fallbackQuery = usePredictionsByType(activeFilter, fallbackStatus, fallbackTake, sport);
  const sourceItems = useMemo(() => {
    const primary = query.data ?? [];
    if (primary.length > 0) {
      return primary;
    }
    return fallbackQuery.data ?? [];
  }, [fallbackQuery.data, query.data]);
  const items = useMemo(() => {
    const sorted = sortPredictions(sourceItems, scope);
    if (scope === "completed") {
      return sorted.filter((item) => isPredictionPlayed(item));
    }
    return sorted.filter((item) => !isPredictionPlayed(item));
  }, [scope, sourceItems]);

  const normalizedHomeQuery = useMemo(() => normalizeText(homeTeamQuery), [homeTeamQuery]);
  const normalizedAwayQuery = useMemo(() => normalizeText(awayTeamQuery), [awayTeamQuery]);

  const homeSuggestionSource = useMemo(
    () => items.filter((item) => matchesTeamQuery(item.awayTeam, normalizedAwayQuery)),
    [items, normalizedAwayQuery]
  );

  const awaySuggestionSource = useMemo(
    () => items.filter((item) => matchesTeamQuery(item.homeTeam, normalizedHomeQuery)),
    [items, normalizedHomeQuery]
  );

  const homeSuggestions = useMemo(() => uniqueSortedTeamNames(homeSuggestionSource, "home"), [homeSuggestionSource]);
  const awaySuggestions = useMemo(() => uniqueSortedTeamNames(awaySuggestionSource, "away"), [awaySuggestionSource]);

  const matchOptions = useMemo(() => {
    const map = new Map<string, MatchOption>();
    for (const item of items) {
      if (!matchesTeamQuery(item.homeTeam, normalizedHomeQuery) || !matchesTeamQuery(item.awayTeam, normalizedAwayQuery)) {
        continue;
      }
      if (map.has(item.matchId)) {
        continue;
      }
      const homeName = item.homeTeam?.trim() || "Ev";
      const awayName = item.awayTeam?.trim() || "Dep";
      const kickoffLabel = formatKickoff(item.matchDateTimeUTC);
      map.set(item.matchId, {
        matchId: item.matchId,
        kickoff: item.matchDateTimeUTC,
        label: `${homeName} vs ${awayName} - ${kickoffLabel}`
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      const aTime = a.kickoff ? new Date(a.kickoff).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.kickoff ? new Date(b.kickoff).getTime() : Number.MAX_SAFE_INTEGER;
      if (scope === "completed") {
        return bTime - aTime;
      }
      return aTime - bTime;
    });
  }, [items, normalizedAwayQuery, normalizedHomeQuery, scope]);

  useEffect(() => {
    if (!selectedMatchId) {
      return;
    }
    if (matchOptions.some((option) => option.matchId === selectedMatchId)) {
      return;
    }
    setSelectedMatchId("");
  }, [matchOptions, selectedMatchId]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (!matchesTeamQuery(item.homeTeam, normalizedHomeQuery)) {
          return false;
        }
        if (!matchesTeamQuery(item.awayTeam, normalizedAwayQuery)) {
          return false;
        }
        if (selectedMatchId && item.matchId !== selectedMatchId) {
          return false;
        }
        return true;
      }),
    [items, normalizedAwayQuery, normalizedHomeQuery, selectedMatchId]
  );

  const matchLevelItems = useMemo(() => {
    const map = new Map<string, MatchPredictionItem>();
    for (const item of filteredItems) {
      const existing = map.get(item.matchId);
      if (!existing) {
        map.set(item.matchId, item);
        continue;
      }
      if (existing.predictionType !== "fullTimeResult" && item.predictionType === "fullTimeResult") {
        map.set(item.matchId, item);
      }
    }
    return Array.from(map.values());
  }, [filteredItems]);

  const basketballTotalStats = useMemo(() => {
    if (sport !== "basketball") {
      return null;
    }
    const totals = matchLevelItems
      .map((item) => {
        const home = item.expectedScore?.home;
        const away = item.expectedScore?.away;
        if (!Number.isFinite(home) || !Number.isFinite(away)) {
          return null;
        }
        return (home ?? 0) + (away ?? 0);
      })
      .filter((value): value is number => value !== null);

    if (totals.length === 0) {
      return {
        average: null as number | null,
        min: null as number | null,
        max: null as number | null
      };
    }

    const sum = totals.reduce((acc, value) => acc + value, 0);
    return {
      average: sum / totals.length,
      min: Math.min(...totals),
      max: Math.max(...totals)
    };
  }, [matchLevelItems, sport]);

  const heading =
    title ??
    (sport === "basketball" ? (
      <>
        Basketbol <span className="gradient-text">Tahminleri</span>
      </>
    ) : (
      <>
        Mac <span className="gradient-text">Tahminleri</span>
      </>
    ));

  const defaultDescription =
    description ??
    (scope === "completed"
      ? "Sonuclanan maclar icin uretilen tahminlerin detay listesi."
      : sport === "basketball"
        ? "Basketbol maclari icin 4 periyot dinamiklerini dikkate alan, henuz oynanmamis mac tahminleri."
        : "Yapay zeka destekli analizler ve henuz oynanmamis mac tahminleri.");

  return (
    <div className="space-y-8">
      <div className="relative">
        <div className="absolute -left-4 -top-4 w-32 h-32 bg-neon-cyan/10 rounded-full blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-purple">
              <Brain className="w-5 h-5 text-void" />
            </div>
            <span className="text-xs font-display tracking-[0.2em] text-neon-cyan uppercase">
              {sport === "basketball" ? "AI Basketbol Analizi" : "AI Tahminleri"}
            </span>
          </div>

          <h1 className="font-display text-3xl md:text-4xl font-bold text-white mb-2">{heading}</h1>

          <p className="text-slate-400 max-w-2xl">{defaultDescription}</p>
          {scope === "upcoming" && (
          <div className="mt-3">
              <Link
                href={completedLink}
                className="inline-flex items-center gap-2 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-2 text-xs font-medium text-neon-cyan hover:bg-neon-cyan/20"
              >
                Sonuclanan tahmin analizine git
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const Icon = filter.icon;
          const active = activeFilter === filter.value;

          return (
            <button
              key={filter.value}
              onClick={() => setActiveFilter(filter.value)}
              className={`
                relative group flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
                ${active ? "text-white" : "text-slate-400 hover:text-white"}
              `}
            >
              {active && (
                <motion.div
                  layoutId="activeFilter"
                  className="absolute inset-0 bg-gradient-to-r from-neon-cyan/20 to-neon-purple/20 rounded-xl border border-neon-cyan/30"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}

              <span
                className={`
                relative z-10 flex items-center justify-center w-7 h-7 rounded-lg transition-colors
                ${active ? "bg-neon-cyan/20 text-neon-cyan" : "bg-white/5 group-hover:bg-white/10"}
              `}
              >
                <Icon className="w-3.5 h-3.5" />
              </span>

              <span className="relative z-10">{filter.label}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/10 bg-surface/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-display uppercase tracking-wider text-slate-400">
          <Search className="h-4 w-4 text-neon-cyan" />
          Takim ve karsilasma filtreleri
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs text-slate-400">
            <span>Ev sahibi ara</span>
            <input
              value={homeTeamQuery}
              onChange={(event) => setHomeTeamQuery(event.target.value)}
              list="prediction-home-team-suggestions"
              placeholder="Orn: Galatasaray"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none ring-0 transition focus:border-neon-cyan/50"
            />
            <datalist id="prediction-home-team-suggestions">
              {homeSuggestions.map((teamName) => (
                <option key={teamName} value={teamName} />
              ))}
            </datalist>
          </label>

          <label className="space-y-1 text-xs text-slate-400">
            <span>Deplasman ara</span>
            <input
              value={awayTeamQuery}
              onChange={(event) => setAwayTeamQuery(event.target.value)}
              list="prediction-away-team-suggestions"
              placeholder="Orn: Fenerbahce"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none ring-0 transition focus:border-neon-purple/50"
            />
            <datalist id="prediction-away-team-suggestions">
              {awaySuggestions.map((teamName) => (
                <option key={teamName} value={teamName} />
              ))}
            </datalist>
          </label>
        </div>

        {(homeTeamQuery.trim().length > 0 || awayTeamQuery.trim().length > 0) ? (
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="space-y-1 text-xs text-slate-400">
              <span>Karsilasma secimi</span>
              <select
                value={selectedMatchId}
                onChange={(event) => setSelectedMatchId(event.target.value)}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-neon-cyan/50"
              >
                <option value="">Tum uygun karsilasmalar ({matchOptions.length})</option>
                {matchOptions.map((option) => (
                  <option key={option.matchId} value={option.matchId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                setHomeTeamQuery("");
                setAwayTeamQuery("");
                setSelectedMatchId("");
              }}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-white/30 hover:text-white"
            >
              Filtreyi sifirla
            </button>
          </div>
        ) : null}
      </div>

      <div className={`grid gap-3 ${sport === "basketball" ? "md:grid-cols-4" : "md:grid-cols-2"} rounded-xl bg-surface/50 border border-white/5 p-4`}>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <Sparkles className="w-4 h-4 text-neon-cyan" />
          <span className="text-sm text-slate-400">Toplam Tahmin:</span>
          <span className="text-sm font-semibold text-white">{filteredItems.length}</span>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <Zap className="w-4 h-4 text-neon-green" />
          <span className="text-sm text-slate-400">Yuksek Guven:</span>
          <span className="text-sm font-semibold text-neon-green">{filteredItems.filter((i) => (i.confidenceScore ?? 0) >= 0.7).length}</span>
        </div>

        {sport === "basketball" ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <BarChart3 className="w-4 h-4 text-neon-amber" />
              <span className="text-sm text-slate-400">Ort. Beklenen Toplam:</span>
              <span className="text-sm font-semibold text-white">
                {basketballTotalStats?.average !== null && basketballTotalStats?.average !== undefined
                  ? basketballTotalStats.average.toFixed(1)
                  : "-"}
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <Target className="w-4 h-4 text-neon-purple" />
              <span className="text-sm text-slate-400">Beklenen Aralik:</span>
              <span className="text-sm font-semibold text-white">
                {basketballTotalStats?.min !== null && basketballTotalStats?.max !== null
                  ? `${basketballTotalStats?.min?.toFixed(1)} - ${basketballTotalStats?.max?.toFixed(1)}`
                  : "-"}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {(query.isLoading || fallbackQuery.isLoading) && (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card rounded-2xl p-5 h-48 animate-pulse">
              <div className="h-4 bg-white/5 rounded w-1/3 mb-4" />
              <div className="h-6 bg-white/5 rounded w-2/3 mb-4" />
              <div className="space-y-2">
                <div className="h-2 bg-white/5 rounded" />
                <div className="h-2 bg-white/5 rounded w-4/5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {query.isError && fallbackQuery.isError && (
        <div className="glass-card rounded-2xl p-8 text-center border-neon-red/20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neon-red/10 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-neon-red" />
          </div>
          <h3 className="text-lg font-display font-semibold text-white mb-2">Veri Alinamadi</h3>
          <p className="text-slate-400">Tahmin listesi yuklenirken bir hata olustu. Lutfen tekrar deneyin.</p>
        </div>
      )}

      {!query.isLoading && !fallbackQuery.isLoading && !(query.isError && fallbackQuery.isError) && filteredItems.length === 0 && (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-white/5 flex items-center justify-center">
            <Target className="w-10 h-10 text-slate-500" />
          </div>
          <h3 className="text-xl font-display font-semibold text-white mb-2">
            {scope === "completed" ? "Sonuclanan Tahmin Bulunamadi" : "Oynanmamis Tahmin Bulunamadi"}
          </h3>
          <p className="text-slate-400">
            {scope === "completed"
              ? "Secili kriterlere uygun sonuclanmis tahmin bulunmuyor."
              : "Su an oynanmamis maca ait tahmin yok. Sonuclanan tahminler sayfasini inceleyebilirsiniz."}
          </p>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <motion.div layout className="grid gap-4 md:grid-cols-2">
          {filteredItems.slice(0, 60).map((item, index) => (
            <PredictionCard key={predictionListKey(item, index)} item={item} index={index} sport={sport} />
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
