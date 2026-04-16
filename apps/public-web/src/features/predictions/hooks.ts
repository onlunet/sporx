"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MatchPredictionItem, PredictionType, MatchCommentary } from "./types";
import { filterPredictionsByType, normalizePredictionItem, normalizePredictionList } from "./normalize";
import { resolveBrowserApiBase } from "../../lib/api-base-url";

type Envelope<T> = {
  success: boolean;
  data: T;
  meta: unknown;
  error: unknown;
};

async function safeFetchEnvelope<T>(path: string): Promise<Envelope<T> | null> {
  const apiBase = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      cache: "no-store",
      credentials: "include"
    });
    if (!response.ok) {
      return null;
    }
    const json = (await response.json()) as Envelope<T>;
    if (!json || typeof json !== "object" || !("data" in json)) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

async function fetchMatchPredictions(matchId: string, includeMarketAnalysis = false): Promise<MatchPredictionItem[]> {
  const query = includeMarketAnalysis ? "?includeMarketAnalysis=1" : "";
  const groupedResponse = await safeFetchEnvelope<unknown>(`/api/v1/matches/${matchId}/predictions${query}`);
  const groupedItems = normalizePredictionList(groupedResponse?.data);
  if (groupedItems.length > 0) {
    return groupedItems;
  }

  const singleResponse = await safeFetchEnvelope<unknown>(`/api/v1/matches/${matchId}/prediction${query}`);
  return normalizePredictionList(singleResponse?.data);
}

type PredictionListQuery = {
  predictionType?: PredictionType | "all";
  status?: string;
  take?: number;
  sport?: string;
  includeMarketAnalysis?: boolean;
};

function buildPredictionQueryString(query: PredictionListQuery): string {
  const params = new URLSearchParams();

  if (query.status && query.status.trim().length > 0) {
    params.set("status", query.status.trim());
  }

  if (query.predictionType && query.predictionType !== "all") {
    params.set("predictionType", query.predictionType);
  }
  if (Number.isFinite(query.take ?? NaN) && (query.take ?? 0) > 0) {
    params.set("take", String(Math.trunc(query.take as number)));
  }
  if (query.sport && query.sport.trim().length > 0) {
    params.set("sport", query.sport.trim().toLowerCase());
  }
  if (query.includeMarketAnalysis) {
    params.set("includeMarketAnalysis", "1");
  }

  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

async function fetchMatchCommentary(matchId: string): Promise<MatchCommentary | null> {
  const commentaryResponse = await safeFetchEnvelope<unknown>(`/api/v1/matches/${matchId}/commentary`);
  if (commentaryResponse?.data && typeof commentaryResponse.data === "object") {
    const normalized = normalizePredictionItem({
      matchId,
      predictionType: "fullTimeResult",
      commentary: commentaryResponse.data
    });
    return normalized?.commentary ?? null;
  }

  const singlePrediction = await safeFetchEnvelope<unknown>(`/api/v1/matches/${matchId}/prediction`);
  const normalized = normalizePredictionItem(singlePrediction?.data);
  return normalized?.commentary ?? null;
}

async function fetchPredictions(query: PredictionListQuery): Promise<MatchPredictionItem[]> {
  const suffix = buildPredictionQueryString(query);
  const response = await safeFetchEnvelope<unknown>(`/api/v1/predictions${suffix}`);
  const normalized = normalizePredictionList(response?.data);
  if (normalized.length > 0 || !query.status) {
    return normalized;
  }

  // Fallback 1: keep finished/in-play data in scope when strict status query fails.
  const broadStatusParams = new URLSearchParams();
  broadStatusParams.set("status", "finished,scheduled,live,postponed,cancelled");
  if (query.sport && query.sport.trim().length > 0) {
    broadStatusParams.set("sport", query.sport.trim().toLowerCase());
  }
  if (query.predictionType && query.predictionType !== "all") {
    broadStatusParams.set("predictionType", query.predictionType);
  }
  if (Number.isFinite(query.take ?? NaN) && (query.take ?? 0) > 0) {
    broadStatusParams.set("take", String(Math.trunc(query.take as number)));
  }

  const broadStatusSuffix = `?${broadStatusParams.toString()}`;
  const broadStatusResponse = await safeFetchEnvelope<unknown>(`/api/v1/predictions${broadStatusSuffix}`);
  const broadNormalized = normalizePredictionList(broadStatusResponse?.data);
  if (broadNormalized.length > 0) {
    return broadNormalized;
  }

  // Fallback 2: last-resort default endpoint.
  const defaultResponse = await safeFetchEnvelope<unknown>("/api/v1/predictions");
  return normalizePredictionList(defaultResponse?.data);
}

export function useMatchPredictions(matchId: string, initialData?: MatchPredictionItem[]) {
  const includeMarketAnalysis = true;
  return useQuery({
    queryKey: ["match-predictions", matchId, includeMarketAnalysis ? "market" : "nomarket"],
    queryFn: () => fetchMatchPredictions(matchId, includeMarketAnalysis),
    enabled: matchId.length > 0,
    retry: 1,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    initialData
  });
}

export function useMatchPredictionByType(matchId: string, predictionType: PredictionType, line?: number) {
  const query = useMatchPredictions(matchId);
  const selected = useMemo(() => {
    const filtered = filterPredictionsByType(query.data ?? [], predictionType);
    if (line === undefined) {
      return filtered;
    }
    return filtered.filter((item) => item.line === line);
  }, [line, predictionType, query.data]);

  return {
    ...query,
    data: selected
  };
}

export function useMatchCommentary(matchId: string, enabled = true) {
  return useQuery({
    queryKey: ["match-commentary", matchId],
    queryFn: () => fetchMatchCommentary(matchId),
    enabled: enabled && matchId.length > 0,
    retry: 1,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true
  });
}

export function usePredictionsByType(
  predictionType?: PredictionType | "all",
  status?: string,
  take?: number,
  sport?: string,
  includeMarketAnalysis?: boolean
) {
  const includeMarket = includeMarketAnalysis ?? sport === "basketball";
  const query = useQuery({
    queryKey: [
      "predictions",
      predictionType ?? "all",
      status ?? "all",
      take ?? "default",
      sport ?? "all",
      includeMarket ? "market" : "nomarket"
    ],
    queryFn: () => fetchPredictions({ predictionType, status, take, sport, includeMarketAnalysis: includeMarket }),
    retry: 1,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true
  });

  const filtered = useMemo(() => filterPredictionsByType(query.data ?? [], predictionType), [predictionType, query.data]);
  return {
    ...query,
    data: filtered
  };
}
