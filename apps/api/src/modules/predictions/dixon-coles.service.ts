import { Injectable } from "@nestjs/common";

export type ScoreMatrixCell = {
  home: number;
  away: number;
  probability: number;
};

@Injectable()
export class DixonColesService {
  private factorialCache = new Map<number, number>([
    [0, 1],
    [1, 1]
  ]);

  private factorial(value: number): number {
    if (this.factorialCache.has(value)) {
      return this.factorialCache.get(value)!;
    }
    let result = 1;
    for (let i = 2; i <= value; i += 1) {
      result *= i;
    }
    this.factorialCache.set(value, result);
    return result;
  }

  private poisson(goalCount: number, lambda: number) {
    const safeGoals = Math.max(0, Math.floor(goalCount));
    const safeLambda = Math.max(0.01, lambda);
    return (Math.exp(-safeLambda) * Math.pow(safeLambda, safeGoals)) / this.factorial(safeGoals);
  }

  private tau(homeGoals: number, awayGoals: number, lambdaHome: number, lambdaAway: number, rho: number) {
    if (homeGoals === 0 && awayGoals === 0) {
      return 1 - lambdaHome * lambdaAway * rho;
    }
    if (homeGoals === 0 && awayGoals === 1) {
      return 1 + lambdaHome * rho;
    }
    if (homeGoals === 1 && awayGoals === 0) {
      return 1 + lambdaAway * rho;
    }
    if (homeGoals === 1 && awayGoals === 1) {
      return 1 - rho;
    }
    return 1;
  }

  buildCorrectedMatrix(lambdaHome: number, lambdaAway: number, rho = -0.06, maxGoals = 7): ScoreMatrixCell[] {
    const cells: ScoreMatrixCell[] = [];
    let total = 0;

    for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
      const pHome = this.poisson(homeGoals, lambdaHome);
      for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
        const pAway = this.poisson(awayGoals, lambdaAway);
        const correction = this.tau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho);
        const probability = Math.max(0, pHome * pAway * correction);
        cells.push({
          home: homeGoals,
          away: awayGoals,
          probability
        });
        total += probability;
      }
    }

    if (total <= 0) {
      return cells.map((cell) => ({ ...cell, probability: 0 }));
    }

    return cells.map((cell) => ({
      ...cell,
      probability: Number((cell.probability / total).toFixed(6))
    }));
  }

  outcomeProbabilities(matrix: ScoreMatrixCell[]) {
    let home = 0;
    let draw = 0;
    let away = 0;
    for (const cell of matrix) {
      if (cell.home > cell.away) {
        home += cell.probability;
      } else if (cell.home === cell.away) {
        draw += cell.probability;
      } else {
        away += cell.probability;
      }
    }
    const total = home + draw + away || 1;
    return {
      home: Number((home / total).toFixed(4)),
      draw: Number((draw / total).toFixed(4)),
      away: Number((away / total).toFixed(4))
    };
  }
}

