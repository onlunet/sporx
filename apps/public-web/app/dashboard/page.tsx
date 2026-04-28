import { publicContract } from "@sporx/api-contract";
import { DashboardExperience } from "../../src/components/dashboard";
import { fetchWithSchema } from "../../src/lib/fetch-with-schema";

export const dynamic = "force-dynamic";

const EMPTY_DASHBOARD = {
  matchCount: 0,
  predictionCount: 0,
  lowConfidenceCount: 0,
  failedCount: 0,
  generatedAt: new Date().toISOString()
};

export default async function DashboardPage() {
  const [dashboardResult, predictionsResult, matchesResult] = await Promise.allSettled([
    fetchWithSchema("/api/v1/analytics/dashboard", publicContract.dashboardResponseSchema, {
      cache: "no-store"
    }),
    fetchWithSchema("/api/v1/predictions?status=scheduled,live,finished&take=220", publicContract.predictionsResponseSchema, {
      cache: "no-store"
    }),
    fetchWithSchema("/api/v1/matches?take=80", publicContract.matchesResponseSchema, {
      cache: "no-store"
    })
  ]);

  return (
    <DashboardExperience
      initialDashboard={dashboardResult.status === "fulfilled" ? dashboardResult.value.data : EMPTY_DASHBOARD}
      initialDashboardUnavailable={dashboardResult.status !== "fulfilled"}
      initialPredictions={predictionsResult.status === "fulfilled" ? predictionsResult.value.data : []}
      initialMatches={matchesResult.status === "fulfilled" ? matchesResult.value.data : []}
    />
  );
}
