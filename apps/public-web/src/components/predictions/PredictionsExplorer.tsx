"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MatchPredictionItem,
  PredictionType,
  predictionTypeLabel,
  usePredictionsByType,
  bestScorelineSummary
} from "../../features/predictions";
import { PredictionConfidenceBadge } from "./PredictionConfidenceBadge";
import { PredictionRiskBadges } from "./PredictionRiskBadges";
import { Brain, TrendingUp, ShieldAlert, Target, Clock, Sparkles, BarChart3, Zap, ChevronRight } from "lucide-react";

type FilterOption = PredictionType | "all";

const FILTERS: Array<{ value: FilterOption; label: string; icon: typeof Brain }> = [
  { value: "all", label: "Tüm Tahminler", icon: Target },
  { value: "fullTimeResult", label: "Maç Sonucu", icon: TrendingUp },
  { value: "firstHalfResult", label: "İlk Yarı", icon: Clock },
  { value: "halfTimeFullTime", label: "İY/MS", icon: Clock },
  { value: "bothTeamsToScore", label: "KG Var/Yok", icon: ShieldAlert },
  { value: "totalGoalsOverUnder", label: "Alt/Üst", icon: BarChart3 },
  { value: "correctScore", label: "Doğru Skor", icon: Target },
];

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

function probabilitySummary(item: MatchPredictionItem) {
  const p = item.probabilities ?? {};
  if (typeof p.home === "number" || typeof p.draw === "number" || typeof p.away === "number") {
    return [
      { label: "Ev", value: Math.round((p.home ?? 0) * 100), color: "bg-neon-cyan" },
      { label: "Ber.", value: Math.round((p.draw ?? 0) * 100), color: "bg-neon-purple" },
      { label: "Dep.", value: Math.round((p.away ?? 0) * 100), color: "bg-neon-amber" },
    ];
  }
  if (typeof p.yes === "number" || typeof p.no === "number") {
    return [
      { label: "Evet", value: Math.round((p.yes ?? 0) * 100), color: "bg-neon-green" },
      { label: "Hayır", value: Math.round((p.no ?? 0) * 100), color: "bg-neon-red" },
    ];
  }
  if (typeof p.over === "number" || typeof p.under === "number") {
    return [
      { label: "Üst", value: Math.round((p.over ?? 0) * 100), color: "bg-neon-cyan" },
      { label: "Alt", value: Math.round((p.under ?? 0) * 100), color: "bg-neon-purple" },
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

function predictionListKey(item: MatchPredictionItem, index: number) {
  const linePart = item.line !== undefined ? String(item.line) : "na";
  const marketPart = item.marketKey ?? "market";
  const selectionPart = item.selectionLabel ?? "selection";
  return `${item.matchId}-${item.predictionType}-${linePart}-${marketPart}-${selectionPart}-${index}`;
}

function isPredictionPlayed(item: MatchPredictionItem) {
  const rawStatus = (item.matchStatus ?? "").toLowerCase();
  const normalizedStatus = rawStatus.replaceAll("-", "_").replaceAll(" ", "_");
  const hasScore = item.homeScore !== null && item.homeScore !== undefined && item.awayScore !== null && item.awayScore !== undefined;
  const kickoff = item.matchDateTimeUTC ? new Date(item.matchDateTimeUTC).getTime() : undefined;
  const now = Date.now();
  const isNearOrPast = kickoff !== undefined && Number.isFinite(kickoff) && kickoff <= now + 2 * 60 * 60 * 1000;

  if (normalizedStatus === "live" || normalizedStatus === "in_play" || normalizedStatus === "paused") {
    return false;
  }
  if (
    normalizedStatus === "finished" ||
    normalizedStatus === "ft" ||
    normalizedStatus === "full_time" ||
    normalizedStatus === "after_extra_time" ||
    normalizedStatus === "after_penalties"
  ) {
    return true;
  }
  if (normalizedStatus === "scheduled" && kickoff !== undefined && Number.isFinite(kickoff) && kickoff > now + 2 * 60 * 60 * 1000) {
    return false;
  }
  if (item.isPlayed === true) {
    return true;
  }
  if (hasScore && isNearOrPast) {
    return true;
  }
  return false;
}

function resolveMatchState(item: MatchPredictionItem) {
  const rawStatus = (item.matchStatus ?? "").toLowerCase();
  const isPlayed = isPredictionPlayed(item);

  if (rawStatus === "live") {
    return { label: "Canlı", className: "bg-red-500/10 text-red-300 border-red-500/30", isPlayed: false };
  }
  if (isPlayed) {
    return { label: "Oynandı", className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", isPlayed: true };
  }
  if (rawStatus === "postponed") {
    return { label: "Ertelendi", className: "bg-amber-500/10 text-amber-300 border-amber-500/30", isPlayed: false };
  }
  if (rawStatus === "cancelled") {
    return { label: "İptal", className: "bg-rose-500/10 text-rose-300 border-rose-500/30", isPlayed: false };
  }
  return { label: "Oynanmadı", className: "bg-slate-500/10 text-slate-300 border-slate-500/30", isPlayed: false };
}

function PredictionCard({ item, index }: { item: MatchPredictionItem; index: number }) {
  const topScore = bestScorelineSummary(item);
  const probs = probabilitySummary(item);
  const confidence = item.confidenceScore ?? 0;
  const confidenceGradient = getConfidenceColor(confidence);
  const matchState = resolveMatchState(item);
  const hasScore = item.homeScore !== null && item.homeScore !== undefined && item.awayScore !== null && item.awayScore !== undefined;
  const scoreText = hasScore ? `${item.homeScore} - ${item.awayScore}` : null;
  const matchLabel =
    item.homeTeam && item.awayTeam ? `${item.homeTeam} - ${item.awayTeam}` : `Maç ${item.matchId.slice(0, 8)}`;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="group relative"
    >
      <Link
        href={`/matches/${item.matchId}`}
        aria-label={`${matchLabel} maç detayına git`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/70 rounded-2xl"
      >
        <div className="absolute -inset-0.5 bg-gradient-to-r from-neon-cyan/20 to-neon-purple/20 rounded-2xl opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />
        
        <div className="relative glass-card rounded-2xl p-5 overflow-hidden">
          <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${confidenceGradient}`} />
          
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-display tracking-wider uppercase bg-white/5 text-slate-400 border border-white/10">
                  {predictionTypeLabel(item.predictionType)}
                </span>
                {item.line !== undefined && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-display tracking-wider bg-neon-amber/10 text-neon-amber border border-neon-amber/20">
                    Line {item.line.toFixed(1)}
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-display tracking-wider border ${matchState.className}`}>
                  {matchState.label}
                </span>
              </div>
              
              <h3 className="text-lg font-display font-semibold text-white group-hover:text-neon-cyan transition-colors">
                {item.homeTeam && item.awayTeam 
                  ? `${item.homeTeam} vs ${item.awayTeam}`
                  : `Maç #${item.matchId.slice(0, 8)}`
                }
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
                <p className="mt-1 text-xs text-emerald-300">Maç Sonucu: {scoreText}</p>
              ) : null}
            </div>
            
            <div className="relative">
              <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${confidenceGradient} p-[2px]`}>
                <div className="w-full h-full rounded-full bg-surface flex flex-col items-center justify-center">
                  <span className="text-lg font-display font-bold text-white">{Math.round(confidence * 100)}%</span>
                  <span className="text-[8px] text-slate-500 uppercase tracking-wider">Güven</span>
                </div>
              </div>
              <div className={`absolute inset-0 rounded-full ${getConfidenceGlow(confidence)} opacity-50`} />
            </div>
          </div>

          {probs && (
            <div className="space-y-2 mb-4">
              {probs.map((prob) => (
                <div key={prob.label} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-10">{prob.label}</span>
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

          {item.summary && (
            <p className="text-sm text-slate-300 leading-relaxed mb-3">{item.summary}</p>
          )}

          {topScore && (
            <div className="flex items-center gap-2 mb-3 p-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/10">
              <Target className="w-4 h-4 text-neon-cyan" />
              <span className="text-sm text-slate-300">
                Tahmini Skor: <span className="text-neon-cyan font-semibold">{topScore.label}</span>
                {" "}(<span className="text-slate-400">%{Math.round(topScore.probability * 100)}</span>)
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
            <span>Maç detayı ve analizlere git</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1 group-hover:text-neon-cyan" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

type PredictionsExplorerProps = {
  scope?: "upcoming" | "completed";
};

export function PredictionsExplorer({ scope = "upcoming" }: PredictionsExplorerProps) {
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const requestedStatus = scope === "completed" ? "finished" : "scheduled,live";
  const requestedTake = scope === "completed" ? 180 : 80;
  const query = usePredictionsByType(activeFilter, requestedStatus, requestedTake);
  const items = useMemo(() => {
    const sorted = sortPredictions(query.data ?? [], scope);
    if (scope === "completed") {
      return sorted.filter((item) => isPredictionPlayed(item));
    }
    return sorted.filter((item) => !isPredictionPlayed(item));
  }, [query.data, scope]);

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
              AI Tahminleri
            </span>
          </div>
          
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white mb-2">
            Maç <span className="gradient-text">Tahminleri</span>
          </h1>
          
          <p className="text-slate-400 max-w-xl">
            {scope === "completed"
              ? "Sonuçlanan maçlar için üretilen tahminlerin detay listesi."
              : "Yapay zeka destekli analizler ve henüz oynanmamış maç tahminleri."}
          </p>
          {scope === "upcoming" && (
            <div className="mt-3">
              <Link
                href="/predictions/completed"
                className="inline-flex items-center gap-2 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-2 text-xs font-medium text-neon-cyan hover:bg-neon-cyan/20"
              >
                Sonuçlanan tahmin analizine git
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
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
              
              <span className={`
                relative z-10 flex items-center justify-center w-7 h-7 rounded-lg transition-colors
                ${active ? "bg-neon-cyan/20 text-neon-cyan" : "bg-white/5 group-hover:bg-white/10"}
              `}>
                <Icon className="w-3.5 h-3.5" />
              </span>
              
              <span className="relative z-10">{filter.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-6 p-4 rounded-xl bg-surface/50 border border-white/5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-neon-cyan" />
          <span className="text-sm text-slate-400">Toplam: </span>
          <span className="text-sm font-semibold text-white">{items.length}</span>
        </div>
        
        <div className="h-4 w-px bg-white/10" />
        
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-green" />
          <span className="text-sm text-slate-400">Yüksek Güven: </span>
          <span className="text-sm font-semibold text-neon-green">
            {items.filter(i => (i.confidenceScore ?? 0) >= 0.7).length}
          </span>
        </div>
      </div>

      {query.isLoading && (
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

      {query.isError && (
        <div className="glass-card rounded-2xl p-8 text-center border-neon-red/20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neon-red/10 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-neon-red" />
          </div>
          <h3 className="text-lg font-display font-semibold text-white mb-2">Veri Alınamadı</h3>
          <p className="text-slate-400">Tahmin listesi yüklenirken bir hata oluştu. Lütfen tekrar deneyin.</p>
        </div>
      )}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-white/5 flex items-center justify-center">
            <Target className="w-10 h-10 text-slate-500" />
          </div>
          <h3 className="text-xl font-display font-semibold text-white mb-2">
            {scope === "completed" ? "Sonuçlanan Tahmin Bulunamadı" : "Oynanmamış Tahmin Bulunamadı"}
          </h3>
          <p className="text-slate-400">
            {scope === "completed"
              ? "Seçili kriterlere uygun sonuçlanmış tahmin bulunmuyor."
              : "Şu an oynanmamış maça ait tahmin yok. Sonuçlanan tahminler sayfasını inceleyebilirsiniz."}
          </p>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <motion.div layout className="grid gap-4 md:grid-cols-2">
          {items.slice(0, 60).map((item, index) => (
            <PredictionCard key={predictionListKey(item, index)} item={item} index={index} />
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}


