import { Injectable } from "@nestjs/common";
import { Counter, Histogram, Registry } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly requestCount = new Counter({
    name: "sporx_api_requests_total",
    help: "Total API requests",
    registers: [this.registry],
    labelNames: ["method", "path", "status"]
  });

  readonly requestLatency = new Histogram({
    name: "sporx_api_request_duration_ms",
    help: "API request latency in ms",
    registers: [this.registry],
    buckets: [25, 50, 100, 200, 400, 800, 1500],
    labelNames: ["method", "path"]
  });
}
