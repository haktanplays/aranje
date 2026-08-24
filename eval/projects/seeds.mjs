/**
 * Device states the acceptance run starts from (2O-A §24).
 *
 * Written as the raw strings a device really holds, so a scenario begins the
 * way a reader's phone would rather than the way the app would like.
 */
const SONG_KEY = "aranje.song";
const CATALOG_KEY = "aranje.projects";
const payloadKey = (id) => `aranje.project.${id}`;

/** A small valid song, visibly not the sample. */
export const song = (title) => ({
  version: 2,
  title,
  bpm: 120,
  key: "E minor",
  tracks: [
    {
      id: "gtr",
      name: "Gitar",
      instrumentId: "electric_guitar",
      presetId: "clean",
      volumeDb: -6,
      fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
    },
  ],
  sections: [
    {
      id: "s1",
      name: "Bölüm 1",
      status: "fixed",
      bars: [
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] },
              null,
              { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] },
              null,
              null,
              null,
              null,
              null,
            ],
          },
        },
      ],
    },
  ],
});

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

/** A device that has only ever known the single song. */
export const legacyDevice = (title = "Eski Şarkı") => ({
  [SONG_KEY]: JSON.stringify(song(title)),
});

/** A device on the pre-library envelope. */
export const envelopeDevice = (title = "Zarflı Şarkı") => ({
  [SONG_KEY]: JSON.stringify({
    format: "aranje.song",
    version: 1,
    revision: 3,
    current: song(title),
    previous: song("Bir Önceki"),
  }),
});

/** A device whose current slot is broken and whose previous one is not. */
export const rescueDevice = () => ({
  [SONG_KEY]: JSON.stringify({
    format: "aranje.song",
    version: 1,
    revision: 3,
    current: { broken: true },
    previous: song("Kurtarılan"),
  }),
});

/** A library of `titles.length` projects, the first one open. */
export const libraryDevice = (titles, activeIndex = 0) => {
  const ids = titles.map((_, index) => `project-${index + 1}`);
  const seed = { [CATALOG_KEY]: catalog(ids, ids[activeIndex]) };
  titles.forEach((title, index) => {
    seed[payloadKey(ids[index])] = record(ids[index], song(title));
  });
  return seed;
};

export { SONG_KEY, CATALOG_KEY, payloadKey };
