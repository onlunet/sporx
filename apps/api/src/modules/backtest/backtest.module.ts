import { Module } from "@nestjs/common";
import { BacktestService } from "./backtest.service";

@Module({
  providers: [BacktestService],
  exports: [BacktestService]
})
export class BacktestModule {}

