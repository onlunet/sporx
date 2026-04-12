"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Shield } from "lucide-react";

interface Team {
  id: string;
  name: string;
  country?: string | null;
}

interface TeamSelectorProps {
  label: string;
  name: string;
  teams: Team[];
  defaultValue?: string;
  excludedTeamId?: string;
  color: "cyan" | "purple";
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function teamDisplayName(team: Team) {
  return team.country ? `${team.name} (${team.country})` : team.name;
}

export function TeamSelector({ label, name, teams, defaultValue, excludedTeamId, color }: TeamSelectorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTeam = teams.find((team) => team.id === defaultValue);
  const [query, setQuery] = useState(initialTeam ? teamDisplayName(initialTeam) : "");
  const [selectedTeamId, setSelectedTeamId] = useState(initialTeam?.id ?? "");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const colorClasses = {
    cyan: "border-neon-cyan/30 focus:border-neon-cyan focus:ring-neon-cyan/20 bg-neon-cyan/5",
    purple: "border-neon-purple/30 focus:border-neon-purple focus:ring-neon-purple/20 bg-neon-purple/5"
  };

  const iconColors = {
    cyan: "text-neon-cyan",
    purple: "text-neon-purple"
  };

  const availableTeams = useMemo(() => {
    const filtered = teams.filter((team) => !excludedTeamId || team.id !== excludedTeamId);
    const uniqueByDisplay = new Map<string, Team>();
    for (const team of filtered) {
      const key = `${normalizeText(team.name)}|${normalizeText(team.country ?? "")}`;
      if (!uniqueByDisplay.has(key)) {
        uniqueByDisplay.set(key, team);
      }
    }
    return Array.from(uniqueByDisplay.values());
  }, [excludedTeamId, teams]);

  const suggestions = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return availableTeams.slice(0, 20);
    }

    const startsWithMatches: Team[] = [];
    const includesMatches: Team[] = [];

    for (const team of availableTeams) {
      const nameValue = normalizeText(team.name);
      const countryValue = normalizeText(team.country ?? "");
      const fullValue = normalizeText(teamDisplayName(team));

      if (nameValue.startsWith(normalizedQuery) || fullValue.startsWith(normalizedQuery)) {
        startsWithMatches.push(team);
        continue;
      }
      if (nameValue.includes(normalizedQuery) || fullValue.includes(normalizedQuery) || countryValue.includes(normalizedQuery)) {
        includesMatches.push(team);
      }
    }

    return [...startsWithMatches, ...includesMatches].slice(0, 20);
  }, [availableTeams, query]);

  function handleInput(value: string) {
    setQuery(value);
    setIsOpen(true);

    const normalizedValue = normalizeText(value);
    const exactMatch = availableTeams.find((team) => {
      const teamName = normalizeText(team.name);
      const fullName = normalizeText(teamDisplayName(team));
      return teamName === normalizedValue || fullName === normalizedValue;
    });

    setSelectedTeamId(exactMatch?.id ?? "");
  }

  function handleSelect(team: Team) {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setSelectedTeamId(team.id);
    setQuery(teamDisplayName(team));
    setIsOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <Shield className={`h-4 w-4 ${iconColors[color]}`} />
        {label}
      </label>

      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => handleInput(event.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              blurTimerRef.current = setTimeout(() => {
                setIsOpen(false);
                blurTimerRef.current = null;
              }, 120);
            }}
            placeholder="Takım adı yazın..."
            autoComplete="off"
            className={`w-full rounded-xl border py-3 pl-10 pr-4 text-white placeholder-slate-500 outline-none transition-all focus:ring-2 ${colorClasses[color]}`}
            aria-label={label}
            aria-expanded={isOpen}
            aria-controls={`${name}-suggestions`}
          />
        </div>

        <input type="hidden" name={name} value={selectedTeamId} />

        {isOpen ? (
          <div
            id={`${name}-suggestions`}
            className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-white/10 bg-abyss/95 p-1 shadow-2xl backdrop-blur"
          >
            {suggestions.length > 0 ? (
              suggestions.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleSelect(team);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/10 ${
                    team.id === selectedTeamId ? "bg-white/10 text-white" : "text-slate-300"
                  }`}
                >
                  <span className="truncate">{team.name}</span>
                  {team.country ? <span className="ml-2 shrink-0 text-xs text-slate-500">{team.country}</span> : null}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-slate-400">Sonuç bulunamadı.</div>
            )}
          </div>
        ) : null}
      </div>

      {query.trim().length > 0 && !selectedTeamId ? (
        <p className="text-xs text-neon-amber">Listeden bir takım seçin.</p>
      ) : null}
    </div>
  );
}

