/**
 * The portable project file: what is written, and how it is read back
 * (spec 13.15, 2L-A).
 *
 * One strict, versioned envelope around the one Song Contract:
 *
 *     { format: "aranje.project", version: 1, song: Song }
 *
 * Deliberately **not** the storage envelope. That file exists to survive a
 * crash on one device and carries `current`, `previous` and a revision; this
 * file exists to leave the device, and it carries the music and nothing else.
 * No history, no clipboard, no settings, no fingerprint, no recovery state —
 * none of those are the song, and a backup that leaked session state would be
 * a backup nobody was told they were sharing.
 *
 * ## Reading is a pure decision
 *
 * `parseProjectText` takes text and returns what it means. It reads no file,
 * touches no storage and mutates nothing, so every refusal branch — including
 * the ones that only occur when someone hand-edits a file — is exactly
 * testable, and the same input always gives the same answer. The refusals are
 * codes, never sentences: the sentences live in `project-file-errors.ts`.
 *
 * ## The version is read before the shape
 *
 * Same rule as the storage envelope: a future version may not have this shape
 * at all, so the format tag and version are checked with a *loose* schema
 * first. A file from a newer Aranje is "not ours to open", not "corrupt".
 */
import { z } from "zod";

import { BRAND_SLUG } from "@/lib/brand";
import { projectFileLimits } from "@/lib/limits";
import { songSchema, type Song } from "@/lib/song/schema";
import {
  errorsOnly,
  runValidators,
  warningsOnly,
  type ValidationIssue,
} from "@/lib/validators";
import type { ProjectFileErrorCode } from "@/lib/project/project-file-errors";

export const PROJECT_FILE_FORMAT = `${BRAND_SLUG}.project`;
export const PROJECT_FILE_VERSION = 1;

export type AranjeProjectFileV1 = {
  readonly format: typeof PROJECT_FILE_FORMAT;
  readonly version: typeof PROJECT_FILE_VERSION;
  readonly song: Song;
};

/** Only the tag, loosely — "is this a project file, and whose version?" */
const projectTagSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.number().int().min(1),
});

/**
 * The V1 shell. Strict, so an unknown outer key is a refusal rather than a
 * silently dropped field. `song` stays `unknown` here: it is validated by the
 * one Song Contract, not by a second copy of it.
 */
const projectShellSchema = z.strictObject({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(PROJECT_FILE_VERSION),
  song: z.unknown(),
});

/* ------------------------------------------------------------------ export */

export type ProjectExport =
  | { readonly ok: true; readonly text: string; readonly warnings: ValidationIssue[] }
  | { readonly ok: false; readonly code: "song_invalid" };

/**
 * Serialise deterministically: compact JSON, keys sorted at every level, one
 * trailing newline.
 *
 * Sorted keys make byte-equality follow from *structural* equality — two songs
 * that are the same music produce the same file even if their in-memory key
 * order differs, which is what lets a test say "five exports, one byte
 * sequence" and mean it. Compact rather than indented on purpose: the heaviest
 * supported song is ~799 KB compact, and indentation would push a legitimate
 * file toward the import size bound this checkpoint itself sets.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonical(source[key]);
    return out;
  }
  return value;
}

export function serializeProjectFile(file: AranjeProjectFileV1): string {
  return `${JSON.stringify(canonical(file))}\n`;
}

/**
 * The export gate (spec 13.15): schema, then the central validator chain.
 * Errors refuse the export; warnings ride along and never block — a slightly
 * awkward fingering is still worth backing up.
 *
 * Pure: the song is read, never changed, and nothing is written anywhere.
 */
export function exportProject(song: Song): ProjectExport {
  const parsed = songSchema.safeParse(song);
  if (!parsed.success) return { ok: false, code: "song_invalid" };

  const issues = runValidators(parsed.data);
  if (errorsOnly(issues).length > 0) return { ok: false, code: "song_invalid" };

  return {
    ok: true,
    text: serializeProjectFile({
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      song: parsed.data,
    }),
    warnings: warningsOnly(issues),
  };
}

/* ------------------------------------------------------------------ import */

export type ProjectImport =
  | {
      readonly ok: true;
      readonly song: Song;
      /** Warnings only — an error never reaches an `ok` result. */
      readonly warnings: ValidationIssue[];
    }
  | { readonly ok: false; readonly code: ProjectFileErrorCode };

/** True when a file of this many bytes must be refused before being read. */
export function importTooLarge(sizeBytes: number): boolean {
  return sizeBytes > projectFileLimits.maxImportBytes;
}

/*
 * Keys that only ever appear in a file built to attack the object graph.
 * JSON.parse creates them as harmless own properties, and the strict schemas
 * would refuse most of them anyway — but `slots` is a record with free-form
 * keys, so the refusal is made explicit and total rather than left to which
 * schema happens to see the key first.
 */
const ATTACK_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function carriesAttackKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(carriesAttackKey);
  if (value === null || typeof value !== "object") return false;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (ATTACK_KEYS.has(key)) return true;
    if (carriesAttackKey((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

/**
 * Decide what a project file's text means, in the order of spec 13.15:
 * BOM, JSON, "is it a raw legacy Song?", the loose tag, the version, the
 * strict shell, the Song Contract, then the central validator chain.
 *
 * A raw Song — the pre-envelope *storage* format — is refused, not migrated:
 * storage migration is about a key this app already owns, and a portable file
 * claiming to be a project must actually be one.
 *
 * No repair, no clamping, no dropped fields, no silent defaults: the song
 * that comes out is exactly the song in the file, or nothing.
 */
export function parseProjectText(text: string): ProjectImport {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, code: "invalid_json" };
  }

  if (carriesAttackKey(parsed)) return { ok: false, code: "invalid_project" };

  if (songSchema.safeParse(parsed).success) {
    return { ok: false, code: "invalid_project" };
  }

  const tag = projectTagSchema.safeParse(parsed);
  if (!tag.success) return { ok: false, code: "invalid_project" };
  if (tag.data.version !== PROJECT_FILE_VERSION) {
    return { ok: false, code: "unsupported_project_version" };
  }

  const shell = projectShellSchema.safeParse(parsed);
  if (!shell.success) return { ok: false, code: "invalid_project" };

  const song = songSchema.safeParse(shell.data.song);
  if (!song.success) return { ok: false, code: "song_invalid" };

  /*
   * The central chain covers the reference checks too — an unknown
   * instrument, preset or slot track id is a `trackReferences` error, and an
   * impossible tuning is a `fretboardIntegrity` one. An error blocks the
   * import; a warning is information the preview shows.
   */
  const issues = runValidators(song.data);
  if (errorsOnly(issues).length > 0) return { ok: false, code: "song_invalid" };

  return { ok: true, song: song.data, warnings: warningsOnly(issues) };
}

/* ----------------------------------------------------------------- preview */

/**
 * What the preview sheet shows about a song that is not open yet.
 *
 * Data, not sentences: the sheet owns the Turkish. Everything here is read
 * from the parsed song — nothing is read from the raw file, so nothing a
 * hand-edited file says about itself can reach the screen unvalidated.
 */
export type ProjectPreview = {
  readonly title: string;
  readonly songKey: string;
  readonly bpm: number;
  /** True when any section carries its own tempo (spec 8.3). */
  readonly hasTempoChanges: boolean;
  readonly sectionCount: number;
  readonly totalBars: number;
  readonly trackCount: number;
  /** Instrument ids in first-appearance order, deduplicated. */
  readonly instrumentIds: readonly string[];
  readonly warningCount: number;
};

export function projectPreview(
  song: Song,
  warnings: readonly ValidationIssue[],
): ProjectPreview {
  const instrumentIds: string[] = [];
  for (const track of song.tracks) {
    if (!instrumentIds.includes(track.instrumentId)) {
      instrumentIds.push(track.instrumentId);
    }
  }
  return {
    title: song.title,
    songKey: song.key,
    bpm: song.bpm,
    hasTempoChanges: song.sections.some(
      (section) => section.bpmOverride !== undefined && section.bpmOverride !== song.bpm,
    ),
    sectionCount: song.sections.length,
    totalBars: song.sections.reduce((sum, section) => sum + section.bars.length, 0),
    trackCount: song.tracks.length,
    instrumentIds,
    warningCount: warnings.length,
  };
}
