import { Injectable } from "@nestjs/common";

type Axis = {
  key: string;
  homeValue: number;
  awayValue: number;
  advantage: "home" | "away" | "neutral";
};

@Injectable()
export class BasketballScenarioEngineService {
  private pick(axes: Axis[], key: string) {
    return axes.find((axis) => axis.key === key);
  }

  generate(axes: Axis[]) {
    const notes: string[] = [];
    const transition = this.pick(axes, "transitionOffense");
    const paceControl = this.pick(axes, "paceControl");
    const halfCourt = this.pick(axes, "halfCourtOffense");
    const rimDefense = this.pick(axes, "rimDefense");
    const perimeterDefense = this.pick(axes, "perimeterDefense");
    const scheduleFreshness = this.pick(axes, "scheduleFreshness");
    const overall = this.pick(axes, "overall");

    if (
      transition &&
      paceControl &&
      transition.advantage !== "neutral" &&
      transition.advantage === paceControl.advantage
    ) {
      const side = transition.advantage === "home" ? "Ev sahibi" : "Deplasman";
      notes.push(`${side}, tempoyu yukselten gecis ataklariyla oyuna hiz verebilir.`);
    }

    if (
      rimDefense &&
      perimeterDefense &&
      rimDefense.advantage !== "neutral" &&
      rimDefense.advantage === perimeterDefense.advantage
    ) {
      const side = rimDefense.advantage === "home" ? "Ev sahibi" : "Deplasman";
      notes.push(`${side}, cember ve cevre savunmasini birlikte guclu tutarak rakibi zorlayabilir.`);
    }

    if (halfCourt && halfCourt.advantage !== "neutral" && Math.abs(halfCourt.homeValue - halfCourt.awayValue) > 0.08) {
      const side = halfCourt.advantage === "home" ? "Ev sahibi" : "Deplasman";
      notes.push(`${side}, yari saha setlerinde verim avantaji yakaliyor.`);
    }

    if (scheduleFreshness && scheduleFreshness.advantage !== "neutral") {
      const side = scheduleFreshness.advantage === "home" ? "Ev sahibi" : "Deplasman";
      notes.push(`${side}, dinlenme ve seyahat yukunde daha taze gorunuyor.`);
    }

    if (overall && Math.abs(overall.homeValue - overall.awayValue) < 0.04) {
      notes.push("Genel guc dengesi yakin; son bolumde top kaybi ve faul tercihleri sonucu belirleyebilir.");
    } else if (overall) {
      const side = overall.advantage === "home" ? "Ev sahibi" : overall.advantage === "away" ? "Deplasman" : "Taraflar";
      notes.push(`${side}, genel metriklerde one cikan taraf olarak gorunuyor.`);
    }

    if (notes.length === 0) {
      notes.push("Veri sinyalleri belirgin bir oyun senaryosu vermiyor, mac dengeli akabilir.");
    }

    return notes;
  }
}
