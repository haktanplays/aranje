/**
 * Device states the chord acceptance run starts from (2O-B §26).
 *
 * Raw strings, exactly as a reader's phone would hold them, so a scenario
 * begins where a real session begins.
 */
const CATALOG_KEY = "aranje.projects";
const payloadKey = (id) => `aranje.project.${id}`;

const E_STANDARD = ["E2", "A2", "D3", "G3", "B3", "E4"];
const DROP_D = ["D2", "A2", "D3", "G3", "B3", "E4"];
const DADGAD = ["D2", "A2", "D3", "G3", "A3", "D4"];
const BASS = ["E1", "A1", "D2", "G2"];

/**
 * The guitar the scenarios use.
 *
 * `high_gain` rather than `clean`, and that is not a detail: `clean` is what
 * every launch template hands a new reader, and it has **no vendored sample
 * pack**, so a track on it makes no sound at all. A scenario that seeded it
 * and then asked "did the audition sound?" would have measured silence and
 * called it a pass. That defect is reported in FINDINGS.json and belongs to
 * the templates; here the seed uses a preset that can actually be heard, so
 * the audio scenarios measure the chord builder rather than the gap.
 */
export const guitarTrack = (overrides = {}) => ({
  id: "gtr",
  name: "Gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: [...E_STANDARD], capo: 0 },
  ...overrides,
});

export const bassTrack = () => ({
  id: "bass",
  name: "Bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -6,
  fretboard: { tuning: [...BASS], capo: 0 },
});

/** A pitched instrument with no fretboard: phase-2.5 scope, no sample pack. */
/*
 * The name is a real reader-chosen one, not the instrument id. A fixture that
 * named the track "piano" would make the "no technical id on screen" check
 * pass or fail on the fixture rather than on the app.
 */
const KEYBOARD_NAMES = {
  piano: "Piyano",
  electric_piano: "Elektro Piyano",
  organ: "Org",
  synth: "Synth Katman",
  strings: "Yaylılar",
};

export const keyboardTrack = (instrumentId, presetId) => ({
  id: instrumentId,
  name: KEYBOARD_NAMES[instrumentId] ?? "Klavye",
  instrumentId,
  presetId,
  volumeDb: -6,
});

export const dropDTrack = () =>
  guitarTrack({ fretboard: { tuning: [...DROP_D], capo: 0 } });
export const capoTrack = (capo = 2) =>
  guitarTrack({ fretboard: { tuning: [...E_STANDARD], capo } });
export const dadgadTrack = () =>
  guitarTrack({ fretboard: { tuning: [...DADGAD], capo: 0 } });
export const drumTrack = () => ({
  id: "drums",
  name: "Davul",
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -6,
});

const emptySlots = (count) => Array.from({ length: count }, () => null);

export const song = (tracks, options = {}) => ({
  version: 2,
  title: options.title ?? "Akor Testi",
  bpm: 120,
  key: "E minor",
  tracks,
  sections: [
    {
      id: "s1",
      name: "Bölüm 1",
      status: "fixed",
      bars: Array.from({ length: options.bars ?? 2 }, () => ({
        timeSignature: [4, 4],
        resolution: options.resolution ?? 8,
        slots: Object.fromEntries(
          tracks.map((track) => [track.id, emptySlots(options.resolution ?? 8)]),
        ),
      })),
    },
  ],
});

/** Put notes into the first slot of bar one, for the occupied-target cases. */
export const withNotes = (base, trackId, notes, tail = 0) => {
  const next = structuredClone(base);
  const slots = next.sections[0].bars[0].slots[trackId];
  slots[0] = { notes };
  for (let index = 1; index <= tail; index += 1) slots[index] = "-";
  return next;
};

export const record = (id, body, revision = 1, version = 1) =>
  JSON.stringify({
    format: "aranje.project-record",
    version,
    projectId: id,
    revision,
    updatedAt: 1_700_000_000_000,
    current: body,
    previous: null,
  });

export const catalog = (ids, activeId, next = ids.length + 1) =>
  JSON.stringify({
    format: "aranje.project-catalog",
    version: 1,
    activeProjectId: activeId,
    projectIds: ids,
    nextProjectNumber: next,
  });

/** A device holding one project with the given song. */
export const device = (body, id = "project-1") => ({
  [payloadKey(id)]: record(id, body),
  [CATALOG_KEY]: catalog([id], id),
});

/** A device holding two projects, so isolation can be measured. */
export const twoProjects = (first, second) => ({
  [payloadKey("project-1")]: record("project-1", first),
  [payloadKey("project-2")]: record("project-2", second),
  [CATALOG_KEY]: catalog(["project-1", "project-2"], "project-1", 3),
});

export { CATALOG_KEY, payloadKey };
