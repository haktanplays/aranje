/**
 * Everything the chord builder can refuse, and what it says (spec 13.22 §23).
 *
 * One closed union, one total table. A code with no sentence does not
 * compile, so a refusal can never reach a reader as a blank or as a
 * diagnostic. Nothing here mentions a schema, a parser, a storage key or an
 * exception: a musician gets told what happened to their music and what they
 * can do about it.
 */

export type ChordErrorCode =
  /* what the instrument can do */
  | "instrument_not_harmonic"
  | "invalid_chord_root"
  | "unsupported_chord_quality"
  /* what the fretboard can reach */
  | "no_playable_voicing"
  | "voicing_out_of_range"
  | "voicing_string_collision"
  | "voicing_missing_required_tone"
  /* what the target looks like */
  | "target_grid_incompatible"
  | "target_occupied"
  | "target_is_tie_continuation"
  | "chord_target_linked"
  | "mixed_onset_duration"
  | "mixed_onset_velocity"
  | "mixed_onset_expression"
  | "duration_not_representable"
  /* what happened when it was written */
  | "chord_validation_failed"
  | "chord_no_change"
  | "preview_unavailable"
  | "project_changed_elsewhere"
  | "storage_unavailable";

export const CHORD_MESSAGES: Readonly<Record<ChordErrorCode, string>> = {
  instrument_not_harmonic:
    "Bu enstrümanda akor yazma aracı kullanılamıyor. Bu araç perdeli ve " +
    "perdeli olmayan armonik track'lerde çalışır.",
  invalid_chord_root: "Bu kök ses tanınmadı.",
  unsupported_chord_quality: "Bu akor türü bu sürümde yazılamıyor.",
  no_playable_voicing:
    "Bu konumda çalınabilir bir akor şekli bulunamadı. Başlangıç perdesini " +
    "veya varyasyonu değiştir.",
  voicing_out_of_range:
    "Seçilen şeklin bir veya daha fazla notası enstrümanın çalabildiği " +
    "aralığın dışında.",
  voicing_string_collision:
    "Bu şekil aynı tele iki nota koyuyor; tek telde aynı anda tek nota olur.",
  voicing_missing_required_tone:
    "Bu şekil akoru akor yapan seslerden birini taşımıyor.",
  target_grid_incompatible:
    "Bu vuruş, hedef ölçünün ritim ızgarasında birebir yazılamıyor.",
  target_occupied:
    "Bu vuruşta başka notalar var. Değiştirmek için “Bu vuruşu akorla " +
    "değiştir” seçeneğini kullan.",
  target_is_tie_continuation:
    "Bu vuruş, önceki notanın devamı. Akoru buraya yazmak için önce notayı " +
    "burada bitirmelisin.",
  chord_target_linked:
    "Bu vuruş başka notalara bağlı. Akoru değiştirmeden önce bağlantıyı " +
    "ayırmalısın.",
  mixed_onset_duration:
    "Bu vuruştaki notaların süreleri farklı. Akorla değiştirmek için önce " +
    "sürelerini eşitlemelisin.",
  mixed_onset_velocity:
    "Bu vuruştaki notaların vuruş güçleri farklı. Akorla değiştirmek için " +
    "önce güçlerini eşitlemelisin.",
  mixed_onset_expression:
    "Bu vuruştaki notaların ifadeleri farklı. Akorla değiştirmek için önce " +
    "ifadelerini eşitlemelisin.",
  duration_not_representable:
    "Bu süre bu ölçüde birebir yazılamıyor; kısaltılmadı ve yuvarlanmadı.",
  chord_validation_failed: "Bu akor kontrollerden geçmedi ve yazılmadı.",
  chord_no_change: "Bu vuruşta zaten aynı akor var.",
  preview_unavailable: "Önizleme şu anda hazırlanamadı.",
  project_changed_elsewhere:
    "Bu proje başka bir sekmede değişti. Sayfayı yenilemeden yazamıyorum.",
  storage_unavailable:
    "Bu cihazda kayıt yapılamıyor, bu yüzden akor yazılamıyor. Dinlemeye ve " +
    "yedeklemeye devam edebilirsin.",
};

export type ChordFailure = {
  readonly code: ChordErrorCode;
  readonly message: string;
};

export function chordFail(code: ChordErrorCode): {
  readonly ok: false;
  readonly error: ChordFailure;
} {
  return { ok: false, error: { code, message: CHORD_MESSAGES[code] } };
}
