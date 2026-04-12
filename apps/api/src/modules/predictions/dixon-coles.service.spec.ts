import { DixonColesService } from "./dixon-coles.service";

describe("DixonColesService", () => {
  const service = new DixonColesService();

  it("normalizes corrected matrix to 1", () => {
    const matrix = service.buildCorrectedMatrix(1.45, 1.1, -0.06, 6);
    const sum = matrix.reduce((acc, item) => acc + item.probability, 0);
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
  });

  it("changes low score probability when rho is applied", () => {
    const withCorrection = service.buildCorrectedMatrix(1.2, 1.1, -0.08, 5);
    const withoutCorrection = service.buildCorrectedMatrix(1.2, 1.1, 0, 5);

    const corrected00 = withCorrection.find((item) => item.home === 0 && item.away === 0)?.probability ?? 0;
    const plain00 = withoutCorrection.find((item) => item.home === 0 && item.away === 0)?.probability ?? 0;

    expect(corrected00).not.toBeCloseTo(plain00, 6);
  });
});

