import { Module } from "@nestjs/common";
import { HistoricalImportService } from "./historical-import.service";

@Module({
  providers: [HistoricalImportService],
  exports: [HistoricalImportService]
})
export class HistoricalImportModule {}
