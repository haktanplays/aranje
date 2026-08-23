/**
 * The song-level lifecycle commands (spec 13.17, 2L-B §3, §5).
 *
 * Two commands, both pure: create a song from a launch template, and change
 * the four facts a song states about itself — title, tonic, mode, base
 * tempo. Nothing here writes, remembers or touches a component; a command
 * returns the song it would produce and the caller decides whether that
 * becomes the one commit.
 *
 * Creating a song deliberately does not look at the current song at all.
 * Determinism is the whole point (2L-B §3): the same template answers the
 * same bytes every time, because everything in it comes from the central
 * template table and the registry.
 */
import { bpmRange } from "@/lib/limits";
import { KEY_PATTERN, type Song } from "@/lib/song/schema";
import { guardCandidate } from "@/lib/song/lifecycle-guard";
import type { LifecycleResult } from "@/lib/song/lifecycle-types";

/**
 * The twelve tonics a reader can pick, spelled with sharps.
 *
 * The key is stored as text ("E minor") and shown as music ("E Minör");
 * there is no technical tonality id anywhere for a component to leak.
 */
export const TONIC_OPTIONS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export type KeyMode = "minor" | "major";

/** What the mode is called on screen. The stored word stays English. */
export const KEY_MODE_LABELS: Readonly<Record<KeyMode, string>> = {
  minor: "Minör",
  major: "Majör",
};

/** "E minor" taken apart for a form, or null when the text is not a key. */
export function parseKey(
  key: string,
): { tonic: string; mode: KeyMode } | null {
  if (!KEY_PATTERN.test(key)) return null;
  const [tonic, mode] = key.split(" ");
  if (!tonic || (mode !== "minor" && mode !== "major")) return null;
  return { tonic, mode };
}

export type SongInfo = {
  readonly title: string;
  readonly tonic: string;
  readonly mode: KeyMode;
  readonly bpm: number;
};

export type SongLifecycleCommand =
  | { readonly kind: "update_song_info"; readonly info: SongInfo };

export function applySongCommand(
  song: Song,
  command: SongLifecycleCommand,
): LifecycleResult {
  switch (command.kind) {
    case "update_song_info": {
      const { info } = command;
      const title = info.title.trim();
      if (title.length === 0) {
        return { ok: false, error: { code: "invalid_title" } };
      }
      if (
        !Number.isFinite(info.bpm) ||
        info.bpm < bpmRange.min ||
        info.bpm > bpmRange.max
      ) {
        return { ok: false, error: { code: "bpm_out_of_range" } };
      }
      const key = `${info.tonic} ${info.mode}`;
      if (!KEY_PATTERN.test(key)) {
        return { ok: false, error: { code: "invalid_key" } };
      }
      // Sections keep their own tempo overrides untouched (2L-B §5): only
      // the three top-level facts change, and only those three.
      return guardCandidate({ ...song, title, bpm: info.bpm, key });
    }
    default:
      /*
       * Unreachable through the type, and a refusal anyway.
       *
       * A `switch` with no default returns `undefined` for a command it does
       * not know, and `undefined` is not a refusal — it is a caller reading
       * `.ok` off nothing. `create_song` was removed in 2O-A and anything
       * still sending it, or any command added without a case, gets a typed
       * no rather than a crash.
       */
      return { ok: false, error: { code: "unknown_template" } };
  }
}
