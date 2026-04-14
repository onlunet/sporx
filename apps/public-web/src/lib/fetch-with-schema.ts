import { z } from "zod";
import { resolveBrowserApiBase, resolveServerApiBase } from "./api-base-url";

const INTERNAL_API_URL = resolveServerApiBase(
  process.env.INTERNAL_API_URL,
  process.env.API_URL,
  process.env.NEXT_PUBLIC_API_URL
);
const BROWSER_API_URL = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);

export async function fetchWithSchema<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  const apiUrl = typeof window === "undefined" ? INTERNAL_API_URL : BROWSER_API_URL;
  const response = await fetch(`${apiUrl}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`API hatasi ${response.status}`);
  }
  const json = await response.json();
  return schema.parse(json);
}