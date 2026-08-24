/**
 * Turning a generated fixture into the bytes a reader's phone would hold.
 *
 * The songs come from `seeds.json`, which `make-seeds.ts` writes only after
 * the strict schema and the central validator chain have both accepted them.
 * Nothing here builds music.
 */
import { readFileSync } from "node:fs";

export const CATALOG_KEY = "aranje.projects";
export const payloadKey = (id) => `aranje.project.${id}`;

const SEEDS = JSON.parse(
  readFileSync(new URL("./seeds.json", import.meta.url), "utf8"),
);

/** One of the generated fixtures, by name. Throws rather than returning junk. */
export function seed(name) {
  const song = SEEDS[name];
  if (!song) {
    throw new Error(`no fixture "${name}" — have ${Object.keys(SEEDS).join(", ")}`);
  }
  return structuredClone(song);
}

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
