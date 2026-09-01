/**
 * Tasks bound to the song, and events bound to the task (2V-B.1 §12, §13).
 */
import { describe, expect, it } from "vitest";

import { BATCH_STEPS, type BatchStep } from "@/lib/acceptance/batch-steps";
import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { songSupport } from "@/lib/acceptance/song-support";
import {
  describeTask,
  judgeWorkspaceEvent,
  type TaskDescriptor,
} from "@/lib/acceptance/task-descriptor";
import { songFingerprint, type WorkspaceEdit } from "@/lib/song/workspace-events";
import type { Song } from "@/lib/song/schema";

const support = () => songSupport(editorFixture());
const stepOf = (id: string): BatchStep => {
  const found = BATCH_STEPS.find((step) => step.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
};

function envelopeFor(id: string, song: Song = editorFixture()) {
  return describeTask({
    step: stepOf(id),
    support: songSupport(song),
    buildSha: "abc1234",
    sessionId: "2vb1-test",
    songFingerprint: songSupport(song).fingerprint,
    revision: 1,
  });
}

describe("what the fixture supports", () => {
  it("finds every passage the round needs, by reading the plan", () => {
    const found = support();
    expect(found.title).toBe("Editör kabul parçası");
    expect(found.heldPowerChord).not.toBeNull();
    expect(found.slide).not.toBeNull();
    expect(found.vibrato).not.toBeNull();
    expect(found.legato).not.toBeNull();
    expect(found.sharedBar).not.toBeNull();
    expect(found.firstWrittenBar).not.toBeNull();
  });

  it("names the slide the way a guitarist would say it", () => {
    const slide = support().slide!;
    expect(slide.stringName).toBe("Re");
    expect(slide.fromFret).toBe(5);
    expect(slide.toFret).toBe(7);
    expect(slide.trackName).toBe("Gitar");
  });

  it("names both instruments of the shared bar", () => {
    const shared = support().sharedBar!;
    expect(shared.trackNames.length).toBeGreaterThanOrEqual(2);
    expect(shared.trackNames).toContain("Gitar");
    expect(shared.trackNames).toContain("Bas");
  });

  it("finds nothing in a song that has none of it", () => {
    /* An empty song supports no question at all, which is the point: the
       analyser reads the music rather than remembering the fixture. */
    const empty: Song = {
      ...editorFixture(),
      sections: [{ id: "s1", name: "Boş", status: "fixed", bars: [] }],
    };
    const found = songSupport(empty);
    expect(found.firstWrittenBar).toBeNull();
    expect(found.slide).toBeNull();
    expect(found.vibrato).toBeNull();
    expect(found.legato).toBeNull();
    expect(found.sharedBar).toBeNull();
  });
});

describe("generating the instruction from the descriptor", () => {
  it("says the section, the track and the bar the reader is looking at", () => {
    const envelope = envelopeFor("duplicate");
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const { descriptor } = envelope;
    expect(descriptor.songTitle).toBe("Editör kabul parçası");
    expect(descriptor.sectionName).toBe("Kabul");
    expect(descriptor.trackName).toBeTruthy();
    expect(descriptor.task).toContain(descriptor.sectionName);
    expect(descriptor.task).toContain(descriptor.trackName);
    expect(descriptor.task).toContain(`${descriptor.barNumber}. ölçü`);
  });

  it("names the real string and frets in the pause task", () => {
    const envelope = envelopeFor("pauseResume");
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    /* The example §12 gives, generated rather than typed. */
    expect(envelope.descriptor.task).toContain("Re telindeki 5→7 slide");
    expect(envelope.descriptor.task).toContain("duraklat");
  });

  it("asks the delete step in the exact words the round specified", () => {
    const envelope = envelopeFor("deleteUndo");
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    /*
     * The two sentences §14 fixes, word for word and in order. The redo that
     * follows them is what gives the delete row of the ledger its `redoHash`
     * (§5); it is one more press, not a rewrite of the question — and the
     * question itself is asserted separately in `batch-steps.test.ts`.
     */
    expect(envelope.descriptor.task).toContain(
      "Seçili notaları sil. Notalar kaybolunca Geri al'a dokun. Aynı notalar aynı yere geri geldi mi?",
    );
    expect(envelope.descriptor.task.startsWith("Seçili notaları sil.")).toBe(true);
  });

  it("asks 11A about a track row and 11B about a measure heading", () => {
    const a = envelopeFor("trackScope");
    const b = envelopeFor("measureScope");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.descriptor.task).toContain("satırındaki");
    expect(a.descriptor.task).toContain("Seçimi dinle");
    expect(b.descriptor.task).toContain("ölçü başlığına");
    expect(b.descriptor.task).toContain("Seçimi dinle");
    /* And the second one names both instruments, from the Song. */
    expect(b.descriptor.task).toContain("Gitar");
    expect(b.descriptor.task).toContain("Bas");
  });

  it("carries the required production action for a writing step", () => {
    for (const [id, action] of [
      ["copyPaste", "paste"],
      ["duplicate", "duplicate"],
      ["move", "move"],
      ["repeat", "repeat"],
      ["deleteUndo", "delete"],
    ] as const) {
      const envelope = envelopeFor(id);
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      expect(envelope.descriptor.requiredAction).toBe(action);
    }
  });

  it("refuses rather than asks when the Song has no such passage", () => {
    const oneTrack: Song = {
      ...editorFixture(),
      tracks: editorFixture().tracks.slice(0, 1),
      sections: editorFixture().sections.map((section) => ({
        ...section,
        bars: section.bars.map((bar) => ({
          ...bar,
          slots: { gtr: bar.slots.gtr ?? [] },
        })),
      })),
    };
    const envelope = envelopeFor("measureScope", oneTrack);
    expect(envelope.ok).toBe(false);
    if (envelope.ok) return;
    /* Typed, not a sentence, and not a question nobody could answer. */
    expect(envelope.reason).toBe("no_shared_bar");
  });
});

describe("which production events satisfy a task", () => {
  const descriptor: TaskDescriptor = {
    stepId: "duplicate",
    buildSha: "abc1234",
    sessionId: "2vb1-test",
    songFingerprint: "s10hx",
    songTitle: "T",
    sectionId: "s1",
    sectionName: "Kabul",
    barKey: "s1:0",
    barNumber: 1,
    trackId: "gtr",
    trackName: "Gitar",
    selection: "Gitar · 1. ölçü",
    requiredAction: "duplicate",
    expectedRevision: 2,
    task: "…",
  };
  const stamp = { buildSha: "abc1234", sessionId: "2vb1-test", revision: 2 };
  const edit: WorkspaceEdit = {
    action: "duplicate",
    scope: "notes",
    mutating: true,
    songBefore: "s10hx",
    songAfter: "s11hy",
    sectionId: "s1",
    trackIds: ["gtr"],
    startTicks: 0,
    endTicks: 192,
    barKeys: [],
  };

  it("accepts the event the task asked for, and names the next link", () => {
    const verdict = judgeWorkspaceEvent({ descriptor, edit, stamp });
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.nextFingerprint).toBe("s11hy");
  });

  it("refuses an event from another build", () => {
    expect(
      judgeWorkspaceEvent({ descriptor, edit, stamp: { ...stamp, buildSha: "zzz" } }),
    ).toEqual({ accepted: false, refusal: "wrong_build" });
  });

  it("refuses an event from another session", () => {
    expect(
      judgeWorkspaceEvent({ descriptor, edit, stamp: { ...stamp, sessionId: "other" } }),
    ).toEqual({ accepted: false, refusal: "wrong_session" });
  });

  it("refuses an event about a Song the chain has moved past", () => {
    expect(
      judgeWorkspaceEvent({
        descriptor,
        edit: { ...edit, songBefore: "s99hold" },
        stamp,
      }),
    ).toEqual({ accepted: false, refusal: "wrong_song" });
  });

  it("refuses an action the step did not ask for", () => {
    expect(
      judgeWorkspaceEvent({ descriptor, edit: { ...edit, action: "delete" }, stamp }),
    ).toEqual({ accepted: false, refusal: "wrong_action" });
  });

  it("refuses an event about another track", () => {
    expect(
      judgeWorkspaceEvent({ descriptor, edit: { ...edit, trackIds: ["bass"] }, stamp }),
    ).toEqual({ accepted: false, refusal: "wrong_track" });
  });

  it("refuses a measure event about another bar", () => {
    expect(
      judgeWorkspaceEvent({
        descriptor,
        edit: { ...edit, scope: "measures", barKeys: ["s1:3"] },
        stamp,
      }),
    ).toEqual({ accepted: false, refusal: "wrong_bar" });
  });

  it("refuses an event whose record has not caught up", () => {
    expect(
      judgeWorkspaceEvent({ descriptor, edit, stamp: { ...stamp, revision: 1 } }),
    ).toEqual({ accepted: false, refusal: "stale_revision" });
  });

  it("lets no event satisfy a reading step", () => {
    /* A listening step has nothing for the editor to do, so no event — not
       even a well-formed one — may advance it (§13). */
    expect(
      judgeWorkspaceEvent({
        descriptor: { ...descriptor, requiredAction: null },
        edit,
        stamp,
      }),
    ).toEqual({ accepted: false, refusal: "wrong_step" });
  });
});

describe("the fingerprint chain", () => {
  it("moves with each accepted action", () => {
    const first = songFingerprint(editorFixture());
    const changed: Song = { ...editorFixture(), bpm: 120 };
    const second = songFingerprint(changed);
    expect(second).not.toBe(first);

    const descriptor: TaskDescriptor = {
      stepId: "move",
      buildSha: "b",
      sessionId: "s",
      songFingerprint: first,
      songTitle: "T",
      sectionId: "s1",
      sectionName: "Kabul",
      barKey: "s1:0",
      barNumber: 1,
      trackId: "gtr",
      trackName: "Gitar",
      selection: "—",
      requiredAction: "move",
      expectedRevision: 1,
      task: "…",
    };
    const verdict = judgeWorkspaceEvent({
      descriptor,
      edit: {
        action: "move",
        scope: "notes",
        mutating: true,
        songBefore: first,
        songAfter: second,
        sectionId: "s1",
        trackIds: ["gtr"],
        startTicks: 0,
        endTicks: 192,
        barKeys: [],
      },
      stamp: { buildSha: "b", sessionId: "s", revision: 1 },
    });
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.nextFingerprint).toBe(second);

    /* And the next task, bound to that link, refuses the old event. */
    const next = { ...descriptor, songFingerprint: verdict.nextFingerprint };
    expect(
      judgeWorkspaceEvent({
        descriptor: next,
        edit: {
          action: "move",
          scope: "notes",
          mutating: true,
          songBefore: first,
          songAfter: second,
          sectionId: "s1",
          trackIds: ["gtr"],
          startTicks: 0,
          endTicks: 192,
          barKeys: [],
        },
        stamp: { buildSha: "b", sessionId: "s", revision: 1 },
      }),
    ).toEqual({ accepted: false, refusal: "wrong_song" });
  });
});
