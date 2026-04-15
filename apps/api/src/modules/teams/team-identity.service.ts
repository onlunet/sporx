import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Team } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

type TeamWithCounts = Team & {
  _count: {
    homeMatches: number;
    awayMatches: number;
    providerMappings: number;
  };
};

type TeamIdentityRules = {
  manualMergeGroups: string[][];
  manualBlockPairs: Array<{ leftTeamId: string; rightTeamId: string }>;
};

type TeamIdentitySnapshot = {
  createdAtMs: number;
  teamsById: Map<string, TeamWithCounts>;
  canonicalTeams: Team[];
  canonicalIdByTeamId: Map<string, string>;
  equivalentIdsByCanonicalId: Map<string, string[]>;
  canonicalTeamById: Map<string, Team>;
  rules: TeamIdentityRules;
};

type ResolvedTeamIdentity = {
  canonicalId: string;
  canonicalTeam: Team;
  equivalentIds: string[];
};

type TeamIdentityRuleActionInput = {
  action: "merge_group" | "unmerge_group" | "block_pair" | "unblock_pair";
  teamIds?: string[] | string;
  leftTeamId?: string;
  rightTeamId?: string;
};

const TEAM_IDENTITY_RULES_KEY = "team_identity_rules";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly members = new Map<string, Set<string>>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.parent.set(id, id);
      this.members.set(id, new Set([id]));
    }
  }

  find(id: string): string {
    const current = this.parent.get(id);
    if (!current) {
      this.parent.set(id, id);
      this.members.set(id, new Set([id]));
      return id;
    }
    if (current === id) {
      return id;
    }
    const root = this.find(current);
    this.parent.set(id, root);
    return root;
  }

  membersOfRoot(root: string): Set<string> {
    return this.members.get(root) ?? new Set([root]);
  }

  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) {
      return leftRoot;
    }

    const [winner, loser] = leftRoot.localeCompare(rightRoot) <= 0 ? [leftRoot, rightRoot] : [rightRoot, leftRoot];
    const winnerMembers = this.membersOfRoot(winner);
    const loserMembers = this.membersOfRoot(loser);

    for (const member of loserMembers) {
      this.parent.set(member, winner);
      winnerMembers.add(member);
    }
    this.members.set(winner, winnerMembers);
    this.members.delete(loser);
    return winner;
  }

  groups() {
    return Array.from(this.members.values()).map((members) => Array.from(members));
  }
}

@Injectable()
export class TeamIdentityService {
  private snapshot: TeamIdentitySnapshot | null = null;
  private snapshotPromise: Promise<TeamIdentitySnapshot> | null = null;
  private readonly snapshotTtlMs = this.parseSnapshotTtlMs();

  constructor(private readonly prisma: PrismaService) {}

  private parseSnapshotTtlMs() {
    const raw = Number(process.env.TEAM_IDENTITY_SNAPSHOT_TTL_MS ?? "");
    if (Number.isFinite(raw) && raw >= 60_000) {
      return Math.floor(raw);
    }
    return 45 * 60 * 1000;
  }

  private isUuidLike(value: string) {
    return UUID_REGEX.test(value);
  }

  private normalizeTeamIds(raw: string[] | string | undefined): string[] {
    if (Array.isArray(raw)) {
      return Array.from(new Set(raw.map((id) => String(id).trim()).filter((id) => this.isUuidLike(id)))).sort((a, b) =>
        a.localeCompare(b)
      );
    }
    if (typeof raw === "string") {
      return Array.from(
        new Set(
          raw
            .split(/[,\s]+/g)
            .map((id) => id.trim())
            .filter((id) => this.isUuidLike(id))
        )
      ).sort((a, b) => a.localeCompare(b));
    }
    return [];
  }

  private normalizeAlias(value: string | null | undefined) {
    const input = String(value ?? "").trim();
    if (!input) {
      return "";
    }
    return input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(
        /\b(s\.?\s*k\.?|sk|fc|cf|sc|afc|ac|fk|bk|jk|nk|club|football|soccer|sport|sports|spor|kulubu|kulub|kulup|team|associazione|calcio)\b/g,
        " "
      )
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(s|k)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private normalizeCountry(value: string | null | undefined) {
    const key = this.normalizeAlias(value).replace(/\s+/g, "");
    if (!key) {
      return "";
    }
    const map: Record<string, string> = {
      tr: "tr",
      tur: "tr",
      turkey: "tr",
      turkiye: "tr",
      turkye: "tr",
      es: "es",
      esp: "es",
      spain: "es",
      fr: "fr",
      fra: "fr",
      france: "fr",
      de: "de",
      deu: "de",
      ger: "de",
      germany: "de",
      it: "it",
      ita: "it",
      italy: "it",
      pt: "pt",
      prt: "pt",
      portugal: "pt",
      dk: "dk",
      dnk: "dk",
      denmark: "dk",
      br: "br",
      bra: "br",
      brazil: "br",
      ar: "ar",
      arg: "ar",
      argentina: "ar",
      uy: "uy",
      ury: "uy",
      uruguay: "uy",
      gb: "gb",
      gbr: "gb",
      uk: "gb",
      eng: "gb",
      england: "gb",
      us: "us",
      usa: "us",
      unitedstates: "us",
      unitedstatesofamerica: "us",
      int: "int",
      intl: "int",
      international: "int"
    };
    return map[key] ?? key;
  }

  private countryCompatible(left: string | null | undefined, right: string | null | undefined) {
    const normalizedLeft = this.normalizeCountry(left);
    const normalizedRight = this.normalizeCountry(right);
    if (!normalizedLeft || !normalizedRight) {
      return true;
    }
    if (normalizedLeft === normalizedRight) {
      return true;
    }
    if (normalizedLeft === "int" || normalizedRight === "int") {
      return true;
    }
    return false;
  }

  private sameIdentityName(left: TeamWithCounts, right: TeamWithCounts) {
    const leftName = this.normalizeAlias(left.name);
    const rightName = this.normalizeAlias(right.name);
    if (leftName && leftName === rightName) {
      return true;
    }
    const leftShort = this.normalizeAlias(left.shortName);
    const rightShort = this.normalizeAlias(right.shortName);
    if (leftShort && rightShort && leftShort === rightShort) {
      return true;
    }
    if (leftShort && leftShort === rightName) {
      return true;
    }
    if (rightShort && rightShort === leftName) {
      return true;
    }
    return false;
  }

  private shouldMerge(left: TeamWithCounts, right: TeamWithCounts) {
    if (!this.sameIdentityName(left, right)) {
      return false;
    }
    if (!this.countryCompatible(left.country, right.country)) {
      return false;
    }
    return true;
  }

  private teamScore(team: TeamWithCounts) {
    const totalMatches = team._count.homeMatches + team._count.awayMatches;
    const providerMappings = team._count.providerMappings;
    const quality = team.dataQualityScore ?? 0;
    const countryBonus = team.country ? 1 : 0;
    const shortNameBonus = team.shortName ? 1 : 0;
    return totalMatches * 100 + providerMappings * 20 + quality * 10 + countryBonus + shortNameBonus;
  }

  private pickCanonicalTeam(teams: TeamWithCounts[]) {
    return [...teams].sort((left, right) => {
      const scoreDiff = this.teamScore(right) - this.teamScore(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      const createdDiff = left.createdAt.getTime() - right.createdAt.getTime();
      if (createdDiff !== 0) {
        return createdDiff;
      }
      return left.id.localeCompare(right.id);
    })[0];
  }

  private stripCounts(team: TeamWithCounts): Team {
    const { _count, ...plain } = team;
    return plain;
  }

  private pairKey(leftTeamId: string, rightTeamId: string) {
    return leftTeamId.localeCompare(rightTeamId) <= 0
      ? `${leftTeamId}::${rightTeamId}`
      : `${rightTeamId}::${leftTeamId}`;
  }

  private normalizeRulesPayload(raw: unknown): TeamIdentityRules {
    const manualMergeGroupsRaw =
      raw && typeof raw === "object" && Array.isArray((raw as { manualMergeGroups?: unknown }).manualMergeGroups)
        ? ((raw as { manualMergeGroups: unknown[] }).manualMergeGroups as unknown[])
        : [];
    const manualBlockPairsRaw =
      raw && typeof raw === "object" && Array.isArray((raw as { manualBlockPairs?: unknown }).manualBlockPairs)
        ? ((raw as { manualBlockPairs: unknown[] }).manualBlockPairs as unknown[])
        : [];

    const mergeSet = new Set<string>();
    const manualMergeGroups: string[][] = [];
    for (const item of manualMergeGroupsRaw) {
      const ids = this.normalizeTeamIds(item as string[] | string | undefined);
      if (ids.length < 2) {
        continue;
      }
      const key = ids.join(",");
      if (mergeSet.has(key)) {
        continue;
      }
      mergeSet.add(key);
      manualMergeGroups.push(ids);
    }

    const blockSet = new Set<string>();
    const manualBlockPairs: Array<{ leftTeamId: string; rightTeamId: string }> = [];
    for (const item of manualBlockPairsRaw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const leftTeamId = String((item as { leftTeamId?: unknown }).leftTeamId ?? "").trim();
      const rightTeamId = String((item as { rightTeamId?: unknown }).rightTeamId ?? "").trim();
      if (!this.isUuidLike(leftTeamId) || !this.isUuidLike(rightTeamId) || leftTeamId === rightTeamId) {
        continue;
      }
      const key = this.pairKey(leftTeamId, rightTeamId);
      if (blockSet.has(key)) {
        continue;
      }
      blockSet.add(key);
      const [first, second] = leftTeamId.localeCompare(rightTeamId) <= 0 ? [leftTeamId, rightTeamId] : [rightTeamId, leftTeamId];
      manualBlockPairs.push({ leftTeamId: first, rightTeamId: second });
    }

    return {
      manualMergeGroups,
      manualBlockPairs
    };
  }

  async getRules(): Promise<TeamIdentityRules> {
    const record = await this.prisma.systemSetting.findUnique({
      where: { key: TEAM_IDENTITY_RULES_KEY }
    });
    if (!record) {
      return { manualMergeGroups: [], manualBlockPairs: [] };
    }
    return this.normalizeRulesPayload(record.value);
  }

  private async saveRules(rules: TeamIdentityRules) {
    const normalized = this.normalizeRulesPayload(rules);
    await this.prisma.systemSetting.upsert({
      where: { key: TEAM_IDENTITY_RULES_KEY },
      update: {
        value: normalized as unknown as Prisma.InputJsonValue,
        description: "Takim kimlik birlestirme / engelleme kurallari"
      },
      create: {
        key: TEAM_IDENTITY_RULES_KEY,
        value: normalized as unknown as Prisma.InputJsonValue,
        description: "Takim kimlik birlestirme / engelleme kurallari"
      }
    });
  }

  private canUnionWithBlockRules(
    uf: UnionFind,
    leftTeamId: string,
    rightTeamId: string,
    blockedPairs: Set<string>
  ) {
    const leftRoot = uf.find(leftTeamId);
    const rightRoot = uf.find(rightTeamId);
    if (leftRoot === rightRoot) {
      return true;
    }

    const leftMembers = uf.membersOfRoot(leftRoot);
    const rightMembers = uf.membersOfRoot(rightRoot);
    for (const leftMember of leftMembers) {
      for (const rightMember of rightMembers) {
        if (blockedPairs.has(this.pairKey(leftMember, rightMember))) {
          return false;
        }
      }
    }
    return true;
  }

  private buildSummary(snapshot: TeamIdentitySnapshot) {
    const totalTeams = snapshot.teamsById.size;
    const canonicalTeams = snapshot.canonicalTeams.length;
    return {
      totalTeams,
      canonicalTeams,
      mergedTeams: totalTeams - canonicalTeams,
      manualMergeGroups: snapshot.rules.manualMergeGroups.length,
      manualBlockPairs: snapshot.rules.manualBlockPairs.length
    };
  }

  private async buildSnapshot(): Promise<TeamIdentitySnapshot> {
    const [teams, rules] = await Promise.all([
      this.prisma.team.findMany({
        include: {
          _count: {
            select: {
              homeMatches: true,
              awayMatches: true,
              providerMappings: true
            }
          }
        }
      }),
      this.getRules()
    ]);

    const teamsById = new Map<string, TeamWithCounts>(teams.map((team) => [team.id, team]));
    const uf = new UnionFind(teams.map((team) => team.id));
    const blockedPairSet = new Set(rules.manualBlockPairs.map((pair) => this.pairKey(pair.leftTeamId, pair.rightTeamId)));

    const nameGroups = new Map<string, TeamWithCounts[]>();
    for (const team of teams) {
      const key = this.normalizeAlias(team.name);
      if (!key) {
        continue;
      }
      const bucket = nameGroups.get(key) ?? [];
      bucket.push(team);
      nameGroups.set(key, bucket);
    }

    for (const groupedTeams of nameGroups.values()) {
      if (groupedTeams.length < 2) {
        continue;
      }

      const knownCountries = Array.from(
        new Set(
          groupedTeams
            .map((team) => this.normalizeCountry(team.country))
            .filter((country) => country.length > 0 && country !== "int")
        )
      );

      const mergeWithin = (teamsToMerge: TeamWithCounts[]) => {
        for (let i = 0; i < teamsToMerge.length; i += 1) {
          for (let j = i + 1; j < teamsToMerge.length; j += 1) {
            const left = teamsToMerge[i];
            const right = teamsToMerge[j];
            if (
              this.shouldMerge(left, right) &&
              this.canUnionWithBlockRules(uf, left.id, right.id, blockedPairSet)
            ) {
              uf.union(left.id, right.id);
            }
          }
        }
      };

      if (knownCountries.length <= 1) {
        mergeWithin(groupedTeams);
        continue;
      }

      const byCountry = new Map<string, TeamWithCounts[]>();
      for (const team of groupedTeams) {
        const normalizedCountry = this.normalizeCountry(team.country);
        if (!normalizedCountry || normalizedCountry === "int") {
          continue;
        }
        const bucket = byCountry.get(normalizedCountry) ?? [];
        bucket.push(team);
        byCountry.set(normalizedCountry, bucket);
      }

      for (const countryBucket of byCountry.values()) {
        if (countryBucket.length > 1) {
          mergeWithin(countryBucket);
        }
      }
    }

    for (const mergeGroup of rules.manualMergeGroups) {
      const ids = mergeGroup.filter((teamId) => teamsById.has(teamId));
      if (ids.length < 2) {
        continue;
      }
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const left = ids[i];
          const right = ids[j];
          if (this.canUnionWithBlockRules(uf, left, right, blockedPairSet)) {
            uf.union(left, right);
          }
        }
      }
    }

    const canonicalIdByTeamId = new Map<string, string>();
    const equivalentIdsByCanonicalId = new Map<string, string[]>();
    const canonicalTeamById = new Map<string, Team>();

    for (const ids of uf.groups()) {
      const clusterTeams = ids.map((id) => teamsById.get(id)).filter((team): team is TeamWithCounts => !!team);
      if (clusterTeams.length === 0) {
        continue;
      }
      const canonical = this.pickCanonicalTeam(clusterTeams);
      const canonicalId = canonical.id;
      const sortedIds = [...ids].sort((left, right) => left.localeCompare(right));

      for (const id of ids) {
        canonicalIdByTeamId.set(id, canonicalId);
      }
      equivalentIdsByCanonicalId.set(canonicalId, sortedIds);
      canonicalTeamById.set(canonicalId, this.stripCounts(canonical));
    }

    const canonicalTeams = Array.from(canonicalTeamById.values()).sort((left, right) => left.name.localeCompare(right.name));

    return {
      createdAtMs: Date.now(),
      teamsById,
      canonicalTeams,
      canonicalIdByTeamId,
      equivalentIdsByCanonicalId,
      canonicalTeamById,
      rules
    };
  }

  private async getSnapshot(forceRefresh = false): Promise<TeamIdentitySnapshot> {
    const now = Date.now();
    if (!forceRefresh && this.snapshot && now - this.snapshot.createdAtMs < this.snapshotTtlMs) {
      return this.snapshot;
    }
    if (!this.snapshotPromise) {
      this.snapshotPromise = this.buildSnapshot()
        .then((snapshot) => {
          this.snapshot = snapshot;
          return snapshot;
        })
        .finally(() => {
          this.snapshotPromise = null;
        });
    }
    return this.snapshotPromise;
  }

  private invalidateSnapshot() {
    this.snapshot = null;
    this.snapshotPromise = null;
  }

  async listCanonicalTeams(limit = 10000) {
    const snapshot = await this.getSnapshot();
    return snapshot.canonicalTeams.slice(0, limit);
  }

  async resolveCanonicalTeam(teamId: string): Promise<ResolvedTeamIdentity> {
    const snapshot = await this.getSnapshot();
    const canonicalId = snapshot.canonicalIdByTeamId.get(teamId);
    if (!canonicalId) {
      throw new NotFoundException("Team not found");
    }
    const canonicalTeam = snapshot.canonicalTeamById.get(canonicalId);
    if (!canonicalTeam) {
      throw new NotFoundException("Team not found");
    }
    const equivalentIds = snapshot.equivalentIdsByCanonicalId.get(canonicalId) ?? [canonicalId];
    return {
      canonicalId,
      canonicalTeam,
      equivalentIds
    };
  }

  async resolveEquivalentTeamIds(teamId: string) {
    const resolved = await this.resolveCanonicalTeam(teamId);
    return resolved.equivalentIds;
  }

  async getIdentityIssues(limit = 120) {
    const snapshot = await this.getSnapshot();
    const teams = Array.from(snapshot.teamsById.values());
    const nameGroups = new Map<string, TeamWithCounts[]>();

    for (const team of teams) {
      const key = this.normalizeAlias(team.name);
      if (!key) {
        continue;
      }
      const bucket = nameGroups.get(key) ?? [];
      bucket.push(team);
      nameGroups.set(key, bucket);
    }

    const blockedPairSet = new Set(
      snapshot.rules.manualBlockPairs.map((pair) => this.pairKey(pair.leftTeamId, pair.rightTeamId))
    );

    const issues = Array.from(nameGroups.entries())
      .filter(([, grouped]) => grouped.length > 1)
      .map(([normalizedName, grouped]) => {
        const sorted = [...grouped].sort((left, right) => this.teamScore(right) - this.teamScore(left));
        const topTeam = sorted[0];
        const canonicalTeamId = snapshot.canonicalIdByTeamId.get(topTeam.id) ?? topTeam.id;
        const canonicalTeam = snapshot.canonicalTeamById.get(canonicalTeamId) ?? this.stripCounts(topTeam);
        const uniqueCanonicalIds = new Set(
          sorted.map((team) => snapshot.canonicalIdByTeamId.get(team.id) ?? team.id)
        );
        const autoMerged = uniqueCanonicalIds.size === 1;
        const normalizedCountrySet = Array.from(
          new Set(
            sorted
              .map((team) => this.normalizeCountry(team.country))
              .filter((country) => country.length > 0 && country !== "int")
          )
        );
        const displayCountries = Array.from(
          new Set(sorted.map((team) => String(team.country ?? "").trim()).filter((country) => country.length > 0))
        );

        const blockedPairCount = snapshot.rules.manualBlockPairs.filter((pair) => {
          const groupTeamIds = new Set(sorted.map((team) => team.id));
          return groupTeamIds.has(pair.leftTeamId) && groupTeamIds.has(pair.rightTeamId);
        }).length;

        let riskLevel: "low" | "medium" | "high" = "low";
        let reason = "Kayitlar tek kimlige baglanmis durumda.";
        if (!autoMerged && normalizedCountrySet.length > 1) {
          riskLevel = "high";
          reason = "Ayni isim farkli ulke kayitlariyla eslesiyor. Yanlis birlesme riski yuksek.";
        } else if (!autoMerged) {
          riskLevel = "medium";
          reason = "Ayni isimli kayitlar ayrik kalmis. Manuel birlestirme gerekebilir.";
        } else if (normalizedCountrySet.length > 1) {
          riskLevel = "medium";
          reason = "Kayitlar birlesik, ancak ulke kodlari farkli formatta geliyor.";
        }

        const actionCandidates = sorted
          .filter((team) => team.id !== canonicalTeamId)
          .map((team) => {
            const blocked = blockedPairSet.has(this.pairKey(canonicalTeamId, team.id));
            const mergeRecommended = this.countryCompatible(canonicalTeam.country, team.country) && !blocked;
            return {
              teamId: team.id,
              teamName: team.name,
              blocked,
              mergeRecommended,
              reason: blocked
                ? "Bu eslesme manuel olarak engellenmis."
                : mergeRecommended
                  ? "Isim ve ulke sinyali birlesim icin uyumlu."
                  : "Ulke veya isim sinyali belirsiz; once manuel kontrol onerilir."
            };
          });

        return {
          normalizedName,
          riskLevel,
          reason,
          autoMerged,
          canonicalTeamId,
          canonicalTeamName: canonicalTeam.name,
          countrySet: displayCountries,
          blockedPairCount,
          teamIds: sorted.map((team) => team.id),
          variants: sorted.map((team) => ({
            id: team.id,
            name: team.name,
            shortName: team.shortName,
            country: team.country,
            dataSource: team.dataSource,
            totalMatches: team._count.homeMatches + team._count.awayMatches,
            providerMappings: team._count.providerMappings,
            isCanonical: team.id === canonicalTeamId
          })),
          actionCandidates
        };
      })
      .sort((left, right) => {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        const riskDelta = riskOrder[left.riskLevel] - riskOrder[right.riskLevel];
        if (riskDelta !== 0) {
          return riskDelta;
        }
        const sizeDelta = right.variants.length - left.variants.length;
        if (sizeDelta !== 0) {
          return sizeDelta;
        }
        return left.normalizedName.localeCompare(right.normalizedName);
      })
      .slice(0, limit);

    return {
      summary: {
        ...this.buildSummary(snapshot),
        issueGroups: issues.length
      },
      rules: snapshot.rules,
      issues
    };
  }

  async applyRuleAction(input: TeamIdentityRuleActionInput) {
    const snapshot = await this.getSnapshot();
    const teamIdSet = new Set(snapshot.teamsById.keys());
    const rules = this.normalizeRulesPayload(snapshot.rules);

    const action = String(input.action ?? "").trim() as TeamIdentityRuleActionInput["action"];
    if (!["merge_group", "unmerge_group", "block_pair", "unblock_pair"].includes(action)) {
      throw new BadRequestException("Gecersiz team identity aksiyonu.");
    }

    if (action === "merge_group") {
      const ids = this.normalizeTeamIds(input.teamIds).filter((teamId) => teamIdSet.has(teamId));
      if (ids.length < 2) {
        throw new BadRequestException("Birlestirme icin en az iki gecerli teamId gerekli.");
      }

      const mergeKey = ids.join(",");
      const existingKeys = new Set(rules.manualMergeGroups.map((group) => group.join(",")));
      if (!existingKeys.has(mergeKey)) {
        rules.manualMergeGroups.push(ids);
      }

      rules.manualBlockPairs = rules.manualBlockPairs.filter(
        (pair) => !(ids.includes(pair.leftTeamId) && ids.includes(pair.rightTeamId))
      );
    }

    if (action === "unmerge_group") {
      const ids = this.normalizeTeamIds(input.teamIds).filter((teamId) => teamIdSet.has(teamId));
      if (ids.length < 2) {
        throw new BadRequestException("Kural kaldirmak icin en az iki gecerli teamId gerekli.");
      }

      rules.manualMergeGroups = rules.manualMergeGroups.filter((group) => !ids.every((teamId) => group.includes(teamId)));
    }

    if (action === "block_pair" || action === "unblock_pair") {
      const leftTeamId = String(input.leftTeamId ?? "").trim();
      const rightTeamId = String(input.rightTeamId ?? "").trim();
      if (!this.isUuidLike(leftTeamId) || !this.isUuidLike(rightTeamId) || leftTeamId === rightTeamId) {
        throw new BadRequestException("Engelleme islemi icin iki farkli gecerli teamId gerekli.");
      }
      if (!teamIdSet.has(leftTeamId) || !teamIdSet.has(rightTeamId)) {
        throw new BadRequestException("Belirtilen teamId kayitlari bulunamadi.");
      }

      const [first, second] =
        leftTeamId.localeCompare(rightTeamId) <= 0 ? [leftTeamId, rightTeamId] : [rightTeamId, leftTeamId];

      if (action === "block_pair") {
        const pairKey = this.pairKey(first, second);
        const existing = new Set(rules.manualBlockPairs.map((pair) => this.pairKey(pair.leftTeamId, pair.rightTeamId)));
        if (!existing.has(pairKey)) {
          rules.manualBlockPairs.push({ leftTeamId: first, rightTeamId: second });
        }
        rules.manualMergeGroups = rules.manualMergeGroups.filter(
          (group) => !(group.includes(first) && group.includes(second))
        );
      } else {
        rules.manualBlockPairs = rules.manualBlockPairs.filter(
          (pair) => !(pair.leftTeamId === first && pair.rightTeamId === second)
        );
      }
    }

    await this.saveRules(rules);
    this.invalidateSnapshot();
    const refreshed = await this.getSnapshot(true);

    return {
      appliedAction: action,
      summary: this.buildSummary(refreshed),
      rules: refreshed.rules
    };
  }
}
