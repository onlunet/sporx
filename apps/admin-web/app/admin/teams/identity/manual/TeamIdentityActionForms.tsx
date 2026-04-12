"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TeamOption = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
};

type SearchableTeamInputProps = {
  label: string;
  name: string;
  teams: TeamOption[];
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  excludedIds?: string[];
  placeholder?: string;
};

type TeamIdentityActionFormsProps = {
  teams: TeamOption[];
};

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function shortId(value: string) {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function teamFullLabel(team: TeamOption) {
  const country = team.country ? ` (${team.country})` : "";
  return `${team.name}${country}`;
}

function teamSearchLabel(team: TeamOption) {
  const country = team.country ? ` | ${team.country}` : "";
  return `${team.name}${country} | ${shortId(team.id)}`;
}

function SelectedTeamCard({
  title,
  team,
  tone
}: {
  title: string;
  team: TeamOption | null;
  tone: "cyan" | "amber" | "emerald";
}) {
  const toneClass: Record<typeof tone, string> = {
    cyan: "border-cyan-800/60 bg-cyan-950/20",
    amber: "border-amber-800/60 bg-amber-950/20",
    emerald: "border-emerald-800/60 bg-emerald-950/20"
  };

  return (
    <div className={`rounded-md border p-2 ${toneClass[tone]}`}>
      <p className="text-[11px] font-medium text-slate-300">{title}</p>
      {team ? (
        <div className="mt-1 space-y-0.5 text-xs text-slate-200">
          <p className="font-medium text-slate-100">{team.name}</p>
          <p>{team.country ?? "Ülke yok"}</p>
          <p className="text-slate-400">{shortId(team.id)}</p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-500">Takım seçilmedi</p>
      )}
    </div>
  );
}

function SearchableTeamInput({
  label,
  name,
  teams,
  selectedId,
  onSelectedIdChange,
  excludedIds = [],
  placeholder = "Takım adı yazın"
}: SearchableTeamInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTeam = teams.find((team) => team.id === selectedId) ?? null;
  const [query, setQuery] = useState(selectedTeam ? teamFullLabel(selectedTeam) : "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const team = teams.find((item) => item.id === selectedId) ?? null;
    setQuery(team ? teamFullLabel(team) : "");
  }, [selectedId, teams]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const availableTeams = useMemo(() => {
    if (excludedIds.length === 0) {
      return teams;
    }
    const blocked = new Set(excludedIds.filter((id) => id.length > 0));
    return teams.filter((team) => !blocked.has(team.id));
  }, [excludedIds, teams]);

  const suggestions = useMemo(() => {
    const needle = normalizeText(query);
    if (!needle) {
      return availableTeams.slice(0, 18);
    }

    const startsWith: TeamOption[] = [];
    const includes: TeamOption[] = [];

    for (const team of availableTeams) {
      const name = normalizeText(team.name);
      const shortName = normalizeText(team.shortName ?? "");
      const country = normalizeText(team.country ?? "");

      if (name.startsWith(needle) || shortName.startsWith(needle)) {
        startsWith.push(team);
        continue;
      }

      if (name.includes(needle) || shortName.includes(needle) || country.includes(needle)) {
        includes.push(team);
      }
    }

    return [...startsWith, ...includes].slice(0, 18);
  }, [availableTeams, query]);

  function selectTeam(team: TeamOption) {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }

    onSelectedIdChange(team.id);
    setQuery(teamFullLabel(team));
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleInput(value: string) {
    setQuery(value);
    setOpen(true);

    const normalized = normalizeText(value);
    const exact = availableTeams.find((team) => {
      const fullName = normalizeText(teamFullLabel(team));
      const teamName = normalizeText(team.name);
      return fullName === normalized || teamName === normalized;
    });

    onSelectedIdChange(exact?.id ?? "");
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-slate-300">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => handleInput(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => {
              setOpen(false);
              blurTimerRef.current = null;
            }, 120);
          }}
          placeholder={placeholder}
          className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-700"
          autoComplete="off"
        />
        <input type="hidden" name={name} value={selectedId} />

        {open ? (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-700 bg-slate-950 shadow-2xl">
            {suggestions.length > 0 ? (
              suggestions.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectTeam(team);
                  }}
                  className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-slate-800 ${
                    team.id === selectedId ? "bg-slate-800 text-slate-100" : "text-slate-300"
                  }`}
                >
                  <span className="truncate">{team.name}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-slate-500">{team.country ?? "-"}</span>
                </button>
              ))
            ) : (
              <p className="px-2 py-1.5 text-xs text-slate-500">Sonuç bulunamadı.</p>
            )}
          </div>
        ) : null}
      </div>

      {selectedTeam ? <p className="text-[11px] text-slate-500">{teamSearchLabel(selectedTeam)}</p> : null}
    </div>
  );
}

export function TeamIdentityActionForms({ teams }: TeamIdentityActionFormsProps) {
  const [mergeA, setMergeA] = useState("");
  const [mergeB, setMergeB] = useState("");

  const [blockLeft, setBlockLeft] = useState("");
  const [blockRight, setBlockRight] = useState("");

  const [unblockLeft, setUnblockLeft] = useState("");
  const [unblockRight, setUnblockRight] = useState("");

  const teamById = useMemo(() => {
    return new Map(teams.map((team) => [team.id, team]));
  }, [teams]);

  const mergeInvalid = mergeA.length === 0 || mergeB.length === 0 || mergeA === mergeB;
  const blockInvalid = blockLeft.length === 0 || blockRight.length === 0 || blockLeft === blockRight;
  const unblockInvalid = unblockLeft.length === 0 || unblockRight.length === 0 || unblockLeft === unblockRight;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <form
        action="/api/admin/teams/identity/action?next=/admin/teams/identity/manual"
        method="post"
        className="space-y-3 rounded-md border border-cyan-900/60 bg-cyan-950/20 p-3"
      >
        <input type="hidden" name="action" value="merge_group" />
        <h3 className="text-sm font-semibold text-cyan-200">İki Takımı Birleştir</h3>
        <p className="text-xs text-slate-300">Aynı kulübe ait kayıtları tek kanonik kimlikte toplayın.</p>

        <SearchableTeamInput
          label="Takım 1"
          name="teamIds"
          teams={teams}
          selectedId={mergeA}
          onSelectedIdChange={setMergeA}
          excludedIds={mergeB ? [mergeB] : []}
        />

        <SearchableTeamInput
          label="Takım 2"
          name="teamIds"
          teams={teams}
          selectedId={mergeB}
          onSelectedIdChange={setMergeB}
          excludedIds={mergeA ? [mergeA] : []}
        />

        <div className="grid gap-2 sm:grid-cols-2">
          <SelectedTeamCard title="Seçilen Takım 1" team={teamById.get(mergeA) ?? null} tone="cyan" />
          <SelectedTeamCard title="Seçilen Takım 2" team={teamById.get(mergeB) ?? null} tone="cyan" />
        </div>

        {mergeA && mergeB && mergeA === mergeB ? (
          <p className="text-[11px] text-amber-300">Aynı takım iki kez seçilemez.</p>
        ) : null}

        <button
          type="submit"
          disabled={mergeInvalid}
          className={`rounded border px-3 py-1.5 text-xs font-medium ${
            mergeInvalid
              ? "cursor-not-allowed border-slate-700 bg-slate-900/60 text-slate-500"
              : "border-cyan-700 bg-cyan-950/50 text-cyan-200 hover:bg-cyan-900/40"
          }`}
        >
          Birleştir
        </button>
      </form>

      <form
        action="/api/admin/teams/identity/action?next=/admin/teams/identity/manual"
        method="post"
        className="space-y-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-3"
      >
        <input type="hidden" name="action" value="block_pair" />
        <h3 className="text-sm font-semibold text-amber-200">Eşleşmeyi Engelle</h3>
        <p className="text-xs text-slate-300">Yanlış birleştirilen iki takımın tekrar birleşmesini engelleyin.</p>

        <SearchableTeamInput
          label="Sol Takım"
          name="leftTeamId"
          teams={teams}
          selectedId={blockLeft}
          onSelectedIdChange={setBlockLeft}
          excludedIds={blockRight ? [blockRight] : []}
        />

        <SearchableTeamInput
          label="Sağ Takım"
          name="rightTeamId"
          teams={teams}
          selectedId={blockRight}
          onSelectedIdChange={setBlockRight}
          excludedIds={blockLeft ? [blockLeft] : []}
        />

        <div className="grid gap-2 sm:grid-cols-2">
          <SelectedTeamCard title="Sol Seçim" team={teamById.get(blockLeft) ?? null} tone="amber" />
          <SelectedTeamCard title="Sağ Seçim" team={teamById.get(blockRight) ?? null} tone="amber" />
        </div>

        {blockLeft && blockRight && blockLeft === blockRight ? (
          <p className="text-[11px] text-amber-300">Aynı takım iki kez seçilemez.</p>
        ) : null}

        <button
          type="submit"
          disabled={blockInvalid}
          className={`rounded border px-3 py-1.5 text-xs font-medium ${
            blockInvalid
              ? "cursor-not-allowed border-slate-700 bg-slate-900/60 text-slate-500"
              : "border-amber-700 bg-amber-950/50 text-amber-200 hover:bg-amber-900/40"
          }`}
        >
          Eşleşmeyi Engelle
        </button>
      </form>

      <form
        action="/api/admin/teams/identity/action?next=/admin/teams/identity/manual"
        method="post"
        className="space-y-3 rounded-md border border-emerald-900/60 bg-emerald-950/20 p-3"
      >
        <input type="hidden" name="action" value="unblock_pair" />
        <h3 className="text-sm font-semibold text-emerald-200">Engeli Kaldır</h3>
        <p className="text-xs text-slate-300">Daha önce engellenen bir çiftin tekrar eşleşmesine izin verin.</p>

        <SearchableTeamInput
          label="Sol Takım"
          name="leftTeamId"
          teams={teams}
          selectedId={unblockLeft}
          onSelectedIdChange={setUnblockLeft}
          excludedIds={unblockRight ? [unblockRight] : []}
        />

        <SearchableTeamInput
          label="Sağ Takım"
          name="rightTeamId"
          teams={teams}
          selectedId={unblockRight}
          onSelectedIdChange={setUnblockRight}
          excludedIds={unblockLeft ? [unblockLeft] : []}
        />

        <div className="grid gap-2 sm:grid-cols-2">
          <SelectedTeamCard title="Sol Seçim" team={teamById.get(unblockLeft) ?? null} tone="emerald" />
          <SelectedTeamCard title="Sağ Seçim" team={teamById.get(unblockRight) ?? null} tone="emerald" />
        </div>

        {unblockLeft && unblockRight && unblockLeft === unblockRight ? (
          <p className="text-[11px] text-amber-300">Aynı takım iki kez seçilemez.</p>
        ) : null}

        <button
          type="submit"
          disabled={unblockInvalid}
          className={`rounded border px-3 py-1.5 text-xs font-medium ${
            unblockInvalid
              ? "cursor-not-allowed border-slate-700 bg-slate-900/60 text-slate-500"
              : "border-emerald-700 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/40"
          }`}
        >
          Engeli Kaldır
        </button>
      </form>
    </div>
  );
}
