import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class SportsService {
  constructor(private readonly prisma: PrismaService) {}

  listSports() {
    return this.prisma.sport.findMany({ orderBy: { name: "asc" } });
  }
}
