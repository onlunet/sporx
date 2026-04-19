const FALLBACK_STATUS_CODES = new Set([500, 502, 503, 504]);
const API_PREFIX = "/api/v1";
const PREFERRED_BASE_TTL_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 20_000;

let preferredBaseUrl: string | null = null;
let preferredBaseUntil = 0;

export function resetInternalApiCacheForTests() {
  preferredBaseUrl = null;
  preferredBaseUntil = 0;
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function addCandidate(unique: Set<string>, rawValue: string) {
  const normalized = trimTrailingSlash(rawValue.trim());
  if (!normalized) {
    return;
  }

  if (normalized.startsWith("http://")) {
    unique.add(`https://${normalized.slice("http://".length)}`);
    unique.add(normalized);
    return;
  }

  if (normalized.startsWith("https://")) {
    unique.add(normalized);
    unique.add(`http://${normalized.slice("https://".length)}`);
    return;
  }

  unique.add(normalized);
}

function parseCsvCandidates(raw?: string) {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildBaseCandidates(allowPublicProxyFallback: boolean) {
  const rawCandidates = [
    process.env.ADMIN_API_URL,
    process.env.INTERNAL_API_SERVICE_URL,
    process.env.INTERNAL_API_URL,
    process.env.API_URL,
    process.env.NEXT_PUBLIC_API_URL,
    ...parseCsvCandidates(process.env.INTERNAL_API_FALLBACK_URLS),
    allowPublicProxyFallback ? process.env.PUBLIC_WEB_URL : undefined,
    "http://api:4000",
    "http://sporx-api:4000",
    "http://backend:4000",
    "http://localhost:4000"
  ];

  const unique = new Set<string>();
  for (const candidate of rawCandidates) {
    if (!candidate) {
      continue;
    }
    addCandidate(unique, candidate);
  }

  const allCandidates = Array.from(unique);
  const now = Date.now();
  if (!preferredBaseUrl || preferredBaseUntil < now || !allCandidates.includes(preferredBaseUrl)) {
    return allCandidates;
  }

  return [preferredBaseUrl, ...allCandidates.filter((entry) => entry !== preferredBaseUrl)];
}

function buildTargetUrl(baseUrl: string, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (baseUrl.endsWith(API_PREFIX) && normalizedPath.startsWith(API_PREFIX)) {
    return `${baseUrl}${normalizedPath.slice(API_PREFIX.length)}`;
  }
  return `${baseUrl}${normalizedPath}`;
}

function withTimeout(init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    init: {
      ...init,
      signal: controller.signal
    },
    cancel: () => clearTimeout(timer)
  };
}

function rememberHealthyBase(baseUrl: string) {
  preferredBaseUrl = baseUrl;
  preferredBaseUntil = Date.now() + PREFERRED_BASE_TTL_MS;
}

export async function fetchInternalApi(
  path: string,
  init: RequestInit,
  options?: {
    allowPublicProxyFallback?: boolean;
    timeoutMs?: number;
  }
) {
  const allowPublicProxyFallback = options?.allowPublicProxyFallback ?? false;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const candidates = buildBaseCandidates(allowPublicProxyFallback);
  const hasCandidates = candidates.length > 0;
  if (!hasCandidates) {
    throw new Error("No internal API base URL candidates configured.");
  }

  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const baseUrl = candidates[index] as string;
    const targetUrl = buildTargetUrl(baseUrl, path);
    const { init: timedInit, cancel } = withTimeout(init, timeoutMs);

    try {
      const response = await fetch(targetUrl, timedInit);
      const hasNextCandidate = index < candidates.length - 1;
      if (FALLBACK_STATUS_CODES.has(response.status) && hasNextCandidate) {
        lastResponse = response;
        continue;
      }

      if (response.status < 500) {
        rememberHealthyBase(baseUrl);
      }
      return response;
    } catch (error) {
      lastError = error;
    } finally {
      cancel();
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw (lastError instanceof Error ? lastError : new Error("Internal API unreachable"));
}
