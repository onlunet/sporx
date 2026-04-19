import { AdminEndpointPage } from "../_components/admin-endpoint-page";
import { adminApiGet } from "../_lib/admin-api";

type ModelInventoryRow = {
  id: string;
  modelVersionId: string | null;
  modelName: string;
  version: string;
  modelLabel: string;
  active: boolean;
  usageStatus: string;
  predictionCount: number;
  trainingWindow: string;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  lastMeasuredAt: string | null;
  comparisonCount: number;
  source: string;
  createdAt: string;
};

function normalizeComparisonFallbackRows(rows: Array<Record<string, unknown>>): ModelInventoryRow[] {
  const seen = new Set<string>();
  const normalized: ModelInventoryRow[] = [];

  for (const row of rows) {
    const modelLabel = typeof row.modelLabel === "string" ? row.modelLabel : null;
    const modelName = typeof row.modelName === "string" ? row.modelName : null;
    const version = typeof row.version === "string" ? row.version : null;
    if (!modelLabel || !modelName || !version) {
      continue;
    }
    if (seen.has(modelLabel)) {
      continue;
    }
    seen.add(modelLabel);

    normalized.push({
      id: `comparison-${modelLabel}`,
      modelVersionId: typeof row.modelVersionId === "string" ? row.modelVersionId : null,
      modelName,
      version,
      modelLabel,
      active: Boolean(row.active),
      usageStatus: "Karşılaştırma Kaydından",
      predictionCount: 0,
      trainingWindow: "-",
      accuracy: null,
      brier: null,
      logLoss: null,
      lastMeasuredAt: null,
      comparisonCount: 1,
      source: "comparison_fallback",
      createdAt: new Date().toISOString()
    });
  }

  return normalized;
}

export default async function Page() {
  const inventoryResult = await adminApiGet<Record<string, unknown>[]>("/api/v1/admin/models");
  let resolvedResult = inventoryResult;
  const inventoryRows = Array.isArray(inventoryResult.data) ? inventoryResult.data : [];

  if (!inventoryResult.ok || inventoryRows.length === 0) {
    const comparisonResult = await adminApiGet<Record<string, unknown>[]>("/api/v1/admin/models/comparison");
    if (comparisonResult.ok && Array.isArray(comparisonResult.data) && comparisonResult.data.length > 0) {
      resolvedResult = {
        ok: true,
        status: 200,
        data: normalizeComparisonFallbackRows(comparisonResult.data),
        error: null
      };
    }
  }

  return (
    <AdminEndpointPage
      title="Modeller"
      subtitle="Model envanteri ve kullanım durumu"
      endpoint="/api/v1/admin/models"
      result={resolvedResult}
      emptyText="Model kaydı bulunamadı."
      insight="Bu ekran tahmin üretiminde kullanılan tüm model sürümlerini, kullanım sayısını ve performans metriklerini tek tabloda gösterir."
      columns={[
        { key: "modelLabel", label: "Model" },
        { key: "active", label: "Aktif" },
        { key: "usageStatus", label: "Kullanım" },
        { key: "predictionCount", label: "Tahmin Sayısı" },
        { key: "trainingWindow", label: "Eğitim Aralığı" },
        { key: "accuracy", label: "Doğruluk" },
        { key: "brier", label: "Brier" },
        { key: "logLoss", label: "LogLoss" },
        { key: "lastMeasuredAt", label: "Son Ölçüm" },
        { key: "comparisonCount", label: "Karşılaştırma Kayıt" },
        { key: "source", label: "Kayıt Türü" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
