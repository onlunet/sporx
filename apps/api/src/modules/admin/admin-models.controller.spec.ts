import { AdminModelsController } from "./admin-models.controller";

describe("AdminModelsController", () => {
  it("models inventory fallback uses prediction runs instead of legacy prediction rows", async () => {
    const prisma = {
      modelPerformanceTimeseries: {
        findMany: jest.fn().mockResolvedValue([])
      },
      predictionCalibration: {
        groupBy: jest.fn().mockResolvedValue([])
      },
      backtestResult: {
        groupBy: jest.fn().mockResolvedValue([])
      },
      modelComparisonSnapshot: {
        groupBy: jest.fn().mockResolvedValue([])
      },
      predictionRun: {
        groupBy: jest.fn().mockResolvedValue([{ modelVersionId: "model-v1", _count: { _all: 4 } }]),
        findMany: jest.fn().mockResolvedValue([
          {
            modelVersionId: "model-v1",
            market: "match_outcome",
            horizon: "PRE6",
            createdAt: new Date("2026-04-18T09:00:00.000Z")
          }
        ])
      },
      prediction: {
        groupBy: jest.fn(),
        findMany: jest.fn()
      }
    } as any;

    const controller = new AdminModelsController(prisma);
    (controller as any).modelVersionsForInventory = jest.fn().mockResolvedValue([]);

    const rows = await controller.modelsInventory();

    expect(prisma.predictionRun.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.predictionRun.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.prediction.groupBy).not.toHaveBeenCalled();
    expect(prisma.prediction.findMany).not.toHaveBeenCalled();
    expect(rows[0]).toEqual(
      expect.objectContaining({
        source: "prediction_run_fallback",
        predictionCount: 4
      })
    );
  });

  it("performance fallback builds rows from published predictions and run telemetry", async () => {
    const prisma = {
      modelPerformanceTimeseries: {
        findMany: jest.fn().mockResolvedValue([])
      },
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([])
      },
      predictionRun: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "run-1",
            modelVersionId: "model-v1",
            confidence: 0.62,
            riskFlagsJson: [],
            createdAt: new Date("2026-04-18T09:00:00.000Z")
          }
        ])
      },
      prediction: {
        findMany: jest.fn()
      }
    } as any;

    const controller = new AdminModelsController(prisma);
    (controller as any).ensureModelRegistry = jest.fn().mockResolvedValue(undefined);

    const rows = await controller.performance();

    expect(prisma.publishedPrediction.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.predictionRun.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.prediction.findMany).not.toHaveBeenCalled();
    expect(rows[0]).toEqual(
      expect.objectContaining({
        modelVersionId: "model-v1"
      })
    );
  });
});
