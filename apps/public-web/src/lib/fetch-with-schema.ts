import { z } from "zod";
import { resolveBrowserApiBase, resolveServerApiBases } from "./api-base-url";

const INTERNAL_API_URLS = resolveServerApiBases(
  process.env.INTERNAL_API_URL,
  process.env.API_URL,
  process.env.NEXT_PUBLIC_API_URL,
  process.env.PUBLIC_WEB_URL
);
const BROWSER_API_URL = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);

type FetchWithSchemaOptions = {
  cache?: RequestCache;
  revalidate?: number;
  timeoutMs?: number;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithSchema<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  options?: FetchWithSchemaOptions
): Promise<z.infer<TSchema>> {
  const isServer = typeof window === "undefined";
  const requestInit: RequestInit & { next?: { revalidate: number } } = {};
  const timeoutMs = options?.timeoutMs ?? (isServer ? 5_000 : 12_000);

  if (isServer) {
    requestInit.cache = options?.cache ?? "force-cache";
    requestInit.next = { revalidate: options?.revalidate ?? 30 };
  } else {
    requestInit.cache = options?.cache ?? "no-store";
  }

  if (isServer) {
    let lastError: Error | null = null;

    for (const apiUrl of INTERNAL_API_URLS) {
      try {
        const response = await fetchWithTimeout(`${apiUrl}${path}`, requestInit, timeoutMs);
        if (!response.ok) {
          const shouldFailOver = response.status >= 500 || response.status === 404;
          if (shouldFailOver) {
            lastError = new Error(`API hatasi ${response.status}`);
            continue;
          }
          throw new Error(`API hatasi ${response.status}`);
        }

        const json = await response.json();
        return schema.parse(json);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("API ulasilamadi");
      }
    }

    throw lastError ?? new Error("API ulasilamadi");
  }

  const response = await fetchWithTimeout(`${BROWSER_API_URL}${path}`, requestInit, timeoutMs);
  if (!response.ok) {
    throw new Error(`API hatasi ${response.status}`);
  }

  const json = await response.json();
  return schema.parse(json);
}
