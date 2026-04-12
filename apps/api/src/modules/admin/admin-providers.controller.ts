import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ProvidersService } from "../providers/providers.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/providers")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get("health")
  health() {
    return this.providersService.providerHealth();
  }

  @Get()
  list() {
    return this.providersService.listProviders();
  }

  @Patch(":key")
  patchProvider(@Param("key") key: string, @Body() body: { isActive?: boolean; baseUrl?: string | null; name?: string }) {
    return this.providersService.updateProvider(key, body);
  }

  @Get(":key/configs")
  getConfigs(@Param("key") key: string) {
    return this.providersService.getProviderConfigs(key);
  }

  @Patch(":key/configs")
  patchConfigs(@Param("key") key: string, @Body() body: { configs: Record<string, string> }) {
    return this.providersService.patchProviderConfigs(key, body);
  }
}
