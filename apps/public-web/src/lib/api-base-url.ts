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

export function resolveBrowserApiBase(configuredApiUrl?: string) {
  if (typeof window === "undefined") {
    return normalizeConfiguredApiUrl(configuredApiUrl);
  }

  // Browser requests must always go through same-origin `/api/v1/*` proxy route.
  // This prevents mixed-content, TLS mismatch and cross-origin cookie issues.
  return "";
}

export function resolveServerApiBase(internalApiUrl?: string, apiUrl?: string, publicApiUrl?: string) {
  const selected = internalApiUrl ?? apiUrl ?? publicApiUrl ?? "http://localhost:4000";
  return normalizeConfiguredApiUrl(selected);
}
