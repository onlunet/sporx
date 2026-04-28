function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function trimApiPrefix(value: string) {
  if (value.endsWith("/api/v1")) {
    return value.slice(0, -"/api/v1".length);
  }
  return value;
}

function normalizeConfiguredApiUrl(configuredApiUrl?: string) {
  if (!configuredApiUrl) {
    return "";
  }
  const trimmed = configuredApiUrl.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return trimApiPrefix(trimTrailingSlash(trimmed));
}

function addUrlVariants(target: Set<string>, rawValue?: string) {
  const normalized = normalizeConfiguredApiUrl(rawValue);
  if (!normalized) {
    return;
  }

  if (normalized.startsWith("http://")) {
    target.add(normalized);
    target.add(`https://${normalized.slice("http://".length)}`);
    return;
  }

  if (normalized.startsWith("https://")) {
    target.add(normalized);
    target.add(`http://${normalized.slice("https://".length)}`);
    return;
  }

  target.add(normalized);
}

function deriveSslipApiFallbacks(rawValue?: string) {
  if (!rawValue) {
    return [];
  }

  const match = rawValue.match(/(\d+\.\d+\.\d+\.\d+)\.sslip\.io/i);
  if (!match) {
    return [];
  }

  const ip = match[1];
  return [`http://${ip}:8000`, `https://${ip}:8000`];
}

export function resolveBrowserApiBase(configuredApiUrl?: string) {
  if (typeof window === "undefined") {
    return normalizeConfiguredApiUrl(configuredApiUrl);
  }

  // Browser requests must always go through same-origin `/api/v1/*` proxy route.
  // This prevents mixed-content, TLS mismatch and cross-origin cookie issues.
  return "";
}

export function resolveServerApiBases(
  internalApiUrl?: string,
  apiUrl?: string,
  publicApiUrl?: string,
  publicWebUrl?: string
) {
  const candidates = new Set<string>();
  const rawCandidates = [internalApiUrl, apiUrl, publicApiUrl, publicWebUrl];

  for (const raw of rawCandidates) {
    addUrlVariants(candidates, raw);
    for (const fallback of deriveSslipApiFallbacks(raw)) {
      addUrlVariants(candidates, fallback);
    }
  }

  addUrlVariants(candidates, "http://localhost:4000");
  return Array.from(candidates);
}

export function resolveServerApiBase(
  internalApiUrl?: string,
  apiUrl?: string,
  publicApiUrl?: string,
  publicWebUrl?: string
) {
  return resolveServerApiBases(internalApiUrl, apiUrl, publicApiUrl, publicWebUrl)[0] ?? "http://localhost:4000";
}
