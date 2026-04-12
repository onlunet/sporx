"use client";

import { useQuery } from "@tanstack/react-query";
import { publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../lib/fetch-with-schema";

export function PredictionsList() {
  const query = useQuery({
    queryKey: ["predictions"],
    queryFn: () => fetchWithSchema("/api/v1/predictions", publicContract.predictionsResponseSchema)
  });

  if (query.isLoading) {
    return <p className="text-slate-400">Tahminler yükleniyor...</p>;
  }

  if (query.isError) {
    return <p className="text-red-300">Tahmin verisi alınamadı.</p>;
  }

  if (!query.data || query.data.data.length === 0) {
    return <p className="text-slate-400">Tahmin verisi bulunamadı.</p>;
  }

  return (
    <ul className="space-y-2">
      {query.data.data.slice(0, 20).map((item: (typeof query.data.data)[number]) => (
        <li key={item.matchId} className="rounded-md border border-slate-700 p-3">
          <p className="text-sm">Maç ID: {item.matchId}</p>
          {item.matchDateTimeUTC ? (
            <p className="text-xs text-slate-500">
              {new Date(item.matchDateTimeUTC).toLocaleString("tr-TR", {
                dateStyle: "medium",
                timeStyle: "short"
              })}
            </p>
          ) : null}
          <p className="text-xs text-slate-300">Güven: {Math.round(item.confidenceScore * 100)}%</p>
          <p className="text-xs text-slate-400">{item.summary}</p>
        </li>
      ))}
    </ul>
  );
}
