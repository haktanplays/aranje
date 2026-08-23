/**
 * The phase-0 `muted`/`soloed` fields, audited and pinned (2M-A §0).
 *
 * The Song Contract has carried two optional booleans on a track since
 * phase 0. Nothing in the product has ever written them, and 2L-C's session
 * audition is a different thing that happens to share a word. Before export
 * ships, what they actually do has to be settled rather than assumed: an
 * exported WAV is a file someone keeps, and a hidden flag that silences a
 * track in it would be a silent data loss with no control able to reveal it.
 *
 * The audit that produced these assertions found exactly one live reader —
 * `buildVoice` in the engine, which turned `muted: true` into a muted
 * channel — and no reader at all for `soloed`. That reader is gone; these
 * tests are what keeps it gone.
 *
 * No contract migration happens here. The fields stay in the schema and a
 * file that carries them still round-trips byte for byte: this is about what
 * they *decide*, which is now nothing.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";

import { identifiersOf } from "@/lib/dev/ast";
import { exportProject, parseProjectText } from "@/lib/project/project-file";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, trackSchema, type Song } from "@/lib/song/schema";
import { materializeTemplate, SONG_TEMPLATES } from "@/lib/song/song-templates";
import { audibleTrackIds, EMPTY_AUDITION } from "@/lib/song/track-mix";

/** A song whose first track carries both legacy flags, set the awkward way. */
const withLegacyFlags = (): Song =>
  songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.map((track, index) =>
      index === 0 ? { ...track, muted: true, soloed: true } : track,
    ),
  });

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("63. the legacy audibility flags decide nothing", () => {
  it("is still part of the contract, optional, and refused when it is not a boolean", () => {
    // Where they are defined: two optional booleans on the track schema.
    expect(trackSchema.safeParse({ ...SAMPLE_SONG.tracks[0] }).success).toBe(true);
    expect(
      trackSchema.safeParse({ ...SAMPLE_SONG.tracks[0], muted: true, soloed: false })
        .success,
    ).toBe(true);
    expect(
      trackSchema.safeParse({ ...SAMPLE_SONG.tracks[0], muted: "yes" }).success,
    ).toBe(false);
  });

  it("is read by no module in the audio layer", () => {
    /*
     * The strongest form of "they change nothing you can hear": the whole
     * audio layer — engine, scheduler, expression, playback — never names
     * them. Audibility reaches a channel through `setTrackAudibility` and
     * nowhere else. (`channel.mute` is a different identifier and stays.)
     */
    for (const path of walk("src/lib/audio")) {
      const names = identifiersOf(path);
      expect(names.has("muted"), `${path} reads muted`).toBe(false);
      expect(names.has("soloed"), `${path} reads soloed`).toBe(false);
    }
  });

  it("is not what the session audition is made of", () => {
    // 2L-C's audition is a pair of id sets and asks the song for nothing but
    // its track order: a song full of legacy flags is entirely audible.
    const song = withLegacyFlags();
    expect(audibleTrackIds(song, EMPTY_AUDITION)).toEqual(
      song.tracks.map((track) => track.id),
    );
  });

  it("is written by nothing that makes a song", () => {
    // Neither the sample song nor any template invents them.
    for (const track of SAMPLE_SONG.tracks) {
      expect(track.muted).toBeUndefined();
      expect(track.soloed).toBeUndefined();
    }
    for (const template of SONG_TEMPLATES) {
      const song = materializeTemplate(template.id);
      expect(song, template.id).not.toBeNull();
      for (const track of song?.tracks ?? []) {
        expect(track.muted, template.id).toBeUndefined();
        expect(track.soloed, template.id).toBeUndefined();
      }
    }
  });

  it("survives a project file round trip untouched, because the file is the song", () => {
    /*
     * Deliberately *not* stripped. The project serializer writes the
     * canonical Song, and a field the contract allows is part of that song;
     * quietly deleting someone's data on save would be a worse answer than
     * carrying a field that decides nothing. So the honest sentence is
     * "session mute/solo is never exported" — not "no mute field can appear
     * in a project file".
     */
    const song = withLegacyFlags();
    const exported = exportProject(song);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.text).toContain('"muted":true');

    const parsed = parseProjectText(exported.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.song.tracks[0]?.muted).toBe(true);
    expect(parsed.song.tracks[0]?.soloed).toBe(true);

    const again = exportProject(parsed.song);
    expect(again.ok && again.text).toBe(exported.text);
  });
});
