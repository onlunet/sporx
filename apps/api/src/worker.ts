import { createServer } from "node:http";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { IngestionQueueService } from "./modules/ingestion/ingestion-queue.service";

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

function startHealthServers() {
  const ports = resolveHealthPorts();
  if (ports.length === 0) {
    return;
  }

  for (const port of ports) {
    const server = createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0];
      if (path === "/health" || path === "/" || path === "") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            service: "worker",
            status: "ok",
            timestamp: new Date().toISOString(),
            pid: process.pid
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
  }
}

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const queue = app.get(IngestionQueueService);
  await queue.startWorker();
  startHealthServers();
}

bootstrapWorker();
