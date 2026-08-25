/**
 * Turning the generated fixtures into what a reader's phone would hold, and
 * into the file they would open.
 *
 * The songs come from `fixtures/songs.json`, which `make-fixtures.ts` writes
 * only after the strict schema, the central validator chain and the
 * production export gate have all accepted them. Nothing here builds music.
 */
import { readFileSync } from "node:fs";

export const CATALOG_KEY = "aranje.projects";
export const payloadKey = (id) => `aranje.project.${id}`;

const SONGS = JSON.parse(
  readFileSync(new URL("./fixtures/songs.json", import.meta.url), "utf8"),
);

export function fixture(name) {
  const song = SONGS[name];
  if (!song) {
    throw new Error(`no fixture "${name}" — have ${Object.keys(SONGS).join(", ")}`);
  }
  return structuredClone(song);
}

/** The bytes of a real .aranje.json, as written by the production exporter. */
export const fileFor = (name) =>
  readFileSync(new URL(`./fixtures/${name}.aranje.json`, import.meta.url), "utf8");

export const filePath = (name) =>
  new URL(`./fixtures/${name}.aranje.json`, import.meta.url).pathname;

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

/** A device holding one project with the given song. */
export const device = (body, id = "project-1") => ({
  [payloadKey(id)]: record(id, body),
  [CATALOG_KEY]: catalog([id], id),
});
