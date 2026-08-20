/**
 * The prompt a model is given to plan a piece (spec 11.8, K-31, K-34).
 *
 * Evaluation only. There is no production blueprint route — `/api/copilot`
 * takes `arrange_track` and nothing else — so this prompt lives here rather
 * than in `src/`. What it must not do is invent a second contract: the schema
 * it shows is `compositionBlueprintSchema` itself, derived, never re-typed,
 * and the rules below are the ones the materialiser already enforces.
 *
 * Both candidates get this byte for byte. The only thing that differs between
 * the two runs is which model is asked.
 */
import { z } from "zod";

import { compositionBlueprintSchema, RHYTHM_GRID_INTENTS } from "@/lib/copilot/blueprint";
import { ARRANGE_SKILLS } from "@/lib/copilot/contract";
import { bpmRange, songLimits } from "@/lib/limits";
import { RESOLUTIONS, resolutionPromptLabel } from "@/lib/music/timing";
import { FULL_BRIEF } from "./request";

export const BLUEPRINT_JSON_SCHEMA = z.toJSONSchema(compositionBlueprintSchema, {
  io: "input",
});

const gridLine = RESOLUTIONS.map(
  (resolution) => `${resolutionPromptLabel(resolution)} (${resolution})`,
).join(" · ");

export const BLUEPRINT_SYSTEM = [
  "Sen Aranje icin calisan bir aranjor yardimcisisin.",
  "Gorevin: bir parcanin PLANINI uretmek. Nota yazmiyorsun.",
  "",
  "Kurallar:",
  "1. Yalnizca istenen semada JSON uret. Aciklama, markdown veya ek metin yazma.",
  "2. Kalici ID uretme. Yalnizca `key` alanlarindaki internal anahtarlari",
  "   kullan; Song icindeki section ve track id'lerini sunucu uretir.",
  "3. Slot dizisi, nota, perde veya tel yazma. Bar sekillerini sunucu kurar.",
  "4. Sanatci, grup veya sarki adi YAZMA. Kullanicinin verdigi isimleri",
  "   ozellik tarifine cevir: doku, register, ritmik karakter, tonal gerilim.",
  `5. Toplam bar sayisi en fazla ${songLimits.totalBars}; bir bolum en fazla`,
  `   ${songLimits.barsPerSection} bar; en fazla ${songLimits.maxTracks} track.`,
  `6. BPM ${bpmRange.min}-${bpmRange.max} arasinda.`,
  `7. Track rolleri yalnizca: ${ARRANGE_SKILLS.join(", ")}.`,
  "8. Bir bolumde calmayan rol `activeRoles` icinde olmaz; sessizlik yokluktur.",
  "9. Karsilanmayan her istegi `omittedRequests` icinde gerekcesiyle yaz.",
  "   Sessizce dusurme.",
  "",
  "Ritmik grid:",
  `- Kullanilabilir grid'ler: ${gridLine}.`,
  "- Ucleme grid'lerinde bir vurus 3 slottur: 1/8 ucleme 4/4 barda 12 slot,",
  "  1/16 ucleme 24 slot demektir. Bunlar 'biraz daha sik duz grid' degildir.",
  "- Parcanin varsayilan grid'i `resolution`; bir bolum kendi `resolution`'ini",
  "  verebilir; tek bir bar `gridAccents` ile daha ince bir grid isteyebilir.",
  "- Bir bar ancak GEREKIYORSA daha ince grid alir ve niyetini soylemek",
  `  zorundadir: ${RHYTHM_GRID_INTENTS.join(", ")}.`,
  "- Yeterli olan EN DUSUK grid tercih edilir. Her bari 1/32 yapmak yasak",
  "  degildir ama gerekcesizse plani zayiflatir.",
  "- Bir grid, olcusunun kendi nota degerini yazabilmelidir; 6/8 ve 7/8",
  "  olculerinde 1/8 ucleme kullanilamaz.",
  "",
  "Ifade edilebilirlik:",
  "- Nota basina tek articulation vardir: accent, palm_mute, vibrato,",
  "  bend_half, bend_full, slide, hammer_on, pull_off, normal, sustain,",
  "  staccato.",
  "- Sweep picking, grace note ve flam bu sozlesmede IFADE EDILEMEZ. Bunlari",
  "  istiyorsan `omittedRequests` icine yaz; varmis gibi anlatma.",
  "- slide, hammer_on ve pull_off yalniz ayni telde ve arada sus olmadan",
  "  calisir; slide en fazla 12, legato en fazla 5 yari ton uzaga gider.",
].join("\n");

export function buildBlueprintUserMessage(): string {
  return [
    "<aranje:data> kullanici istegi",
    FULL_BRIEF,
    "</aranje:data>",
    "",
    "Bu istegi karsilayan bir CompositionBlueprint uret.",
    "Sadece JSON dondur.",
  ].join("\n");
}

export type BlueprintPayload = {
  system: string;
  userMessage: string;
  responseSchema: unknown;
};

export function blueprintPayload(corrections?: readonly string[]): BlueprintPayload {
  const userMessage = corrections && corrections.length > 0
    ? [
        buildBlueprintUserMessage(),
        "",
        "<aranje:data> onceki cevabin reddedildi",
        ...corrections,
        "</aranje:data>",
        "",
        "Ayni istegi karsilayan, bu hatalari duzeltilmis bir JSON uret.",
      ].join("\n")
    : buildBlueprintUserMessage();

  return {
    system: BLUEPRINT_SYSTEM,
    userMessage,
    responseSchema: BLUEPRINT_JSON_SCHEMA,
  };
}
