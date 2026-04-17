import { Global, Module } from "@nestjs/common";
import { AccessGovernanceService } from "./access-governance.service";
import { PrivilegedActionControlService } from "./privileged-action-control.service";

@Global()
@Module({
  providers: [AccessGovernanceService, PrivilegedActionControlService],
  exports: [AccessGovernanceService, PrivilegedActionControlService]
})
export class AccessGovernanceModule {}
