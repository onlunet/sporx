"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MatchPredictionItem, PredictionType, MatchCommentary } from "./types";
import { filterPredictionsByType, normalizePredictionItem, normalizePredictionList } from "./normalize";
import { resolveBrowserApiBase } from "../../lib/api-base-url";

const API_URL = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);

type Envelope<T> = {
  success: boolean;
  data: T;
  meta: unknown;
  error: unknown;
};

async function safeFetchEnvelope<T>(path: string): Promise<Envelope<T> | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
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

async function fetchMatchPredictions(matchId: string): Promise<MatchPredictionItem[]> {
  const groupedResponse = await safeFetchEnvelope<unknown>(`/api/v1/matches/${matchId}/predictions`);
  const groupedItems = normalizePredictionList(groupedResponse?.data);
  if (groupedItems.length > 0) {
    return groupedItems;
  }

  const singleResponse = await safeFetchEnvelope<unknown>(`/api/v1/matches/${matchId}/prediction`);
  return normalizePredictionList(singleResponse?.data);
}

type PredictionListQuery = {
  predictionType?: PredictionType | "all";
  status?: string;
};

function buildPredictionQueryString(query: PredictionListQuery): string {
  const params = new URLSearchParams();

  if (query.status && query.status.trim().length > 0) {
    params.set("status", query.status.trim());
  }

  if (query.predictionType && query.predictionType !== "all") {
    params.set("predictionType", query.predictionType);
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
  return normalizePredictionList(response?.data);
}

export function useMatchPredictions(matchId: string, initialData?: MatchPredictionItem[]) {
  return useQuery({
    queryKey: ["match-predictions", matchId],
    queryFn: () => fetchMatchPredictions(matchId),
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

export function usePredictionsByType(predictionType?: PredictionType | "all", status?: string) {
  const query = useQuery({
    queryKey: ["predictions", predictionType ?? "all", status ?? "all"],
    queryFn: () => fetchPredictions({ predictionType, status }),
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
