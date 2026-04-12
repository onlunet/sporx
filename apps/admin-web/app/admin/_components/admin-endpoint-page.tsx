import { MetricChip, SectionCard } from "@sporx/ui";
import { adminApiGet } from "../_lib/admin-api";

type TableColumn = {
  key: string;
  label: string;
};

type AdminEndpointPageProps = {
  title: string;
  subtitle?: string;
  endpoint: string;
  emptyText?: string;
  columns?: TableColumn[];
  insight?: string;
};

type DistributionItem = {
  label: string;
  count: number;
};

const LABEL_TRANSLATIONS: Record<string, string> = {
  id: "Kayıt No",
  predictionid: "Tahmin Ref.",
  issuecategory: "Sorun Tipi",
  actionitems: "Önerilen Aksiyon",
  analysis: "Analiz",
  createdat: "Oluşturulma",
  updatedat: "Güncelleme",
  measuredat: "Ölçüm Zamanı",
  rootcause: "Kök Neden",
  impact: "Etki",
  key: "Parametre",
  value: "Değer",
  lineupsensitivity: "Kadro Hassasiyeti"
};

const VALUE_TRANSLATIONS: Record<string, string> = {
  lineup_shock: "Beklenmeyen kadro değişimi",
  home_win_probability_overestimated: "Ev sahibi kazanma olasılığı gereğinden yüksek tahmin edilmiş",
  "unexpected lineup rotation before kickoff.": "Maç öncesi beklenmeyen ilk 11 rotasyonu yaşandı.",
  increase: "Artır",
  decrease: "Azalt",
  lineupsensitivity: "Kadro hassasiyeti"
};

function canonicalToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function shortUuid(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function normalizeLabel(key: string): string {
  const translated = LABEL_TRANSLATIONS[canonicalToken(key)];
  if (translated) {
    return translated;
  }
  return humanizeToken(key);
}

function maybeTranslateString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "-";
  }

  const direct = VALUE_TRANSLATIONS[trimmed] ?? VALUE_TRANSLATIONS[trimmed.toLowerCase()] ?? VALUE_TRANSLATIONS[canonicalToken(trimmed)];
  if (direct) {
    return direct;
  }

  const looksTechnical =
    /^[a-zA-Z0-9_\-.\s]+$/.test(trimmed) &&
    (trimmed.includes("_") || /[a-z][A-Z]/.test(trimmed) || /^[a-z0-9\-_]+$/i.test(trimmed));

  if (looksTechnical && !trimmed.includes("://") && !trimmed.includes("@")) {
    return humanizeToken(trimmed);
  }

  return trimmed;
}

function valueByPath(row: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let cursor: unknown = row;

  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || !(part in (cursor as Record<string, unknown>))) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "Evet" : "Hayır";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "-";
  }
  if (typeof value === "string") {
    return maybeTranslateString(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[object]";
  }
}

function formatPrimitive(value: unknown, fieldKey?: string): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "Evet" : "Hayır";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "-";
  }
  if (typeof value === "string") {
    if (fieldKey && fieldKey.toLowerCase().endsWith("id") && isUuidLike(value)) {
      return shortUuid(value);
    }
    return maybeTranslateString(value);
  }
  return formatValue(value);
}

function tryParseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function renderPrimitivePill(value: unknown, key?: string) {
  return (
    <span
      key={key ?? String(value)}
      className="inline-flex max-w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-xs text-slate-200"
      title={formatPrimitive(value)}
    >
      <span className="truncate">{formatPrimitive(value)}</span>
    </span>
  );
}

function renderObjectSummary(value: Record<string, unknown>) {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <span className="text-xs text-slate-400">Boş obje</span>;
  }

  const preview = entries.slice(0, 4);
  return (
    <div className="space-y-1">
      {preview.map(([key, entryValue]) => (
        <div key={key} className="rounded border border-slate-700 bg-slate-950/40 px-2 py-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">{normalizeLabel(key)}</p>
          <div className="text-xs text-slate-100">{renderStructuredValue(entryValue, key)}</div>
        </div>
      ))}
      {entries.length > preview.length ? (
        <p className="text-[11px] text-slate-400">+{entries.length - preview.length} alan daha</p>
      ) : null}
    </div>
  );
}

function renderArraySummary(value: unknown[]) {
  if (value.length === 0) {
    return <span className="text-xs text-slate-400">Boş liste</span>;
  }

  const primitiveItems = value.filter((item) => !isPlainObject(item) && !Array.isArray(item));
  if (primitiveItems.length === value.length) {
    const preview = primitiveItems.slice(0, 4);
    return (
      <div className="flex flex-wrap gap-1">
        {preview.map((item, index) => renderPrimitivePill(item, `${index}-${formatPrimitive(item)}`))}
        {value.length > preview.length ? (
          <span className="text-[11px] text-slate-400">+{value.length - preview.length}</span>
        ) : null}
      </div>
    );
  }

  const firstObject = value.find((item) => isPlainObject(item));
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-300">{value.length} kayıt</p>
      {isPlainObject(firstObject) ? renderObjectSummary(firstObject) : null}
    </div>
  );
}

function renderStructuredValue(rawValue: unknown, fieldKey?: string) {
  const value = typeof rawValue === "string" ? tryParseJsonString(rawValue) : rawValue;

  if (isPlainObject(value)) {
    return renderObjectSummary(value);
  }

  if (Array.isArray(value)) {
    return renderArraySummary(value);
  }

  const display = formatPrimitive(value, fieldKey);
  const title = typeof rawValue === "string" ? maybeTranslateString(rawValue) : display;

  return (
    <span className="block truncate text-sm text-slate-100" title={title}>
      {display}
    </span>
  );
}

function resolveStatusTone(value: unknown): "ok" | "warn" | "error" | "neutral" {
  if (typeof value === "boolean") {
    return value ? "ok" : "error";
  }
  if (typeof value !== "string") {
    return "neutral";
  }

  const token = value.toLowerCase();
  if (["ok", "healthy", "active", "success", "completed", "ready", "up"].some((x) => token.includes(x))) {
    return "ok";
  }
  if (["warn", "warning", "pending", "degraded", "partial", "retry"].some((x) => token.includes(x))) {
    return "warn";
  }
  if (["error", "failed", "down", "inactive", "critical", "timeout"].some((x) => token.includes(x))) {
    return "error";
  }
  return "neutral";
}

function toneClass(tone: "ok" | "warn" | "error" | "neutral"): string {
  if (tone === "ok") {
    return "border-emerald-700/70 bg-emerald-950/50 text-emerald-200";
  }
  if (tone === "warn") {
    return "border-amber-700/70 bg-amber-950/50 text-amber-200";
  }
  if (tone === "error") {
    return "border-red-700/70 bg-red-950/50 text-red-200";
  }
  return "border-slate-700 bg-slate-900/60 text-slate-200";
}

function renderObjectCard(data: Record<string, unknown>) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-sm text-slate-300">Gösterilecek veri yok.</p>;
  }

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MetricChip label="Alan Sayısı" value={entries.length} />
        <MetricChip
          label="Boş Olmayan"
          value={entries.filter(([, value]) => value !== null && value !== undefined && value !== "").length}
        />
        <MetricChip label="Veri Tipi" value="Obje" />
      </div>

      <dl className="grid gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-md border border-slate-700 bg-slate-950/40 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-400">{normalizeLabel(key)}</dt>
            <dd className="mt-1 text-sm text-slate-100">{renderStructuredValue(value, key)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function pickStatusField(data: Array<Record<string, unknown>>, columns?: TableColumn[]): string | null {
  const candidates = [
    ...(columns?.map((c) => c.key) ?? []),
    "status",
    "health",
    "state",
    "result",
    "providerStatus",
    "isActive",
    "active",
    "success"
  ];

  const sample = data[0] ?? {};
  for (const key of candidates) {
    const value = valueByPath(sample, key);
    if (value !== null && value !== undefined) {
      return key;
    }
  }

  return null;
}

function buildDistribution(
  data: Array<Record<string, unknown>>,
  columns?: TableColumn[]
): { field: string; items: DistributionItem[] } | null {
  const candidates = [
    ...(columns?.map((c) => c.key) ?? []),
    "providerCode",
    "jobName",
    "status",
    "state",
    "sport",
    "league",
    "source",
    "level"
  ];

  for (const key of candidates) {
    const counter = new Map<string, number>();
    let validCount = 0;

    for (const row of data) {
      const value = valueByPath(row, key);
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        continue;
      }

      const label = formatValue(value);
      counter.set(label, (counter.get(label) ?? 0) + 1);
      validCount += 1;
    }

    if (validCount === 0 || counter.size < 2 || counter.size > 8) {
      continue;
    }

    const items = Array.from(counter.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    return { field: key, items };
  }

  return null;
}

function inferInsight(endpoint: string): string {
  if (endpoint.includes("/models/feature-importance")) {
    return "Modeli en çok etkileyen özellikleri ve önem dağılımını izleyin. Ani değişimler feature drift sinyali olabilir.";
  }
  if (endpoint.includes("/models/comparison")) {
    return "Model sürümlerini doğruluk, kalibrasyon ve güven skoruna göre karşılaştırın. Kötüleşen sürümleri hızla ayıklayın.";
  }
  if (endpoint.includes("/predictions/failed")) {
    return "Başarısız tahminlerde asıl amaç sebebi hızlı anlamaktır. Bu yüzden teknik kodlar anlaşılır Türkçe karşılıklarla gösterilir.";
  }
  if (endpoint.includes("/system/settings")) {
    return "Sistem parametreleri burada merkezi olarak tutulur. Kritik ayarlarda değişiklikten önce etki alanını doğrulayın.";
  }
  if (endpoint.includes("/ingestion/jobs")) {
    return "Ingestion işlerinin güncel durumunu ve olası darboğazları takip edin. Sürekli hatalar provider veya mapping sorununa işaret eder.";
  }
  if (endpoint.includes("/logs/api")) {
    return "API çağrılarında hata oranı ve kaynak dağılımını izleyin. Tekrarlayan 4xx/5xx kayıtları entegrasyon aksiyonlarını önceliklendirir.";
  }
  return "Bu ekran operasyonel veriyi özetleyip ham kayıtlarla birlikte sunar. Üstteki göstergeler hızlı karar, alttaki tablo detay inceleme içindir.";
}

function renderDistribution(distribution: { field: string; items: DistributionItem[] }) {
  const max = Math.max(...distribution.items.map((x) => x.count), 1);

  return (
    <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-400">Dağılım: {normalizeLabel(distribution.field)}</p>
      <div className="mt-3 space-y-2">
        {distribution.items.map((item) => (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="truncate">{item.label}</span>
              <span>{item.count}</span>
            </div>
            <div className="h-2 w-full rounded bg-slate-800">
              <div className="h-2 rounded bg-cyan-500/80" style={{ width: `${Math.max((item.count / max) * 100, 6)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getDefaultColumns(row: Record<string, unknown>): TableColumn[] {
  return Object.keys(row)
    .filter((key) => key.toLowerCase() !== "id")
    .slice(0, 8)
    .map((key) => ({ key, label: normalizeLabel(key) }));
}

function renderTable(data: Array<Record<string, unknown>>, columns?: TableColumn[], statusField?: string | null) {
  if (data.length === 0) {
    return null;
  }

  const resolvedColumns: TableColumn[] = columns && columns.length > 0 ? columns : getDefaultColumns(data[0]);

  return (
    <div className="overflow-x-auto rounded-md border border-slate-700">
      <table className="min-w-full divide-y divide-slate-700 text-sm">
        <thead className="bg-slate-950/70">
          <tr>
            {resolvedColumns.map((column) => (
              <th key={column.key} className="px-3 py-2 text-left font-medium text-slate-300">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {data.map((row, rowIndex) => (
            <tr key={String(valueByPath(row, "id") ?? rowIndex)} className="bg-slate-900/30">
              {resolvedColumns.map((column) => {
                const value = valueByPath(row, column.key);
                const isStatus = statusField && column.key === statusField;

                return (
                  <td key={`${rowIndex}-${column.key}`} className="max-w-[360px] px-3 py-2 align-top text-slate-100">
                    {isStatus ? (
                      <span
                        className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${toneClass(
                          resolveStatusTone(value)
                        )}`}
                      >
                        {formatValue(value)}
                      </span>
                    ) : (
                      renderStructuredValue(value, column.key)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function AdminEndpointPage({
  title,
  subtitle,
  endpoint,
  emptyText,
  columns,
  insight
}: AdminEndpointPageProps) {
  const result = await adminApiGet<unknown>(endpoint);
  const tableData = result.ok && Array.isArray(result.data) ? (result.data as Array<Record<string, unknown>>) : null;
  const objectData =
    result.ok && result.data && !Array.isArray(result.data) && typeof result.data === "object"
      ? (result.data as Record<string, unknown>)
      : null;

  const statusField = tableData ? pickStatusField(tableData, columns) : null;
  const distribution = tableData ? buildDistribution(tableData, columns) : null;

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="mb-4 rounded-md border border-cyan-900/50 bg-cyan-950/30 p-3 text-sm text-cyan-100">
        {insight ?? inferInsight(endpoint)}
      </div>

      {!result.ok ? (
        <p className="rounded-md border border-red-900/70 bg-red-950/40 p-3 text-sm text-red-200">{result.error}</p>
      ) : null}

      {tableData && tableData.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricChip label="Toplam Kayıt" value={tableData.length} />
          <MetricChip
            label="Kolon Sayısı"
            value={columns?.length ?? Object.keys(tableData[0] ?? {}).filter((key) => key.toLowerCase() !== "id").length}
          />
          <MetricChip label="Durum Alanı" value={statusField ? normalizeLabel(statusField) : "Yok"} />
          <MetricChip
            label="Son Güncelleme"
            value={
              formatValue(
                valueByPath(tableData[0] ?? {}, "updatedAt") ??
                  valueByPath(tableData[0] ?? {}, "createdAt") ??
                  valueByPath(tableData[0] ?? {}, "importedAt") ??
                  "Bilinmiyor"
              )
            }
          />
        </div>
      ) : null}

      {distribution ? <div className="mb-4">{renderDistribution(distribution)}</div> : null}

      {result.ok && tableData && tableData.length === 0 ? (
        <p className="text-sm text-slate-300">{emptyText ?? "Kayıt bulunamadı."}</p>
      ) : null}

      {tableData ? renderTable(tableData, columns, statusField) : null}

      {objectData ? renderObjectCard(objectData) : null}
    </SectionCard>
  );
}
