import { Injectable } from "@nestjs/common";

type Axis = {
  key: string;
  homeValue: number;
  awayValue: number;
  advantage: "home" | "away" | "neutral";
};

type SummaryMeta = {
  homeSampleSize?: number;
  awaySampleSize?: number;
  fallbackUsed?: boolean;
};

@Injectable()
export class ExplanationEngineService {
  private readonly axisLabels: Record<string, string> = {
    offense: "hücum üretkenliði",
    defense: "savunma dengesi",
    tempo: "oyun temposu",
    setPiece: "duran top etkinliði",
    transition: "geçiþ oyunu",
    cohesion: "takým uyumu",
    overall: "genel güç"
  };

  summarize(axes: Axis[], confidenceScore: number, meta?: SummaryMeta) {
    const strongAxis = [...axes].sort(
      (a, b) => Math.abs(b.homeValue - b.awayValue) - Math.abs(a.homeValue - a.awayValue)
    )[0];

    if (!strongAxis) {
      return "Yeterli veri olmadýðý için karþýlaþtýrma güvenilir þekilde üretilemedi.";
    }

    const delta = Math.abs(strongAxis.homeValue - strongAxis.awayValue);
    const deltaText = delta < 0.05 ? "çok sýnýrlý" : delta < 0.12 ? "orta" : "belirgin";
    const edgeText =
      strongAxis.advantage === "home"
        ? "ev sahibi lehine"
        : strongAxis.advantage === "away"
          ? "deplasman lehine"
          : "dengeli";

    const notes: string[] = [];
    if ((meta?.homeSampleSize ?? 0) < 4 || (meta?.awaySampleSize ?? 0) < 4) {
      notes.push("örneklem düþük olduðu için sonuç temkinli yorumlanmalý");
    }
    if (meta?.fallbackUsed) {
      notes.push("sezon verisi yetersiz olduðu için geniþ tarih aralýðý kullanýldý");
    }

    const cautionText = notes.length > 0 ? ` (${notes.join("; ")})` : "";
    return `Karþýlaþmada ana ayrýþma ${this.axisLabels[strongAxis.key] ?? strongAxis.key} ekseninde ve ${edgeText}. Fark seviyesi ${deltaText}. Güven ${Math.round(confidenceScore * 100)}%.${cautionText}`;
  }
}
