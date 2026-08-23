/**
 * The attribution an exported WAV carries with it (spec 13.19, 2M-A §14).
 *
 * The samples are CC BY 3.0 US. That licence asks for credit wherever the
 * work travels, and a rendered WAV travels further than the app does — so
 * the export surface has to hand the credit over, not merely display it
 * somewhere in a settings screen.
 *
 * Every value comes from the vendored manifest, which was written from the
 * source repository's own README. Nothing here is composed from memory, and
 * the licence *text* is deliberately not reproduced: it is linked, because a
 * legal text must be copied from its canonical source or not shipped at all.
 */
import { SAMPLE_LICENSE } from "@/lib/audio/packs";
import { BRAND_NAME, BRAND_SLUG } from "@/lib/brand";

export const ATTRIBUTION_FILE_NAME = `${BRAND_SLUG}-atif.txt`;
export const ATTRIBUTION_MIME = "text/plain;charset=utf-8";

/**
 * True when the full legal text sits in the repository next to the notice.
 *
 * Read from the manifest rather than assumed. While it is false the app says
 * "licence text: <url>" and links out; it never claims to ship a copy it does
 * not have, and it never reconstructs one.
 */
export const LICENSE_TEXT_VENDORED: boolean = SAMPLE_LICENSE.textVendored;

/**
 * The plain-text credit file offered beside a WAV.
 *
 * Deterministic UTF-8: the same manifest always produces the same bytes, so
 * two people exporting the same song get identical credit files and a
 * checksum over one means something.
 */
export function attributionText(): string {
  return [
    `${BRAND_NAME} — ses örnekleri atfı`,
    "",
    `Kaynak: ${SAMPLE_LICENSE.soundfont}`,
    `Depo: ${SAMPLE_LICENSE.sourceRepository}`,
    `Lisans: ${SAMPLE_LICENSE.name} (${SAMPLE_LICENSE.spdx})`,
    `Lisans metni: ${SAMPLE_LICENSE.url}`,
    "",
    "Atıf:",
    SAMPLE_LICENSE.attribution,
    "",
    `Bu dosyadaki ses, yukarıdaki soundfont'tan seçilmiş ve ${BRAND_NAME} için`,
    "önceden işlenmiş örneklerle üretildi. Örnekler dönüştürülmüştür:",
    "nota başına ayrılmış, yeniden kodlanmış ve seviye olarak düzeltilmiştir.",
    "",
  ].join("\n");
}

/** The single line CC BY asks to appear wherever the work is used. */
export function attributionLine(): string {
  return SAMPLE_LICENSE.attribution;
}

/**
 * The licence facts the export surface prints.
 *
 * Re-stated here so a view never has to reach into the audio layer for a
 * string: the sheet imports its licence text from the export module that
 * owns it, and the boundary rule against components touching `lib/audio`
 * stays exactly as strict as it should be.
 */
export const LICENSE_DISPLAY = {
  name: SAMPLE_LICENSE.name,
  spdx: SAMPLE_LICENSE.spdx,
  url: SAMPLE_LICENSE.url,
} as const;
