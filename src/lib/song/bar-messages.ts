/**
 * What a refused bar operation says to a musician (spec 13.12).
 *
 * One table. A component that writes its own sentence is how the same refusal
 * gets two wordings on two screens, and how a diagnostic meant for a developer
 * ends up in front of a reader. Every code the core can return has an entry
 * here, and `Record` makes adding a code without adding a sentence a type
 * error rather than a blank line on screen.
 */
import type { BarTransformErrorCode } from "@/lib/song/bar-transform";

export const BAR_MESSAGES: Readonly<Record<BarTransformErrorCode, string>> = {
  section_not_found: "Bu bölüm artık şarkıda yok.",
  track_not_found: "Bu enstrüman artık şarkıda yok.",
  selection_out_of_bounds: "Seçim bölümün dışına çıkıyor.",
  chain_crosses_section:
    "Bu ölçü sonraki bölüme bağlı. Bölüm sınırını aşan ölçü taşıma henüz desteklenmiyor.",
  clipboard_empty: "Panoda kopyalanmış ölçü yok.",
  scope_mismatch:
    "Panodaki içerik başka bir kapsama ait; tek enstrüman ile bütün ölçü karıştırılamaz.",
  wrong_track:
    "Bu sürümde ölçü içeriği yalnız kopyalandığı enstrümana yapıştırılabilir.",
  target_occupied: "Hedefte içerik var.",
  target_grid_incompatible:
    "Kopyalanan ölçü hedef ölçünün ritim aralığına tam oturmuyor.",
  section_would_be_empty: "Bir bölüm en az bir ölçü taşımalı.",
  bar_limit_reached: "Ölçü sınırına ulaşıldı.",
  no_room_to_move: "Bu yönde bölüm içinde yer yok.",
  not_available_in_scope: "Bu işlem seçilen kapsamda yapılamıyor.",
  transform_failed: "Bu işlem uygulanamadı.",
};

/**
 * Codes a reader can resolve by choosing to overwrite.
 *
 * Kept apart from the rest because they are not failures — they are questions,
 * and the screen answers them with a confirmation rather than an apology.
 */
export function needsReplaceConfirmation(code: BarTransformErrorCode): boolean {
  return code === "target_occupied";
}
