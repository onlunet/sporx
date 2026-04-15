import { Controller, Get } from "@nestjs/common";
import { CacheService } from "../../cache/cache.service";

@Controller("health")
export class HealthController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  check() {
    return {
      status: "ok",
      service: process.env.SERVICE_ROLE ?? "api",
      timestamp: new Date().toISOString(),
      cache: this.cache.diagnostics()
    };
  }
}
