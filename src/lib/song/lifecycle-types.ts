/**
 * The shared vocabulary of the lifecycle cores (spec 13.17, 2L-B).
 *
 * Three pure modules — song, section and track — apply sixteen commands
 * between them, and everything they have to agree on lives here: what a
 * command is called, what a refusal is called, and what an application
 * returns. The modules themselves never import each other; they meet only in
 * this file, the way the bar commands meet in their own contract.
 *
 * A result is the whole answer. `ok` carries the song that *would* exist and
 * every warning the validator chain raised about it — warnings travel with
 * the success because they are shown, not obeyed (spec 10.3). A refusal
 * carries a code and nothing else: the sentence a reader sees comes from the
 * one table in `lifecycle-messages.ts`, never from the core.
 */
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/**
 * Every lifecycle command, by name.
 *
 * Sixteen commands, fifteen reader-facing labels: setting and clearing a
 * section's tempo are one story to a reader ("Bölüm temposunu değiştirme")
 * and two commands to the core, which is the right way round — the core
 * needs to know which one it is undoing, the reader does not.
 */
export type LifecycleCommandKind =
  | "create_song"
  | "update_song_info"
  | "create_section"
  | "rename_section"
  | "duplicate_section"
  | "move_section"
  | "delete_section"
  | "set_section_tempo_override"
  | "clear_section_tempo_override"
  | "create_track"
  | "rename_track"
  | "duplicate_track"
  | "move_track"
  | "delete_track"
  | "update_track_setup"
  | "replace_track_setup_and_clear_content";

export type LifecycleErrorCode =
  /* song */
  | "unknown_template"
  | "invalid_title"
  | "invalid_key"
  | "bpm_out_of_range"
  /* section */
  | "section_not_found"
  | "invalid_section_name"
  | "bar_count_out_of_range"
  | "song_bar_limit_reached"
  | "grid_not_representable"
  | "last_section_undeletable"
  | "no_room_to_move"
  /* track */
  | "track_not_found"
  | "invalid_track_name"
  | "track_limit_reached"
  | "last_track_undeletable"
  | "unknown_instrument"
  | "unknown_preset"
  | "invalid_fretboard"
  | "fretboard_not_allowed"
  | "invalid_capo"
  /**
   * The safe setup path's refusal (spec 13.17 §8): the candidate song kept
   * the track's content and the strict schema or the validator chain found
   * an error in the combination. Nothing was clamped, moved or dropped to
   * avoid this code — that is the destructive path's job, and only with the
   * reader's explicit confirmation.
   */
  | "setup_incompatible"
  /** Any other candidate the schema or the error-severity validators refuse. */
  | "validation_failed";

export type LifecycleError = {
  readonly code: LifecycleErrorCode;
};

/**
 * What applying a command produced.
 *
 * The song is a new value — no lifecycle command ever mutates its input —
 * and the caller decides whether it becomes a commit. Warnings are the
 * validator chain's non-blocking findings about the new song.
 */
export type GuardResult<Code extends string> =
  | {
      readonly ok: true;
      readonly song: Song;
      readonly warnings: readonly ValidationIssue[];
    }
  | { readonly ok: false; readonly error: { readonly code: Code } };

export type LifecycleResult = GuardResult<LifecycleErrorCode>;
