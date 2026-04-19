const { spawnSync } = require("node:child_process");

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const directUrl = process.env.SUPABASE_DB_DIRECT_URL?.trim() ?? "";
const usingSupabasePooler = /(?:^|@)[^/]*pooler\.supabase\.com(?::\d+)?(?:\/|$)/i.test(databaseUrl);

const env = { ...process.env };

if (directUrl) {
  env.DATABASE_URL = directUrl;
  console.log("[prisma:migrate:deploy:safe] SUPABASE_DB_DIRECT_URL kullanilarak migration calistirilacak.");
} else if (usingSupabasePooler) {
  console.error(
    "[prisma:migrate:deploy:safe] DATABASE_URL Supabase pooler gorunuyor ancak SUPABASE_DB_DIRECT_URL tanimli degil. " +
      "Migration icin direct URL zorunlu."
  );
  process.exit(1);
} else {
  console.warn(
    "[prisma:migrate:deploy:safe] SUPABASE_DB_DIRECT_URL tanimli degil. Migration DATABASE_URL ile calistiriliyor."
  );
}

const prismaBin = process.platform === "win32" ? "node_modules/.bin/prisma.cmd" : "node_modules/.bin/prisma";
const args = ["migrate", "deploy", "--schema", "prisma/schema.prisma"];

const result = spawnSync(prismaBin, args, {
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error("[prisma:migrate:deploy:safe] Prisma komutu baslatilamadi:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
