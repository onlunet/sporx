function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolveBrowserApiBase(configuredApiUrl?: string) {
  const normalized = configuredApiUrl ? trimTrailingSlash(configuredApiUrl) : "";

  if (typeof window === "undefined") {
    return normalized;
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
  return trimTrailingSlash(selected);
}
