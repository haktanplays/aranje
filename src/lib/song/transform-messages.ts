/**
 * What a refused transform says to a musician (spec 5.6, 13.1).
 *
 * One table, in one place. The core's error codes are precise and internal;
 * this is where they become a sentence someone can act on. Nothing from a
 * validator diagnostic, a Zod issue, a stack trace or an internal key reaches
 * the screen through here — a reader should never have to know what
 * `target_grid_incompatible` is to understand that their rhythm does not fit
 * the bar they are moving it into.
 */
import type { TransformErrorCode } from "@/lib/song/transform";

const MESSAGES: Readonly<Record<TransformErrorCode, string>> = {
  selection_empty: "Önce bir nota veya akor seç.",
  selection_out_of_bounds: "Seçim bölümün dışına çıkıyor.",
  section_not_found: "Bu bölüm artık şarkıda yok.",
  track_not_found: "Bu track artık şarkıda yok.",
  track_not_editable: "Bu track tab üzerinde düzenlenmiyor.",
  track_silent_here: "Bu track seçilen ölçülerde çalmıyor.",
  clipboard_empty: "Panoda kopyalanmış bir şey yok.",
  target_grid_incompatible: "Seçim hedef ölçünün ritim aralığına tam oturmuyor.",
  target_occupied: "Hedefte zaten nota veya uzayan bir ses var.",
  out_of_range: "Bu şekil mevcut akort ve capo ile çalınamıyor.",
  string_collision: "İki nota aynı tele düşüyor.",
  position_not_derivable: "Bu nota aynı telde bu şekilde çalınamıyor.",
  section_overflow: "Tekrarlar bölümün sonuna sığmıyor.",
  /*
   * Not a fault, a question (spec 13.20 §2). It reaches the screen only when
   * something calls the core without a decision; the reader normally sees the
   * three choices instead, and this is the sentence for the case where they
   * somehow did not.
   */
  chain_policy_required:
    "Bu seçim bir bağlantıyı kesiyor. Önce ne yapılacağını seç.",
  chain_crosses_section:
    "Bu bağlantı bir sonraki bölüme uzanıyor; bu sürümde buradan düzenlenemiyor.",
  selection_starts_inside_tie:
    "Seçim uzayan bir sesin ortasından başlıyor. Sesin tamamını seç.",
  span_scope_lost:
    "Bu işlem bir çalım bölgesini bölümün dışına ya da olmayan bir tele taşıyor.",
  validation_failed: "Bu düzenleme müzik kurallarına takıldı ve uygulanmadı.",
};

/** The reader-facing sentence for a refusal. */
export function transformMessage(code: TransformErrorCode): string {
  return MESSAGES[code];
}

/**
 * Cross-track and cross-section moves are a V1 boundary rather than a fault,
 * so they get their own sentence instead of a generic "not found".
 */
export const CROSS_SCOPE_MESSAGE =
  "Bu sürümde seçim yalnız aynı track ve bölüm içinde taşınabilir.";
