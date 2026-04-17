import { ConflictResolutionService } from "./conflict-resolution.service";

describe("ConflictResolutionService", () => {
  it("resolves conflicting candidates consistently", async () => {
    const service = new ConflictResolutionService();
    const tx = {
      publishDecision: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "decision-1",
            market: "match_outcome",
            lineKey: "na",
            horizon: "PRE6",
            selection: "away",
            selectionScore: 0.66,
            status: "APPROVED"
          }
        ])
      }
    } as any;

    const input = {
      matchId: "match-1",
      market: "match_outcome",
      line: null,
      lineKey: "na",
      horizon: "PRE6",
      selection: "home",
      selectionScore: 0.62,
      profileMaxPicksPerMatch: 2,
      policyVersionId: "policy-v1"
    };

    const fetchRules = async () => [
      {
        maxPicksPerMatch: 1,
        allowMultiHorizon: false
      }
    ];

    const first = await service.resolve(tx, input, fetchRules);
    const second = await service.resolve(tx, input, fetchRules);

    expect(first).toEqual(second);
    expect(first.suppressed).toBe(true);
    expect(first.reasons.some((reason) => reason.code === "CONFLICTING_CANDIDATE")).toBe(true);
  });
});
