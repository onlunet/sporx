import { HistoricalImportService } from "./historical-import.service";

describe("HistoricalImportService", () => {
  it("status delegates to prisma", async () => {
    const prisma = {
      historicalImportRun: {
        findMany: jest.fn().mockResolvedValue([{ id: "1" }])
      }
    } as any;

    const service = new HistoricalImportService(prisma);
    const result = await service.status();

    expect(result).toEqual([{ id: "1" }]);
  });
});
