/**
 * What Home shows, decided without a screen (2V-E.1 §4).
 *
 * Home has two states and the difference between them is not cosmetic: a
 * device with nothing on it is being asked *one* question, and a device with
 * projects on it is being asked which one. Deciding that here rather than in
 * the component means the empty state can be tested without a browser, and
 * that the two states cannot drift into a third that shows both.
 *
 * ## What a card may say
 *
 * The name, the key, the tempo, the metre, how many instruments, how many
 * sections, and when it was last touched. Nothing else — and specifically not
 * the project id, its revision, its storage key or a hash. Those are how the
 * app finds the music; they are not what the music is, and a reader who sees
 * `project-3` on a card learns something true about the implementation and
 * nothing at all about their song.
 */
import { projectShape, projectWhen } from "@/lib/projects/project-copy";
import type { ProjectSummary } from "@/lib/projects/project-summary";

export type HomeCard = {
  readonly id: string;
  readonly title: string;
  /** "E minor · 120 BPM · 4/4", or null when the song could not be read. */
  readonly musicLine: string | null;
  /** "1 bölüm · 4 ölçü · 1 track", or the sentence that says why not. */
  readonly shapeLine: string;
  /** "Bugün 22:14", or null when nothing recorded a time. */
  readonly whenLine: string | null;
  /** True for the project the app currently has open. */
  readonly isActive: boolean;
  /** True when opening it will not work; the row says so instead of lying. */
  readonly unreadable: boolean;
  /** What a screen reader is told, since "Aç" alone names nothing. */
  readonly label: string;
};

export type HomeModel =
  | {
      readonly kind: "empty";
      /** The one thing to do, and the one sentence explaining why. */
      readonly cta: string;
      readonly blurb: string;
    }
  | {
      readonly kind: "library";
      /** The project the reader was last in, first and on its own. */
      readonly recent: HomeCard | null;
      /** Everything else, newest first. */
      readonly others: readonly HomeCard[];
      readonly cta: string;
    };

export const NEW_SONG_CTA = "Yeni parça";
export const EMPTY_HOME_BLURB =
  "İlk riffini yaz, enstrümanları ekle ve parçanı dinle.";

function musicLine(summary: ProjectSummary): string | null {
  if (summary.key === null || summary.bpm === null) return null;
  const parts = [summary.key, `${summary.bpm} BPM`];
  if (summary.meter !== null) parts.push(summary.meter);
  return parts.join(" · ");
}

function toCard(summary: ProjectSummary, now: number): HomeCard {
  const title = summary.title ?? "Adsız parça";
  const shapeLine = projectShape(summary);
  const whenLine = projectWhen(summary, now);
  return {
    id: summary.id,
    title,
    musicLine: musicLine(summary),
    shapeLine,
    whenLine,
    isActive: summary.isActive,
    unreadable: summary.health !== "ok",
    label: `${title}. ${shapeLine}${whenLine === null ? "" : `. ${whenLine}`}`,
  };
}

/**
 * Home, from the library the controller already has.
 *
 * `now` is injected for the same reason the library sheet injects it: "Bugün"
 * is a fact about when the screen was opened, and reading a clock during
 * render would change the answer underneath a reader who is scrolling.
 */
export function homeModel(
  projects: readonly ProjectSummary[],
  now: number,
): HomeModel {
  if (projects.length === 0) {
    return { kind: "empty", cta: NEW_SONG_CTA, blurb: EMPTY_HOME_BLURB };
  }

  const cards = projects.map((summary) => toCard(summary, now));
  const active = cards.find((card) => card.isActive) ?? null;
  /*
   * "Son çalıştığın" is the open project when there is one, and otherwise the
   * most recently saved. Not simply "the first in the catalog": the catalog is
   * in creation order, which stops being the order a reader thinks in as soon
   * as they go back to something older.
   */
  const byRecency = [...cards].sort(
    (a, b) => rank(b, projects) - rank(a, projects),
  );
  const recent = active ?? byRecency[0] ?? null;
  const others = byRecency.filter((card) => card.id !== recent?.id);
  return { kind: "library", recent, others, cta: NEW_SONG_CTA };
}

function rank(card: HomeCard, projects: readonly ProjectSummary[]): number {
  return projects.find((entry) => entry.id === card.id)?.updatedAt ?? 0;
}
