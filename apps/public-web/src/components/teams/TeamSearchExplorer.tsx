"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type TeamRecord = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
};

interface TeamSearchExplorerProps {
  teams: TeamRecord[];
  initialQuery?: string;
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function teamSearchableText(team: TeamRecord) {
  return [team.name, team.shortName ?? "", team.country ?? ""].map((item) => normalizeText(item));
}

export function TeamSearchExplorer({ teams, initialQuery = "" }: TeamSearchExplorerProps) {
  const [query, setQuery] = useState(initialQuery.trim());
  const [isOpen, setIsOpen] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const normalizedQuery = normalizeText(query);

  const filteredTeams = useMemo(() => {
    if (!normalizedQuery) {
      return teams;
    }
    return teams.filter((team) => teamSearchableText(team).some((item) => item.includes(normalizedQuery)));
  }, [normalizedQuery, teams]);

  const suggestions = useMemo(() => {
    if (!normalizedQuery) {
      return teams.slice(0, 10);
    }

    const startsWithMatches: TeamRecord[] = [];
    const includesMatches: TeamRecord[] = [];

    for (const team of teams) {
      const [name, shortName, country] = teamSearchableText(team);
      if (name.startsWith(normalizedQuery) || shortName.startsWith(normalizedQuery)) {
        startsWithMatches.push(team);
        continue;
      }
      if (name.includes(normalizedQuery) || shortName.includes(normalizedQuery) || country.includes(normalizedQuery)) {
        includesMatches.push(team);
      }
    }

    return [...startsWithMatches, ...includesMatches].slice(0, 10);
  }, [normalizedQuery, teams]);

  function selectSuggestion(team: TeamRecord) {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setQuery(team.name);
    setIsOpen(false);
  }

  function clearQuery() {
    setQuery("");
    setIsOpen(false);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Takımlar</h1>

      <div className="rounded-md border border-slate-700 p-3">
        <label htmlFor="team-search" className="mb-2 block text-sm font-medium text-slate-300">
          Takım ara
        </label>

        <div className="relative">
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              id="team-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              onBlur={() => {
                blurTimerRef.current = setTimeout(() => {
                  setIsOpen(false);
                  blurTimerRef.current = null;
                }, 120);
              }}
              placeholder="Takım adı, kısa ad veya ülke yazın"
              className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              autoComplete="off"
            />

            {query.length > 0 ? (
              <button
                type="button"
                onClick={clearQuery}
                className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Temizle
              </button>
            ) : null}
          </div>

          {isOpen && suggestions.length > 0 ? (
            <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-md border border-slate-700 bg-slate-950 shadow-2xl">
              {suggestions.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectSuggestion(team);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                >
                  <span className="truncate">{team.name}</span>
                  {team.country ? <span className="ml-3 shrink-0 text-xs text-slate-400">{team.country}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <p className="text-sm text-slate-400">
        Toplam {teams.length} takım yüklendi. {normalizedQuery ? `Arama sonucu: ${filteredTeams.length} takım.` : ""}
      </p>

      {filteredTeams.length === 0 ? (
        <div className="rounded-md border border-slate-700 p-4 text-sm text-slate-300">
          Aramaya uygun takım bulunamadı. Farklı bir anahtar kelime deneyin.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {filteredTeams.map((team) => (
            <li key={team.id} className="rounded-md border border-slate-700 p-3">
              <Link className="font-medium text-slate-100 hover:text-white" href={`/teams/${team.id}`}>
                {team.name}
              </Link>
              <p className="text-xs text-slate-400">{team.country ?? "Bilinmiyor"}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

