const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const directUrl = process.env.SUPABASE_DB_DIRECT_URL?.trim() ?? "";
const env = { ...process.env };

function buildSupabaseDirectUrlFromPooler(urlString) {
  try {
    const parsed = new URL(urlString);
    const isSupabasePooler = /(?:^|\.)(pooler\.supabase\.com)$/i.test(parsed.hostname);
    if (!isSupabasePooler) {
      return null;
    }

    const username = decodeURIComponent(parsed.username || "");
    const [, projectRef] = username.split(".");
    if (!projectRef) {
      return null;
    }

    parsed.hostname = `db.${projectRef}.supabase.co`;
    parsed.port = "5432";
    parsed.searchParams.delete("pgbouncer");
    if (!parsed.searchParams.has("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

if (directUrl) {
  env.DATABASE_URL = directUrl;
  console.log("[prisma:migrate:deploy:safe] SUPABASE_DB_DIRECT_URL kullanilarak migration calistirilacak.");
} else {
  const derivedDirectUrl = buildSupabaseDirectUrlFromPooler(databaseUrl);
  if (derivedDirectUrl) {
    env.DATABASE_URL = derivedDirectUrl;
    console.log("[prisma:migrate:deploy:safe] Pooler URL'den direct Supabase URL turetildi, migration onunla calistirilacak.");
  } else {
    console.warn(
      "[prisma:migrate:deploy:safe] SUPABASE_DB_DIRECT_URL tanimli degil. Migration DATABASE_URL ile calistiriliyor."
    );
  }
}

const prismaExecutableName = process.platform === "win32" ? "prisma.cmd" : "prisma";
const prismaBinCandidates = [
  resolve(process.cwd(), "node_modules", ".bin", prismaExecutableName),
  resolve(process.cwd(), "..", "node_modules", ".bin", prismaExecutableName),
  resolve(process.cwd(), "..", "..", "node_modules", ".bin", prismaExecutableName),
  resolve(__dirname, "..", "node_modules", ".bin", prismaExecutableName),
  resolve(__dirname, "..", "..", "node_modules", ".bin", prismaExecutableName),
  resolve(__dirname, "..", "..", "..", "node_modules", ".bin", prismaExecutableName)
];
const prismaBin = prismaBinCandidates.find((candidate) => existsSync(candidate)) ?? "prisma";
const args = ["migrate", "deploy", "--schema", "prisma/schema.prisma"];

const result = spawnSync(prismaBin, args, {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("[prisma:migrate:deploy:safe] Prisma komutu baslatilamadi:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
