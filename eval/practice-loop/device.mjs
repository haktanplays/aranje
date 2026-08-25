/**
 * Turning the 2R-A fixtures into what a reader's phone would hold.
 *
 * The storage shapes come from the shared project-storage helper's contract,
 * exactly as every other harness since K-52; the songs come from
 * `fixtures.json`, which `make-fixtures.ts` writes only after the strict
 * schema and the central validator chain have accepted them.
 */
import { readFileSync } from "node:fs";

export const CATALOG_KEY = "aranje.projects";
export const payloadKey = (id) => `aranje.project.${id}`;

const SONGS = JSON.parse(
  readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"),
);

export function fixture(name) {
  const song = SONGS[name];
  if (!song) {
    throw new Error(`no fixture "${name}" — have ${Object.keys(SONGS).join(", ")}`);
  }
  return structuredClone(song);
}

export const FIXTURE_NAMES = Object.keys(SONGS);

const record = (id, body, revision = 1, version = 1) =>
  JSON.stringify({
    format: "aranje.project-record",
    version,
    projectId: id,
    revision,
    updatedAt: 1_700_000_000_000,
    current: body,
    previous: null,
  });

const catalog = (ids, activeId, next = ids.length + 1) =>
  JSON.stringify({
    format: "aranje.project-catalog",
    version: 1,
    activeProjectId: activeId,
    projectIds: ids,
    nextProjectNumber: next,
  });

/** One project. */
export const device = (body, id = "project-1") => ({
  [payloadKey(id)]: record(id, body),
  [CATALOG_KEY]: catalog([id], id),
});

/**
 * Two projects, the second one active.
 *
 * For the claims that are about *another* project staying byte-identical while
 * this one is edited — a claim that cannot be made with one project on the
 * device.
 */
export const twoProjects = (active, other) => ({
  [payloadKey("project-1")]: record("project-1", other),
  [payloadKey("project-2")]: record("project-2", active),
  [CATALOG_KEY]: catalog(["project-1", "project-2"], "project-2", 3),
});

export const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "320x700", width: 320, height: 700 },
];

/** The text scales a phone's accessibility setting really produces. */
export const TEXT_SCALES = [100, 125, 150];
