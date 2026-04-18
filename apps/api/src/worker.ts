import { createServer } from "node:http";
import type { Server } from "node:http";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { IngestionQueueService } from "./modules/ingestion/ingestion-queue.service";
import { RuntimeHardeningService } from "./modules/security-hardening/runtime-hardening.service";

type WorkerHealthState = {
  phase: "starting" | "ready" | "failed";
  startedAt: string;
  readyAt: string | null;
  error: string | null;
};

function parsePort(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }

  return Math.trunc(parsed);
}

function resolveHealthPorts() {
  const ports = new Set<number>();

  const listRaw = process.env.WORKER_HEALTH_PORTS ?? "";
  for (const token of listRaw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)) {
    const parsed = parsePort(token);
    if (parsed !== null) {
      ports.add(parsed);
    }
  }

  const explicitWorkerPort = parsePort(process.env.WORKER_HEALTH_PORT);
  if (explicitWorkerPort !== null) {
    ports.add(explicitWorkerPort);
  }

  const inheritedPort = parsePort(process.env.PORT);
  if (inheritedPort !== null) {
    ports.add(inheritedPort);
  }

  if ((process.env.ENABLE_WORKER_HEALTH_SERVER ?? "true").toLowerCase() !== "false") {
    ports.add(4001);
  }

  return Array.from(ports.values()).sort((left, right) => left - right);
}

function startHealthServers(state: WorkerHealthState) {
  const ports = resolveHealthPorts();
  if (ports.length === 0) {
    return [] as Server[];
  }

  const servers: Server[] = [];
  for (const port of ports) {
    const server = createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0];
      if (path === "/health" || path === "/" || path === "") {
        const statusCode = state.phase === "failed" ? 503 : 200;
        res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            service: "worker",
            status: state.phase === "ready" ? "ok" : state.phase,
            timestamp: new Date().toISOString(),
            pid: process.pid,
            startedAt: state.startedAt,
            readyAt: state.readyAt,
            error: state.error
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ service: "worker", status: "not_found" }));
    });

    server.on("error", (error) => {
      const message = error instanceof Error ? error.message : "unknown";
      console.warn(`[worker] health server could not bind port ${port}: ${message}`);
    });

    server.listen(port, () => {
      console.log(`[worker] health server listening on :${port}`);
    });
    servers.push(server);
  }

  return servers;
}

async function closeHealthServers(servers: Server[]) {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        })
    )
  );
}

async function bootstrapWorker() {
  const state: WorkerHealthState = {
    phase: "starting",
    startedAt: new Date().toISOString(),
    readyAt: null,
    error: null
  };

  const healthServers = startHealthServers(state);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null = null;
  let shutdownStarted = false;

  const shutdown = async (reason: string, exitCode: number) => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    console.log(`[worker] shutting down (${reason})`);
    if (app) {
      await app.close().catch(() => undefined);
    }
    await closeHealthServers(healthServers);
    process.exit(exitCode);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT", 0);
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM", 0);
  });

  try {
    app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
    const runtimeHardeningService = app.get(RuntimeHardeningService);
    await runtimeHardeningService.assertStartupHardeningOrThrow();
    const queue = app.get(IngestionQueueService);
    await queue.startWorker();
    state.phase = "ready";
    state.readyAt = new Date().toISOString();
    console.log("[worker] bootstrap completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown worker bootstrap error";
    state.phase = "failed";
    state.error = message;
    console.error(`[worker] bootstrap failed: ${message}`);
    await shutdown("bootstrap_failed", 1);
  }
}

bootstrapWorker();
