"use client";

/**
 * The listening round, as state (2W §3, §5, §6).
 *
 * Deliberately small compared to the editor round it replaces. There is no
 * step index, no gate, no evidence contract and no way to be stuck, because
 * there is nothing here to prove: the founder is not being asked to
 * demonstrate that the product works, only to say how it sounds.
 *
 * Three things it does own:
 *
 * - **Rendering**, lazily. A clip is rendered the first time it is asked for
 *   and then kept, so the second listen is instant. "Tümünü sırayla dinle"
 *   renders and plays in order; every clip is also independently playable at
 *   any time, in any order.
 * - **Measuring**, before offering. A take that came back silent, clipped or
 *   the wrong length is marked faulty and says so instead of drawing a play
 *   button over nothing.
 * - **Answers**, which are the founder's alone. Nothing here derives an
 *   answer from a successful render — a clip that plays perfectly and is
 *   never answered stays `ölçülmedi`.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { songSupport } from "@/lib/acceptance/song-support";
import { clipFault, type ClipAudit } from "@/lib/listening/clip-audit";
import { chordTake } from "@/lib/listening/chord-take";
import { sequenceTake } from "@/lib/listening/sequence-take";
import { listeningClips, type ListeningClip } from "@/lib/listening/clip-plan";
import { renderTake } from "@/lib/listening/render-clip";
import type { Song } from "@/lib/song/schema";

declare global {
  interface Window {
    /**
     * What each rendered take measured, for the automated check (2W §5).
     *
     * Reading only, and written only by this page. The founder never sees it;
     * it exists so a browser runner can assert that a clip has sound in it
     * before anyone is asked what the sound is like. Nothing on the page
     * reads it back, so it cannot influence what is offered or answered.
     */
    __aranjeListening?: Record<string, ClipAudit>;
  }
}

/** Publish one take's measurement, if the page is running in a browser. */
function publishAudit(takeId: string, audit: ClipAudit): void {
  if (typeof window === "undefined") return;
  window.__aranjeListening = { ...(window.__aranjeListening ?? {}), [takeId]: audit };
}

export type TakeState =
  | { readonly kind: "idle" }
  | { readonly kind: "rendering" }
  | { readonly kind: "playing"; readonly audit: ClipAudit }
  | { readonly kind: "ready"; readonly audit: ClipAudit }
  | { readonly kind: "faulty"; readonly reason: string; readonly audit: ClipAudit }
  | { readonly kind: "failed"; readonly reason: string };

export type ListeningPack = {
  readonly clips: readonly ListeningClip[];
  readonly fingerprint: string;
  readonly title: string;
  readonly answers: Readonly<Record<string, string>>;
  readonly notes: Readonly<Record<string, string>>;
  readonly note: string;
  readonly takes: Readonly<Record<string, TakeState>>;
  /** True while the "listen to everything" run is walking the list. */
  readonly runningAll: boolean;
  play(takeId: string): void;
  playAll(): void;
  stop(): void;
  answer(clipId: string, value: string): void;
  setNote(clipId: string, value: string): void;
  setFreeNote(value: string): void;
};

type Buffered = { readonly buffer: AudioBuffer; readonly audit: ClipAudit };

export function useListeningPack(): ListeningPack {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [note, setFreeNoteState] = useState("");
  const [takes, setTakes] = useState<Record<string, TakeState>>({});
  const [runningAll, setRunningAll] = useState(false);

  /*
   * The music, built once. `chordTake` runs the real chord command over a
   * copy, so the fixture the other seven clips read is untouched — and both
   * facts are asserted by the unit tests rather than assumed here.
   */
  const { song, clips, songFor } = useMemo(() => {
    const fixture = editorFixture();
    const chord = chordTake(fixture, { rootPitchClass: 4, quality: "minor" });
    const sequence = sequenceTake(fixture);
    const built = listeningClips(fixture, chord, sequence);
    const byTake: Record<string, Song> = {};
    for (const clip of built) {
      for (const take of clip.takes) {
        /* Two clips play music this batch wrote rather than the fixture: the
           chord the flow recommends, and the fast run the command produces. */
        if (take.id === "L8b" && chord) byTake[take.id] = chord.song;
        else if (take.id === "L10" && sequence) byTake[take.id] = sequence.song;
        else byTake[take.id] = fixture;
      }
    }
    return { song: fixture, clips: built, songFor: byTake };
  }, []);

  const support = useMemo(() => songSupport(song), [song]);

  /* Decoded audio, and the one context that plays it. Refs rather than state:
     neither is drawn, and a re-render for a cached buffer would be noise. */
  const cache = useRef<Map<string, Buffered>>(new Map());
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const runToken = useRef(0);

  const findTake = useCallback(
    (takeId: string) => {
      for (const clip of clips) {
        for (const take of clip.takes) if (take.id === takeId) return { clip, take };
      }
      return null;
    },
    [clips],
  );

  const stop = useCallback(() => {
    runToken.current += 1;
    setRunningAll(false);
    const playing = source.current;
    source.current = null;
    if (playing) {
      try {
        playing.stop();
      } catch {
        /* Already finished. Stopping a stopped source is not an error here. */
      }
    }
    setTakes((all) => {
      const next: Record<string, TakeState> = {};
      for (const [id, state] of Object.entries(all)) {
        next[id] = state.kind === "playing" ? { kind: "ready", audit: state.audit } : state;
      }
      return next;
    });
  }, []);

  /** Render if needed, then play. Resolves when the sound has finished. */
  const sound = useCallback(
    async (takeId: string, token: number): Promise<void> => {
      const found = findTake(takeId);
      if (!found) return;

      let entry = cache.current.get(takeId);
      if (!entry) {
        setTakes((all) => ({ ...all, [takeId]: { kind: "rendering" } }));
        try {
          const rendered = await renderTake(songFor[takeId] ?? song, found.take);
          publishAudit(takeId, rendered.audit);
          const fault = clipFault(rendered.audit, found.clip.expects);
          if (fault !== null) {
            setTakes((all) => ({
              ...all,
              [takeId]: { kind: "faulty", reason: fault, audit: rendered.audit },
            }));
            return;
          }
          const ctx = (context.current ??= new AudioContext());
          const buffer = ctx.createBuffer(
            rendered.channels.length,
            rendered.channels[0]?.length ?? 0,
            rendered.sampleRate,
          );
          rendered.channels.forEach((channel, index) => {
            /* Copied into a buffer this context owns. The render's arrays are
               `ArrayBufferLike`, which `copyToChannel` will not take, and the
               copy is what makes the audio replayable without re-rendering. */
            buffer.copyToChannel(new Float32Array(channel), index);
          });
          entry = { buffer, audit: rendered.audit };
          cache.current.set(takeId, entry);
        } catch (error) {
          setTakes((all) => ({
            ...all,
            [takeId]: { kind: "failed", reason: String(error) },
          }));
          return;
        }
      }

      if (runToken.current !== token) return;
      const ready = entry;
      const ctx = (context.current ??= new AudioContext());
      await ctx.resume().catch(() => {});
      const node = ctx.createBufferSource();
      node.buffer = ready.buffer;
      node.connect(ctx.destination);
      source.current = node;
      setTakes((all) => ({ ...all, [takeId]: { kind: "playing", audit: ready.audit } }));

      await new Promise<void>((resolve) => {
        node.onended = () => resolve();
        node.start();
      });

      source.current = null;
      setTakes((all) => ({ ...all, [takeId]: { kind: "ready", audit: ready.audit } }));
    },
    [findTake, song, songFor],
  );

  const play = useCallback(
    (takeId: string) => {
      stop();
      runToken.current += 1;
      const token = runToken.current;
      void sound(takeId, token);
    },
    [sound, stop],
  );

  const playAll = useCallback(() => {
    stop();
    runToken.current += 1;
    const token = runToken.current;
    setRunningAll(true);
    void (async () => {
      for (const clip of clips) {
        for (const take of clip.takes) {
          if (runToken.current !== token) return;
          await sound(take.id, token);
        }
      }
      if (runToken.current === token) setRunningAll(false);
    })();
  }, [clips, sound, stop]);

  return {
    clips,
    fingerprint: support.fingerprint,
    title: support.title,
    answers,
    notes,
    note,
    takes,
    runningAll,
    play,
    playAll,
    stop,
    answer: (clipId, value) => setAnswers((all) => ({ ...all, [clipId]: value })),
    setNote: (clipId, value) => setNotes((all) => ({ ...all, [clipId]: value })),
    setFreeNote: setFreeNoteState,
  };
}
