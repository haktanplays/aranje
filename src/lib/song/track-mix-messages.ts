/**
 * What the mixer says (spec 13.18, 2L-C §4, §6, §9).
 *
 * One table for the refusals and one place for the way a level is written
 * down. A component that formatted "-6 dB" itself is how the slider label and
 * the track row end up disagreeing about the same number, and how "pan" or
 * "gain" leaks onto a screen meant for a musician.
 */
import { mixerLimits } from "@/lib/limits";
import type { MixErrorCode } from "@/lib/song/track-mix";

export const MIX_MESSAGES: Readonly<Record<MixErrorCode, string>> = {
  track_not_found: "Bu track artık şarkıda yok.",
  volume_out_of_range: `Ses düzeyi ${mixerLimits.volumeDb.min} ile ${mixerLimits.volumeDb.max} dB arasında olmalı.`,
  pan_out_of_range: "Stereo konum sol uç ile sağ uç arasında olmalı.",
  mix_validation_failed: "Bu ayarlar şarkı kurallarına uymuyor ve uygulanmadı.",
};

/**
 * The song moved under an open mixer (§6).
 *
 * No silent rebase: the staged levels were drafted against a song that no
 * longer exists, and quietly writing them onto a different one is how an
 * edit made somewhere else gets undone by a slider nobody touched.
 */
export const MIX_STALE_MESSAGE =
  "Mikser açıldıktan sonra şarkı değişti. Değerleri yeniden açarak düzenle.";

/** Track level is track-wide; the mixer says so rather than implying more. */
export const MIX_SCOPE_NOTE =
  "Bu ayarlar track'in bütün bölümlerdeki sesini değiştirir.";

/** Writing is closed, but listening is not (§12). */
export const MIX_SESSION_ONLY_NOTE =
  "Sustur ve Tek dinle yalnız bu oturumda çalışır.";

/** "0 dB", "-6 dB", "+2.5 dB" — the sign is always visible above centre. */
export function volumeLabel(volumeDb: number): string {
  const rounded = Math.round(volumeDb * 10) / 10;
  if (rounded === 0) return "0 dB";
  return `${rounded > 0 ? "+" : ""}${rounded} dB`;
}

/** "Merkez", "Sol %30", "Sağ %25" — a place, never a number called "pan". */
export function panLabel(pan: number): string {
  const percent = Math.round(Math.abs(pan) * 100);
  if (percent === 0) return "Merkez";
  return pan < 0 ? `Sol %${percent}` : `Sağ %${percent}`;
}

/**
 * The accessible names of the two audition controls.
 *
 * They carry the track's name and the state in words, so the control is
 * readable without seeing which of them is tinted (§9).
 */
export function muteControlLabel(trackName: string, muted: boolean): string {
  return muted ? `${trackName}: susturuldu, sesi aç` : `${trackName}: sustur`;
}

export function soloControlLabel(trackName: string, soloed: boolean): string {
  return soloed
    ? `${trackName}: tek dinleniyor, kapat`
    : `${trackName}: tek dinle`;
}
