import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class LeaguesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.league.findMany({ orderBy: { name: "asc" } });
  }

  async getById(id: string) {
    const league = await this.prisma.league.findUnique({ where: { id } });
    if (!league) {
      throw new NotFoundException("League not found");
    }
    return league;
  }

  getStandings(id: string) {
    return this.prisma.standing.findMany({
      where: {
        season: {
          leagueId: id
        }
      },
      include: {
        team: true,
        season: true
      },
      take: 100
    });
  }
}
