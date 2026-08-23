/**
 * The list of projects, and what makes one readable (spec 13.21 §7, 2O-A).
 *
 * The catalog is **not** a Song and is deliberately not judged by the Song
 * Contract. It carries the order projects appear in, which one is open, and
 * the counter that names the next one — and nothing else. In particular it
 * carries **no title, no bar count and no track count**: those are facts about
 * music, they live in the Song, and a cached copy here would be a second
 * answer that goes stale the moment anyone edits. A project's name in the list
 * is its Song's `title`, read from the Song (2O-A §6).
 *
 * ## Reading is a pure decision
 *
 * `decideCatalog` takes the raw string and returns what it means. It touches
 * no storage, so every branch — including the ones that only happen after a
 * half-finished write — is exactly testable and always gives the same answer.
 *
 * ## The version is read before the shape
 *
 * The same rule the song envelope already follows: a future version may not
 * have this shape at all, so the tag is checked loosely first. A catalog from
 * a newer Aranje is "not ours to touch", never "corrupt" — quarantining it
 * would be this version destroying the newer one's work on the grounds that it
 * could not read it.
 *
 * ## What a valid catalog guarantees
 *
 * - at least one project, because the last one cannot be deleted (§2.13)
 * - no duplicate ids, so two entries can never name one payload
 * - the active id is one of them, so "which project is open" always has an
 *   answer that exists
 * - the counter clears every id present, so a number is never handed out
 *   twice — not even to replace a project that was deleted
 */
import { z } from "zod";

import {
  PROJECT_ID_PATTERN,
  highestProjectNumber,
  projectId,
} from "@/lib/projects/project-id";

export const PROJECT_CATALOG_FORMAT = "aranje.project-catalog";
export const PROJECT_CATALOG_VERSION = 1;

export type ProjectCatalogV1 = {
  readonly format: typeof PROJECT_CATALOG_FORMAT;
  readonly version: typeof PROJECT_CATALOG_VERSION;
  readonly activeProjectId: string;
  readonly projectIds: readonly string[];
  readonly nextProjectNumber: number;
};

/** Only the tag, loosely — "is this a catalog, and whose version?" */
const catalogTagSchema = z.object({
  format: z.literal(PROJECT_CATALOG_FORMAT),
  version: z.number().int().min(1),
});

const idSchema = z.string().regex(PROJECT_ID_PATTERN);

/**
 * The V1 shell, strict.
 *
 * An unknown key means a file this version does not understand rather than one
 * it can half-read, so nothing is silently dropped on the way in — or, worse,
 * silently dropped on the way out the next time it is written.
 */
const catalogShellSchema = z.strictObject({
  format: z.literal(PROJECT_CATALOG_FORMAT),
  version: z.literal(PROJECT_CATALOG_VERSION),
  activeProjectId: idSchema,
  projectIds: z.array(idSchema).min(1),
  nextProjectNumber: z.number().int().min(1),
});

/**
 * Why a catalog was refused, in a fixed order.
 *
 * Ordered so the same broken catalog always reports the same first reason —
 * a caller that logs "the first problem" must not get a different one on a
 * different run.
 */
export type CatalogIssue =
  | "not_json"
  | "not_a_catalog"
  | "shape_invalid"
  | "duplicate_project_id"
  | "active_project_missing"
  | "counter_would_reuse_an_id";

export type CatalogDecision =
  | { readonly kind: "empty" }
  | { readonly kind: "catalog"; readonly catalog: ProjectCatalogV1 }
  /** Unreadable. The payloads it named are **not** implicated (§9). */
  | { readonly kind: "invalid"; readonly issues: readonly CatalogIssue[] }
  | { readonly kind: "future_version"; readonly version: number };

/**
 * Check the things a schema cannot: relationships between the fields.
 *
 * Returned as a list rather than a first failure, so a caller rebuilding a
 * catalog can see everything wrong with it at once — but the list itself is
 * ordered, so "everything wrong with it" is the same list every time.
 */
function relationalIssues(catalog: ProjectCatalogV1): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (new Set(catalog.projectIds).size !== catalog.projectIds.length) {
    issues.push("duplicate_project_id");
  }
  if (!catalog.projectIds.includes(catalog.activeProjectId)) {
    issues.push("active_project_missing");
  }
  /*
   * The counter has to clear every id present, not merely be "not smaller":
   * a counter equal to the highest existing number would hand that number out
   * again, and the new project would be written to the key an existing one
   * already occupies.
   */
  if (catalog.nextProjectNumber <= highestProjectNumber(catalog.projectIds)) {
    issues.push("counter_would_reuse_an_id");
  }
  return issues;
}

export function decideCatalog(raw: string | null): CatalogDecision {
  if (raw === null) return { kind: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", issues: ["not_json"] };
  }

  const tag = catalogTagSchema.safeParse(parsed);
  if (!tag.success) return { kind: "invalid", issues: ["not_a_catalog"] };
  if (tag.data.version !== PROJECT_CATALOG_VERSION) {
    return { kind: "future_version", version: tag.data.version };
  }

  const shell = catalogShellSchema.safeParse(parsed);
  if (!shell.success) return { kind: "invalid", issues: ["shape_invalid"] };

  const catalog: ProjectCatalogV1 = {
    format: shell.data.format,
    version: shell.data.version,
    activeProjectId: shell.data.activeProjectId,
    projectIds: [...shell.data.projectIds],
    nextProjectNumber: shell.data.nextProjectNumber,
  };

  const issues = relationalIssues(catalog);
  return issues.length > 0 ? { kind: "invalid", issues } : { kind: "catalog", catalog };
}

/** The first catalog: one project, open, and a counter that clears it. */
export function initialCatalog(firstId: string): ProjectCatalogV1 {
  return {
    format: PROJECT_CATALOG_FORMAT,
    version: PROJECT_CATALOG_VERSION,
    activeProjectId: firstId,
    projectIds: [firstId],
    nextProjectNumber: highestProjectNumber([firstId]) + 1,
  };
}

/**
 * The id the next project will take, and the catalog that has handed it out.
 *
 * One function, because the two must not be able to disagree: a caller that
 * took an id without advancing the counter would give the same id to the next
 * project as well.
 */
export function allocateProjectId(catalog: ProjectCatalogV1): {
  readonly id: string;
  readonly catalog: ProjectCatalogV1;
} {
  const number = Math.max(
    catalog.nextProjectNumber,
    highestProjectNumber(catalog.projectIds) + 1,
  );
  return {
    id: projectId(number),
    catalog: { ...catalog, nextProjectNumber: number + 1 },
  };
}

/** Serialize deterministically: the same catalog is always the same bytes. */
export function serializeCatalog(catalog: ProjectCatalogV1): string {
  return JSON.stringify({
    format: catalog.format,
    version: catalog.version,
    activeProjectId: catalog.activeProjectId,
    projectIds: [...catalog.projectIds],
    nextProjectNumber: catalog.nextProjectNumber,
  });
}

/**
 * Rebuild a catalog from ids that were actually found on disk.
 *
 * The repair path for a catalog that could not be read. It is given the ids
 * whose payloads **verified**, never a guess: a catalog that named a project
 * with no payload behind it would be a list that points at nothing, which is
 * the failure it exists to prevent.
 */
export function rebuildCatalog(
  verifiedIds: readonly string[],
  preferredActiveId: string | null,
): ProjectCatalogV1 | null {
  const ids = [...verifiedIds];
  if (ids.length === 0) return null;
  const active =
    preferredActiveId !== null && ids.includes(preferredActiveId)
      ? preferredActiveId
      : (ids[0] as string);
  return {
    format: PROJECT_CATALOG_FORMAT,
    version: PROJECT_CATALOG_VERSION,
    activeProjectId: active,
    projectIds: ids,
    nextProjectNumber: highestProjectNumber(ids) + 1,
  };
}
