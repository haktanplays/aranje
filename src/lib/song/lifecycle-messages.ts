/**
 * What a refused lifecycle command says to a reader (spec 13.17, 2L-B).
 *
 * One table, like the bar operations have. Every code the three cores can
 * return has a sentence here, and `Record` makes adding a code without a
 * sentence a type error rather than a blank line on screen. The numbers in
 * the sentences come from the central limits at module load — the table
 * never states a bound the limits do not.
 *
 * On the word "track": the product already says it — the history labels of
 * 2J.1 ("Track içeriğini kesme") and the spec's own label list use it — so
 * these sentences say it too rather than introducing a second word for the
 * same thing halfway through. The one surface that deliberately says
 * something else is the instrument list's title ("Enstrümanlar", K-42).
 *
 * The confirmation builders live here for the same reason the table does:
 * a destructive sentence composed inside a component is one rewording away
 * from lying about what is being deleted.
 */
import { bpmRange, songLimits } from "@/lib/limits";
import { MAX_CAPO } from "@/lib/music/fretboard";
import type { LifecycleErrorCode } from "@/lib/song/lifecycle-types";
import type { Section, Track } from "@/lib/song/schema";

export const LIFECYCLE_MESSAGES: Readonly<Record<LifecycleErrorCode, string>> =
  {
    unknown_template: "Bu şablon artık mevcut değil.",
    invalid_title: "Şarkı adı boş olamaz.",
    invalid_key: "Tonalite tanınmadı.",
    bpm_out_of_range: `Tempo ${bpmRange.min} ile ${bpmRange.max} BPM arasında olmalı.`,
    section_not_found: "Bu bölüm artık şarkıda yok.",
    invalid_section_name: "Bölüm adı boş olamaz.",
    bar_count_out_of_range: `Bir bölüm 1 ile ${songLimits.barsPerSection} arasında ölçü taşıyabilir.`,
    song_bar_limit_reached: `Şarkı en fazla ${songLimits.totalBars} ölçü taşıyabilir.`,
    grid_not_representable:
      "Bu ölçü işareti seçilen ritim aralığında yazılamıyor.",
    last_section_undeletable: "Son kalan bölüm silinemez.",
    no_room_to_move: "Bu yönde taşınacak yer yok.",
    track_not_found: "Bu track artık şarkıda yok.",
    invalid_track_name: "Track adı boş olamaz.",
    track_limit_reached: `Şarkı en fazla ${songLimits.maxTracks} track taşıyabilir.`,
    last_track_undeletable: "Son kalan track silinemez.",
    unknown_instrument: "Bu enstrüman kayıtlı değil.",
    unknown_preset: "Bu varyasyon bu enstrümanda yok.",
    invalid_fretboard: "Bu enstrüman için akort bilgisi gerekli.",
    invalid_capo: `Kapo 0 ile ${MAX_CAPO} arasında olmalı.`,
    fretboard_not_allowed: "Bu enstrümanda akort ve kapo ayarı yok.",
    setup_incompatible:
      "Mevcut içerik yeni ayarlarla çalınamıyor; değişiklik uygulanmadı. " +
      "İsterseniz içeriği temizleyerek değiştirebilirsiniz.",
    validation_failed: "Bu değişiklik şarkı kurallarına uymuyor ve uygulanmadı.",
  };

/** The sentence the new-song sheet must show (spec 2L-B §3, verbatim). */
export const NEW_SONG_WARNING =
  "Mevcut şarkının yerine yeni bir şarkı oluşturulacak.";

/** Names the section and says how many bars go with it (spec 2L-B §6). */
export function sectionDeleteConfirmation(section: Section): string {
  return `"${section.name}" bölümü ve içindeki ${section.bars.length} ölçü silinecek.`;
}

/** Says the whole lane goes, in every section (spec 2L-B §7). */
export function trackDeleteConfirmation(track: Track): string {
  return `"${track.name}" track'i ve bütün bölümlerdeki içeriği silinecek.`;
}

/** The destructive setup path's confirmation (spec 2L-B §8). */
export function destructiveSetupConfirmation(track: Track): string {
  return `"${track.name}" track'inin bütün bölümlerdeki notaları silinecek ve ayarları değiştirilecek.`;
}
