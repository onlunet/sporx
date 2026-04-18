import { Global, Module } from "@nestjs/common";
import { SecurityEventService } from "./security-event.service";
import { IncidentReadinessService } from "./incident-readiness.service";

@Global()
@Module({
  providers: [SecurityEventService, IncidentReadinessService],
  exports: [SecurityEventService, IncidentReadinessService]
})
export class SecurityEventsModule {}
