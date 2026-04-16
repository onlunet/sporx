import { z } from "zod";
import { resolveBrowserApiBase, resolveServerApiBase } from "./api-base-url";

const INTERNAL_API_URL = resolveServerApiBase(
  process.env.INTERNAL_API_URL,
  process.env.API_URL,
  process.env.NEXT_PUBLIC_API_URL
);
const BROWSER_API_URL = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);

type FetchWithSchemaOptions = {
  cache?: RequestCache;
  revalidate?: number;
};

export async function fetchWithSchema<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  options?: FetchWithSchemaOptions
): Promise<z.infer<TSchema>> {
  const isServer = typeof window === "undefined";
  const apiUrl = isServer ? INTERNAL_API_URL : BROWSER_API_URL;
  const requestInit: RequestInit & { next?: { revalidate: number } } = {};

  if (isServer) {
    requestInit.cache = options?.cache ?? "force-cache";
    requestInit.next = { revalidate: options?.revalidate ?? 30 };
  } else {
    requestInit.cache = options?.cache ?? "no-store";
  }

  const response = await fetch(`${apiUrl}${path}`, requestInit);
  if (!response.ok) {
    throw new Error(`API hatasi ${response.status}`);
  }
  const json = await response.json();
  return schema.parse(json);
}
