import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ProvidersService } from "../providers/providers.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PrismaService } from "../../prisma/prisma.service";

@Controller("admin/providers")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly prisma: PrismaService
  ) {}

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

  @Get("football-data/referees")
  async footballDataReferees() {
    const rows = await this.prisma.matchFeatureSnapshot.findMany({
      where: {
        featureSet: {
          name: "context_enrichment"
        },
        match: {
          sport: {
            code: "football"
          }
        }
      },
      orderBy: {
        generatedAt: "desc"
      },
      take: 80,
      select: {
        matchId: true,
        generatedAt: true,
        features: true,
        match: {
          select: {
            matchDateTimeUTC: true,
            status: true,
            homeTeam: {
              select: { name: true }
            },
            awayTeam: {
              select: { name: true }
            },
            league: {
              select: { name: true }
            }
          }
        }
      }
    });

    const items = rows
      .map((row) => {
        const features = row.features as Record<string, unknown> | null;
        const refereeName =
          features && typeof features.refereeName === "string" && features.refereeName.trim().length > 0
            ? features.refereeName.trim()
            : null;
        if (!refereeName) {
          return null;
        }
        return {
          matchId: row.matchId,
          generatedAt: row.generatedAt,
          kickoffAt: row.match.matchDateTimeUTC,
          status: row.match.status,
          leagueName: row.match.league.name,
          homeTeam: row.match.homeTeam.name,
          awayTeam: row.match.awayTeam.name,
          referee: {
            name: refereeName,
            source:
              features && typeof features.refereeSource === "string"
                ? features.refereeSource
                : "unknown"
          }
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return {
      items,
      meta: {
        total: items.length
      }
    };
  }
}
