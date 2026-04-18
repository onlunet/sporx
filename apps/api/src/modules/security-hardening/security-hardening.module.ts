import { Global, Module } from "@nestjs/common";
import { SecretGovernanceService } from "./secret-governance.service";
import { APISecurityService } from "./api-security.service";
import { AdminSecurityBoundaryService } from "./admin-security-boundary.service";
import { InternalRuntimeSecurityService } from "./internal-runtime-security.service";
import { StorageSecurityService } from "./storage-security.service";
import { RuntimeHardeningService } from "./runtime-hardening.service";
import { SupplyChainSecurityService } from "./supply-chain-security.service";

@Global()
@Module({
  providers: [
    SecretGovernanceService,
    APISecurityService,
    AdminSecurityBoundaryService,
    InternalRuntimeSecurityService,
    StorageSecurityService,
    RuntimeHardeningService,
    SupplyChainSecurityService
  ],
  exports: [
    SecretGovernanceService,
    APISecurityService,
    AdminSecurityBoundaryService,
    InternalRuntimeSecurityService,
    StorageSecurityService,
    RuntimeHardeningService,
    SupplyChainSecurityService
  ]
})
export class SecurityHardeningModule {}
