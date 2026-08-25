/**
 * What a refused event entry says to the reader (2Q-B §3.1).
 *
 * One table, in the reader's language, and nothing from a schema, a stack or
 * an enum reaches it. The rule is the one §13.9 already settled for the fret
 * sheet: a refusal has to be specific enough to act on, and a musician acts
 * on "that beat already has a kick", never on `target_occupied`.
 *
 * `Record` over the code union makes adding a code without adding a sentence
 * a type error rather than a blank line in front of somebody.
 */
import type { EventEntryErrorCode } from "@/lib/song/event-entry";

export const EVENT_ENTRY_MESSAGES: Readonly<Record<EventEntryErrorCode, string>> = {
  section_not_found: "Bu bölüm artık yok.",
  bar_not_found: "Bu an bu bölümün içinde değil.",
  track_not_found: "Bu track artık yok.",
  track_not_drums: "Bu track bir davul seti değil.",
  track_not_pitched: "Bu track perdeli bir enstrüman; notası tab üzerinden yazılır.",
  unknown_drum_piece: "Bu davul parçası bu sette yok.",
  off_grid_target: "Bu an ölçünün ritim aralığına tam oturmuyor.",
  target_occupied: "Burada zaten bir ses var.",
  nothing_to_remove: "Burada silinecek bir şey yok.",
  pitch_unreadable: "Bu nota adı okunamadı.",
  instrument_range_unavailable:
    "Bu enstrümanın ses aralığı kayıtlı değil, o yüzden sınır kontrolü yapılamıyor.",
  validation_failed: "Bu yazım kontrollerden geçmedi ve uygulanmadı.",
};
