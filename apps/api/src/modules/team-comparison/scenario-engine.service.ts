import { Injectable } from "@nestjs/common";

@Injectable()
export class ScenarioEngineService {
  private readonly axisLabels: Record<string, string> = {
    offense: "Hücum",
    defense: "Savunma",
    tempo: "Tempo",
    setPiece: "Duran top",
    transition: "Geçiþ oyunu",
    cohesion: "Takým uyumu",
    overall: "Genel güç"
  };

  generate(axes: Array<{ key: string; advantage: "home" | "away" | "neutral" }>) {
    const notes: string[] = [];
    const homeEdges = axes.filter((axis) => axis.advantage === "home").map((axis) => this.axisLabels[axis.key] ?? axis.key);
    const awayEdges = axes.filter((axis) => axis.advantage === "away").map((axis) => this.axisLabels[axis.key] ?? axis.key);

    if (homeEdges.length > 0) {
      notes.push(`Ev sahibi üstünlük alanlarý: ${homeEdges.join(", ")}.`);
    }
    if (awayEdges.length > 0) {
      notes.push(`Deplasman üstünlük alanlarý: ${awayEdges.join(", ")}.`);
    }
    if (notes.length === 0) {
      notes.push("Temel metriklerde taraflar birbirine çok yakýn; maç dengeli görünüyor.");
    }

    return notes;
  }
}
