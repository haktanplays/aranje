/**
 * One project's durable record (spec 13.21 §8, 2O-A).
 *
 * The single-song envelope, per project. It keeps the same two slots and the
 * same monotonic revision, because the guarantees they buy — a crash mid-write
 * costs you the last edit and not the song, and a newer version's file is
 * never overwritten — are exactly the guarantees a project needs. What changes
 * is that there are now several of them, each under its own key.
 *
 * The decision logic is **shared with the song envelope rather than copied**:
 * `decideLoad` and `nextEnvelope` are imported, not reimplemented. A second
 * recovery engine that mostly agreed with the first would be worse than
 * either, and the difference would only ever show up on the day something
 * actually went wrong.
 *
 * ## What a record carries beyond the song
 *
 * `projectId`, so a payload found without a catalog can say which project it
 * is — that is what makes a half-finished create recoverable rather than an
 * orphan nobody can place. And `updatedAt`, which exists only to sort and
 * label the list. Neither ever reaches the Song, the fingerprint, a Copilot
 * request or an exported file.
 */
import { z } from "zod";

import { PROJECT_ID_PATTERN } from "@/lib/projects/project-id";
import { decideLoad, nextEnvelope, type LoadDecision } from "@/lib/song/storage-envelope";
import type { Song } from "@/lib/song/schema";

export const PROJECT_RECORD_FORMAT = "aranje.project-record";
export const PROJECT_RECORD_VERSION = 1;

export type ProjectRecordV1 = {
  readonly format: typeof PROJECT_RECORD_FORMAT;
  readonly version: typeof PROJECT_RECORD_VERSION;
  readonly projectId: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly current: Song;
  readonly previous: Song | null;
};

const recordTagSchema = z.object({
  format: z.literal(PROJECT_RECORD_FORMAT),
  version: z.number().int().min(1),
});

/**
 * The V1 shell. `current` and `previous` stay `unknown` deliberately: the
 * whole point of keeping two is that one of them may be broken, so they are
 * validated separately and by the Song Contract, not by this schema.
 */
const recordShellSchema = z.strictObject({
  format: z.literal(PROJECT_RECORD_FORMAT),
  version: z.literal(PROJECT_RECORD_VERSION),
  projectId: z.string().regex(PROJECT_ID_PATTERN),
  revision: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
  current: z.unknown(),
  previous: z.unknown(),
});

export type RecordDecision =
  | { readonly kind: "empty" }
  | {
      readonly kind: "record";
      readonly projectId: string;
      readonly song: Song;
      readonly revision: number;
      readonly updatedAt: number;
      readonly previous: Song | null;
    }
  | {
      readonly kind: "recovered_previous";
      readonly projectId: string;
      readonly song: Song;
      readonly revision: number;
      readonly updatedAt: number;
    }
  | { readonly kind: "corrupt" }
  | { readonly kind: "future_version"; readonly version: number };

/**
 * Decide what a stored project record means. Pure.
 *
 * The version is read before the shape, and the two song slots are judged by
 * the same `decideLoad` the single-song key uses — handed the inner pair as an
 * envelope so there is one implementation of "current, then previous, then
 * give up" in the codebase rather than two.
 */
export function decideRecord(raw: string | null): RecordDecision {
  if (raw === null) return { kind: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "corrupt" };
  }

  const tag = recordTagSchema.safeParse(parsed);
  if (!tag.success) return { kind: "corrupt" };
  if (tag.data.version !== PROJECT_RECORD_VERSION) {
    return { kind: "future_version", version: tag.data.version };
  }

  const shell = recordShellSchema.safeParse(parsed);
  if (!shell.success) return { kind: "corrupt" };

  /*
   * The two slots, judged by the song envelope's own reader. Re-serialising
   * into its shape costs one `JSON.stringify` and buys one implementation of
   * the current/previous rule — the alternative is two readers that agree
   * until the day they do not.
   */
  const inner: LoadDecision = decideLoad(
    JSON.stringify({
      format: "aranje.song",
      version: 1,
      revision: shell.data.revision,
      current: shell.data.current,
      previous: shell.data.previous,
    }),
  );

  if (inner.kind === "envelope") {
    return {
      kind: "record",
      projectId: shell.data.projectId,
      song: inner.song,
      revision: shell.data.revision,
      updatedAt: shell.data.updatedAt,
      previous: inner.previous,
    };
  }
  if (inner.kind === "recovered_previous") {
    return {
      kind: "recovered_previous",
      projectId: shell.data.projectId,
      song: inner.song,
      revision: shell.data.revision,
      updatedAt: shell.data.updatedAt,
    };
  }
  return { kind: "corrupt" };
}

/**
 * The next record to write.
 *
 * `previous` and `revision` come from `nextEnvelope`, so the rung of the
 * ladder a project can be caught on is built by the same code that builds the
 * single-song one.
 */
export function nextRecord(
  projectId: string,
  song: Song,
  onDisk: RecordDecision,
  now: number,
): ProjectRecordV1 {
  const asEnvelopeDecision: LoadDecision =
    onDisk.kind === "record"
      ? {
          kind: "envelope",
          song: onDisk.song,
          revision: onDisk.revision,
          previous: onDisk.previous,
        }
      : onDisk.kind === "recovered_previous"
        ? { kind: "recovered_previous", song: onDisk.song, revision: onDisk.revision }
        : { kind: "empty" };

  const envelope = nextEnvelope(song, asEnvelopeDecision);
  return {
    format: PROJECT_RECORD_FORMAT,
    version: PROJECT_RECORD_VERSION,
    projectId,
    revision: envelope.revision,
    updatedAt: now,
    current: envelope.current,
    previous: envelope.previous,
  };
}

export function serializeRecord(record: ProjectRecordV1): string {
  return JSON.stringify({
    format: record.format,
    version: record.version,
    projectId: record.projectId,
    revision: record.revision,
    updatedAt: record.updatedAt,
    current: record.current,
    previous: record.previous,
  });
}
