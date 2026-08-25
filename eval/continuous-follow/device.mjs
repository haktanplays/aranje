/**
 * Turning the generated fixtures into what a reader's phone would hold.
 *
 * The songs come from `fixtures.json`, which `make-fixtures.ts` writes only
 * after the strict schema and the central validator chain have accepted them.
 * Nothing here builds music, and nothing here knows a storage key the product
 * does not — the shapes come from the shared project-storage helper.
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

export const device = (body, id = "project-1") => ({
  [payloadKey(id)]: record(id, body),
  [CATALOG_KEY]: catalog([id], id),
});

export const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "320x700", width: 320, height: 700 },
];
