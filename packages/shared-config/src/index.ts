import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  SENTRY_DSN: z.string().optional().default(""),
  PROMETHEUS_ENABLED: z.coerce.boolean().default(true),
  BACKUP_MODE: z.enum(["disabled", "readonly"]).default("disabled"),
  BACKUP_READ_URL: z.string().optional().default(""),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional().default(""),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional().default(""),
  SUPABASE_ANON_KEY: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  SUPABASE_DB_POOLER_URL: z.string().optional().default(""),
  SUPABASE_DB_DIRECT_URL: z.string().optional().default(""),
  FOOTBALL_DATA_API_KEY: z.string().optional().default(""),
  SERVICE_ROLE: z.enum(["api", "worker"]).default("api"),
  API_URL: z.string().default("http://localhost:4000"),
  PUBLIC_WEB_URL: z.string().default("http://localhost:3000"),
  ADMIN_WEB_URL: z.string().default("http://localhost:3100")
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  return envSchema.parse(source);
}
