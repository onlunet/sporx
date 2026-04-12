import { z } from "zod";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function fetchWithSchema<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  const apiUrl = typeof window === "undefined" ? INTERNAL_API_URL : BROWSER_API_URL;
  const response = await fetch(`${apiUrl}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`API hatası ${response.status}`);
  }
  const json = await response.json();
  return schema.parse(json);
}

