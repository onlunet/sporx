import { cookies } from "next/headers";
import { fetchInternalApi } from "../../../src/server/internal-api";

type Envelope<T> = {
  success: boolean;
  data: T;
  meta: unknown;
  error: unknown;
};

export type AdminApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

const COMPLIANCE_BASE_PATH = "/api/v1/admin/security/compliance";
const SECURITY_PHASE4_BASE_PATH = "/api/v1/admin/security/phase4";

export const adminSecurityComplianceEndpoints = {
  dataClassifications: `${COMPLIANCE_BASE_PATH}/classifications`,
  retentionPolicies: `${COMPLIANCE_BASE_PATH}/retention-policies`,
  deletionRequests: `${COMPLIANCE_BASE_PATH}/deletion-requests`,
  privacyExportJobs: `${COMPLIANCE_BASE_PATH}/privacy-export-jobs`,
  dataAccessRequests: `${COMPLIANCE_BASE_PATH}/data-access-requests`,
  cleanupDryRunReports: `${COMPLIANCE_BASE_PATH}/retention/cleanup/dry-run`,
  legalHoldIndicators: `${COMPLIANCE_BASE_PATH}/legal-hold`,
  supplyChainGovernanceHistory: `${COMPLIANCE_BASE_PATH}/supply-chain-history`,
  complianceActionAudit: `${COMPLIANCE_BASE_PATH}/action-audit`
} as const;

export const adminSecurityPhase4Endpoints = {
  vulnerabilities: `${SECURITY_PHASE4_BASE_PATH}/vulnerabilities`,
  releaseAttestations: `${SECURITY_PHASE4_BASE_PATH}/release-attestations`
} as const;

function toErrorMessage(status: number, payload: unknown) {
  const fromPayload =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
      ? ((payload as { error: string }).error as string)
      : null;

  if (fromPayload) {
    return fromPayload;
  }

  if (status === 401 || status === 403) {
    return "Oturum doğrulanamadı. Lütfen yeniden giriş yapın.";
  }

  return `API isteği başarısız (${status})`;
}

export async function adminApiGet<T>(path: string): Promise<AdminApiResult<T>> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("admin_access_token")?.value;

  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: "Yönetim oturumu bulunamadı."
    };
  }

  let response: Response;
  try {
    response = await fetchInternalApi(
      path,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        cache: "no-store"
      },
      {
        allowPublicProxyFallback: true,
        fallbackOnStatusCodes: [403, 404]
      }
    );
  } catch {
    return {
      ok: false,
      status: 503,
      data: null,
      error: "Admin API servisine ulaşılamadı. Lütfen bağlantıyı ve servis durumunu kontrol edin."
    };
  }

  let payload: Envelope<T> | Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Envelope<T> | Record<string, unknown>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: toErrorMessage(response.status, payload)
    };
  }

  if (!payload || typeof payload !== "object" || !("success" in payload)) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: "Beklenen API yanıtı alınamadı."
    };
  }

  const envelope = payload as Envelope<T>;
  if (!envelope.success) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: toErrorMessage(response.status, envelope)
    };
  }

  return {
    ok: true,
    status: response.status,
    data: envelope.data,
    error: null
  };
}

export async function adminApiPost<T>(path: string, body: Record<string, unknown>): Promise<AdminApiResult<T>> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("admin_access_token")?.value;

  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: "Yönetim oturumu bulunamadı."
    };
  }

  let response: Response;
  try {
    response = await fetchInternalApi(
      path,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        cache: "no-store"
      },
      {
        allowPublicProxyFallback: true,
        fallbackOnStatusCodes: [403, 404]
      }
    );
  } catch {
    return {
      ok: false,
      status: 503,
      data: null,
      error: "Admin API servisine ulaşılamadı. Lütfen bağlantıyı ve servis durumunu kontrol edin."
    };
  }

  let payload: Envelope<T> | Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Envelope<T> | Record<string, unknown>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: toErrorMessage(response.status, payload)
    };
  }

  if (!payload || typeof payload !== "object" || !("success" in payload)) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: "Beklenen API yanıtı alınamadı."
    };
  }

  const envelope = payload as Envelope<T>;
  if (!envelope.success) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: toErrorMessage(response.status, envelope)
    };
  }

  return {
    ok: true,
    status: response.status,
    data: envelope.data,
    error: null
  };
}

export function getComplianceDataClassifications() {
  return adminApiGet<unknown[]>(adminSecurityComplianceEndpoints.dataClassifications);
}

export function getComplianceRetentionPolicies() {
  return adminApiGet<unknown[]>(adminSecurityComplianceEndpoints.retentionPolicies);
}

export function getComplianceDeletionRequests() {
  return adminApiGet<unknown>(adminSecurityComplianceEndpoints.deletionRequests);
}

export function getCompliancePrivacyExportJobs() {
  return adminApiGet<unknown>(adminSecurityComplianceEndpoints.privacyExportJobs);
}

export function getComplianceCleanupDryRunReports() {
  return adminApiPost<unknown>(adminSecurityComplianceEndpoints.cleanupDryRunReports, {});
}

export function getComplianceLegalHoldIndicators() {
  return adminApiGet<unknown>(adminSecurityComplianceEndpoints.legalHoldIndicators);
}

export function getComplianceSupplyChainGovernanceHistory() {
  return adminApiGet<unknown>(adminSecurityComplianceEndpoints.supplyChainGovernanceHistory);
}

export function getComplianceActionAudit() {
  return adminApiGet<unknown[]>(adminSecurityComplianceEndpoints.complianceActionAudit);
}

export function getPhase4Vulnerabilities() {
  return adminApiGet<unknown[]>(adminSecurityPhase4Endpoints.vulnerabilities);
}

export function getPhase4ReleaseAttestations() {
  return adminApiGet<unknown[]>(adminSecurityPhase4Endpoints.releaseAttestations);
}
