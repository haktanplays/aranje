/**
 * What an edit is called when the app offers to undo it (spec 13.13, K-44).
 *
 * One table. A component that builds its own sentence is how "Ölçüleri silme"
 * becomes "Bar silindi" on the next screen, and how an enum name or a
 * diagnostic ends up in front of a musician. Nothing a provider or a
 * validator said reaches these strings: they describe the *shape* of the edit
 * and nothing about how it went.
 *
 * `Record` over the command unions is what makes adding a command without
 * adding a name a type error rather than a blank word on a button.
 */
import type {
  BarCommandKind,
  HistoryAction,
  SelectionCommandKind,
} from "@/lib/song/edit-history";
import type { LifecycleCommandKind } from "@/lib/song/lifecycle-types";

const SELECTION_LABELS: Readonly<Record<SelectionCommandKind, string>> = {
  copy_selection: "Seçimi kopyalama",
  cut_selection: "Seçimi kesme",
  delete_selection: "Seçimi silme",
  paste_selection: "Seçime yapıştırma",
  duplicate_selection: "Seçimi çoğaltma",
  move_selection_time: "Seçimi zamanda taşıma",
  repeat_selection: "Seçimi tekrarlama",
  transpose_pitch: "Sesi transpoze etme",
  restring_same_pitch: "Aynı sesi başka telde çalma",
  translate_fret_shape: "Perde şeklini taşıma",
};

/**
 * Bar commands read differently in the two scopes, and have to.
 *
 * "Sil" on one track empties a bar; "Sil" on the whole bar removes it from the
 * song. Undo is exactly where that difference matters most — the reader is
 * being asked what they are putting back.
 */
const TRACK_BAR_LABELS: Readonly<Record<BarCommandKind, string>> = {
  copy_bars: "Ölçüleri kopyalama",
  cut_bars: "Track içeriğini kesme",
  delete_bars: "Track içeriğini silme",
  paste_bar_contents: "Track içeriğini yapıştırma",
  insert_copied_bars: "Kopyalanan ölçüleri ekleme",
  duplicate_bars: "Track içeriğini çoğaltma",
  repeat_bars: "Track içeriğini tekrarlama",
  insert_blank_bar_before: "Önüne boş ölçü ekleme",
  insert_blank_bar_after: "Arkasına boş ölçü ekleme",
  move_bars_left: "Track içeriğini sola taşıma",
  move_bars_right: "Track içeriğini sağa taşıma",
};

const FULL_BAR_LABELS: Readonly<Record<BarCommandKind, string>> = {
  copy_bars: "Ölçüleri kopyalama",
  cut_bars: "Ölçüleri kesme",
  delete_bars: "Ölçüleri silme",
  paste_bar_contents: "Ölçü içeriğini değiştirme",
  insert_copied_bars: "Kopyalanan ölçüleri ekleme",
  duplicate_bars: "Ölçüleri çoğaltma",
  repeat_bars: "Ölçüleri tekrarlama",
  insert_blank_bar_before: "Önüne boş ölçü ekleme",
  insert_blank_bar_after: "Arkasına boş ölçü ekleme",
  move_bars_left: "Ölçüleri sola taşıma",
  move_bars_right: "Ölçüleri sağa taşıma",
};

/**
 * The lifecycle commands, named for a reader (spec 13.17 §9).
 *
 * Sixteen commands, fifteen sentences: setting and clearing a section's
 * tempo are the same story to the person undoing it — the section's tempo
 * changes back — so both wear the same words.
 */
const LIFECYCLE_LABELS: Readonly<Record<LifecycleCommandKind, string>> = {
  update_song_info: "Şarkı bilgilerini değiştirme",
  create_section: "Bölüm ekleme",
  rename_section: "Bölüm adını değiştirme",
  duplicate_section: "Bölüm çoğaltma",
  move_section: "Bölüm taşıma",
  delete_section: "Bölüm silme",
  set_section_tempo_override: "Bölüm temposunu değiştirme",
  clear_section_tempo_override: "Bölüm temposunu değiştirme",
  create_track: "Track ekleme",
  rename_track: "Track adını değiştirme",
  duplicate_track: "Track çoğaltma",
  move_track: "Track taşıma",
  delete_track: "Track silme",
  update_track_setup: "Track ayarlarını değiştirme",
  replace_track_setup_and_clear_content:
    "Track içeriğini temizleyip ayar değiştirme",
};

/** The edit itself, named. */
export function historyActionLabel(action: HistoryAction): string {
  switch (action.kind) {
    case "note_edit":
      return "Nota düzenleme";
    case "group_move":
      return "Nota grubunu taşıma";
    case "selection_transform":
      return SELECTION_LABELS[action.command];
    case "bar_transform":
      return action.scope === "full"
        ? FULL_BAR_LABELS[action.command]
        : TRACK_BAR_LABELS[action.command];
    case "copilot_apply":
      return "Aranje önerisini uygulama";
    case "project_import":
      return "Projeyi açma";
    case "lifecycle":
      return LIFECYCLE_LABELS[action.command];
    case "track_mix_update":
      return "Track miksini değiştirme";
    case "bar_timing_change":
      return action.scope === "section"
        ? "Bölümün ölçü ve ritmini değiştirme"
        : "Ölçü ve ritmi değiştirme";
  }
}

/**
 * The accessible names of the two controls.
 *
 * A bare "Geri al" tells a screen reader which button it is and nothing about
 * what pressing it would do — which is the one thing worth knowing before
 * undoing something. With nothing to undo the control still needs a name, so
 * it keeps the plain one.
 */
export function undoLabel(action: HistoryAction | null): string {
  return action === null ? "Geri al" : `Geri al: ${historyActionLabel(action)}`;
}

export function redoLabel(action: HistoryAction | null): string {
  return action === null ? "Yinele" : `Yinele: ${historyActionLabel(action)}`;
}
