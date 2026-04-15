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
  const normalized = normalizeConfiguredApiUrl(configuredApiUrl);

  if (typeof window === "undefined") {
    return normalized;
  }

  if (normalized.length === 0) {
    return "";
  }

  const hasHttpProtocol = normalized.startsWith("http://") || normalized.startsWith("https://");
  if (!hasHttpProtocol) {
    return "";
  }

  // When public app runs on HTTPS, never call plain HTTP API from the browser.
  // Fall back to same-origin `/api/v1/*` rewrite handled by Next.js.
  if (window.location.protocol === "https:" && normalized.startsWith("http://")) {
    return "";
  }

  return normalized;
}

export function resolveServerApiBase(internalApiUrl?: string, apiUrl?: string, publicApiUrl?: string) {
  const selected = internalApiUrl ?? apiUrl ?? publicApiUrl ?? "http://localhost:4000";
  return normalizeConfiguredApiUrl(selected);
}
