import { Injectable } from "@nestjs/common";

type Axis = {
  key: string;
  homeValue: number;
  awayValue: number;
  advantage: "home" | "away" | "neutral";
};

type SummaryMeta = {
  homeSampleSize: number;
  awaySampleSize: number;
  fallbackUsed: boolean;
};

@Injectable()
export class BasketballExplanationEngineService {
  private readonly axisLabels: Record<string, string> = {
    shotQualityCreation: "sut kalitesi uretimi",
    halfCourtOffense: "yari saha hucumu",
    transitionOffense: "gecis hucumu",
    rimPressure: "cembere baski",
    perimeterShotProfile: "cevre sut profili",
    turnoverControl: "top kaybi kontrolu",
    offensiveRebounding: "hucum ribaundu",
    defensiveRebounding: "savunma ribaundu",
    rimDefense: "cember savunmasi",
    perimeterDefense: "cevre savunmasi",
    foulDiscipline: "faul disiplini",
    benchImpact: "bench katkisi",
    starPowerReliability: "yildiz oyuncu surekliligi",
    paceControl: "tempo kontrolu",
    clutchStability: "kritik an istikrari",
    scheduleFreshness: "fiziksel tazelik",
    overall: "genel guc"
  };

  summarize(axes: Axis[], confidenceScore: number, meta: SummaryMeta) {
    const strongest = [...axes].sort(
      (left, right) => Math.abs(right.homeValue - right.awayValue) - Math.abs(left.homeValue - left.awayValue)
    )[0];
    if (!strongest) {
      return "Yeterli basketbol verisi olmadigi icin karsilastirma ozeti olusturulamadi.";
    }

    const delta = Math.abs(strongest.homeValue - strongest.awayValue);
    const side =
      strongest.advantage === "home" ? "ev sahibi lehine" : strongest.advantage === "away" ? "deplasman lehine" : "dengede";
    const intensity = delta < 0.05 ? "sinirli" : delta < 0.11 ? "orta" : "belirgin";

    const notes: string[] = [];
    if (meta.homeSampleSize < 5 || meta.awaySampleSize < 5) {
      notes.push("orneklem dusuk oldugu icin sonuc temkinli yorumlanmali");
    }
    if (meta.fallbackUsed) {
      notes.push("sezon verisi yetersiz oldugu icin genis tarih penceresi kullanildi");
    }
    const caution = notes.length > 0 ? ` (${notes.join("; ")})` : "";

    return `Ana ayrisma ${this.axisLabels[strongest.key] ?? strongest.key} ekseninde ve ${side}. Fark seviyesi ${intensity}. Guven ${Math.round(confidenceScore * 100)}%.${caution}`;
  }
}
