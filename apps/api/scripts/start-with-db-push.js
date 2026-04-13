const { spawnSync } = require("node:child_process");
const path = require("node:path");

const entrypoint = process.argv[2];

if (!entrypoint) {
  // Keep failure explicit for misconfigured process managers.
  console.error("Missing entrypoint argument. Usage: node scripts/start-with-db-push.js <entrypoint>");
  process.exit(1);
}

const shouldRunDbPush = (process.env.RUN_PRISMA_DB_PUSH ?? "true").toLowerCase() !== "false";

if (shouldRunDbPush) {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const prismaResult = spawnSync(
    npxCommand,
    ["prisma", "db", "push", "--schema", path.join("prisma", "schema.prisma")],
    { stdio: "inherit", env: process.env }
  );

  if (prismaResult.status !== 0) {
    process.exit(prismaResult.status ?? 1);
  }
}

const appResult = spawnSync(process.execPath, [entrypoint], {
  stdio: "inherit",
  env: process.env
});

if (appResult.error) {
  console.error(appResult.error.message);
  process.exit(1);
}

process.exit(appResult.status ?? 0);
