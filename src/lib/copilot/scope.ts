/**
 * The locked surface (spec 11.1, decision K-18).
 *
 * One request may change exactly one thing: the target track's slots inside
 * the target section. Everything else in the song is locked — the other
 * tracks' content, the section's name, id, status and bar shapes, the order of
 * the sections, the global track list with its instruments, presets, tunings
 * and capos, and the song's own metadata.
 *
 * The output schema is already narrow enough that most of this cannot be
 * expressed, let alone sent. This module is the second lock: it takes a
 * fingerprint of everything outside the change surface before and after the
 * patch is applied and refuses if any of it moved. A schema keeps a bad answer
 * out; this keeps a bad *apply* out, including one caused by our own code.
 *
 * The digest is a non-cryptographic hash of canonical JSON. It is an integrity
 * comparison between two values we hold in memory at the same moment, not a
 * defence against a forger, so a short stable digest is the right tool and a
 * signature would be theatre.
 */
import { canonicalJson } from "@/lib/copilot/fingerprint";
import type { Song } from "@/lib/song/schema";

/** FNV-1a, 32 bit, hex. Stable across runs and machines. */
export function digestOf(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type SurfaceDigest = {
  /** Title, tempo, key, schema version. */
  songMeta: string;
  /** The whole track list: instrument, preset, tuning, capo, volume, flags. */
  tracks: string;
  /** Section ids in playing order. */
  sectionOrder: string;
  /** Per section: name, status and the shape of every bar. */
  sectionMeta: Record<string, string>;
  /**
   * Per section and track: the slot content, keyed "sectionId::trackId".
   *
   * Whether a track is written in a section at all lives here rather than in
   * `sectionMeta`, because a target track that was silent (spec 5.5) and now
   * has a part is exactly what an arrange request is for. A *locked* track
   * appearing or disappearing still shows up: its key changes from absent to
   * present, or the other way, and that is a difference.
   */
  trackContent: Record<string, string>;
};

export const contentKey = (sectionId: string, trackId: string) =>
  `${sectionId}::${trackId}`;

export function surfaceDigest(song: Song): SurfaceDigest {
  const sectionMeta: Record<string, string> = {};
  const trackContent: Record<string, string> = {};

  for (const section of song.sections) {
    sectionMeta[section.id] = digestOf({
      id: section.id,
      name: section.name,
      status: section.status,
      // Bar shape without the slots: what the model may never touch.
      bars: section.bars.map((bar) => ({
        timeSignature: bar.timeSignature,
        resolution: bar.resolution,
        bpmOverride: bar.bpmOverride ?? null,
      })),
    });

    const trackIds = new Set(
      section.bars.flatMap((bar) => Object.keys(bar.slots)),
    );
    for (const trackId of trackIds) {
      trackContent[contentKey(section.id, trackId)] = digestOf(
        section.bars.map((bar) => bar.slots[trackId] ?? null),
      );
    }
  }

  return {
    songMeta: digestOf({
      version: song.version,
      title: song.title,
      bpm: song.bpm,
      key: song.key,
    }),
    tracks: digestOf(song.tracks),
    sectionOrder: digestOf(song.sections.map((section) => section.id)),
    sectionMeta,
    trackContent,
  };
}

export type SurfaceViolation = {
  /** What moved, in words a server log can be read by. */
  field: string;
  detail: string;
};

/**
 * Everything except the one allowed surface must be byte-identical.
 *
 * Reported in a fixed order — song, tracks, section order, section metadata,
 * then track content — so the same violation always reads the same way.
 */
export function checkLockedSurface(
  before: SurfaceDigest,
  after: SurfaceDigest,
  target: { sectionId: string; targetTrackId: string },
): SurfaceViolation[] {
  const violations: SurfaceViolation[] = [];
  const allowed = contentKey(target.sectionId, target.targetTrackId);

  if (before.songMeta !== after.songMeta) {
    violations.push({ field: "song", detail: "song metadata changed" });
  }
  if (before.tracks !== after.tracks) {
    violations.push({
      field: "tracks",
      detail: "the global track list, or an instrument/preset/tuning changed",
    });
  }
  if (before.sectionOrder !== after.sectionOrder) {
    violations.push({
      field: "sectionOrder",
      detail: "sections were added, removed or reordered",
    });
  }

  for (const key of sortedKeys(before.sectionMeta, after.sectionMeta)) {
    if (before.sectionMeta[key] !== after.sectionMeta[key]) {
      violations.push({
        field: `section:${key}`,
        detail: "section metadata or bar shape changed",
      });
    }
  }

  for (const key of sortedKeys(before.trackContent, after.trackContent)) {
    if (key === allowed) continue;
    if (before.trackContent[key] !== after.trackContent[key]) {
      violations.push({
        field: `content:${key}`,
        detail: "a locked track's slots changed",
      });
    }
  }

  return violations;
}

function sortedKeys(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}
