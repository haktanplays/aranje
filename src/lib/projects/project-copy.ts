/**
 * The Turkish the project library shows (spec 13.21 §17, 2O-A).
 *
 * One table, so the same fact is worded the same way wherever it appears, and
 * so a component never builds a sentence out of a code. Everything here is
 * about the reader's music: how many sections it has, what deleting it means.
 * Nothing here names a storage key, a project id, a schema or an exception.
 */
import { BRAND_NAME } from "@/lib/brand";
import type { ProjectSummary } from "@/lib/projects/project-summary";

/** "4 bölüm · 32 ölçü · 8 track", or what can honestly be said instead. */
export function projectShape(summary: ProjectSummary): string {
  if (summary.health === "future_version") {
    // The brand is interpolated so source files stay ASCII (spec 1.4).
    return `Bu proje daha yeni bir ${BRAND_NAME} sürümüyle kaydedilmiş.`;
  }
  if (summary.health === "unreadable") {
    return "Bu projenin kaydı açılamadı.";
  }
  const parts = [
    `${summary.sectionCount ?? 0} bölüm`,
    `${summary.barCount ?? 0} ölçü`,
    `${summary.trackCount ?? 0} track`,
  ];
  return parts.join(" · ");
}

/**
 * When a project was last saved, in words a phone can show.
 *
 * Locale-safe: the browser formats it, this only decides how much of it to
 * say. Null when nothing recorded a time — a guessed date would be worse than
 * no date, because it looks exactly like a real one.
 */
export function projectWhen(
  summary: ProjectSummary,
  now: number,
  locale = "tr-TR",
): string | null {
  if (summary.updatedAt === null) return null;
  const when = new Date(summary.updatedAt);
  const sameDay = new Date(now).toDateString() === when.toDateString();
  try {
    return sameDay
      ? `Bugün ${when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`
      : when.toLocaleDateString(locale, { day: "numeric", month: "long" });
  } catch {
    return null;
  }
}

/** The name a project goes by. Its song's title, and nothing else. */
export function projectName(summary: ProjectSummary): string {
  return summary.title ?? "Adsız proje";
}

/**
 * What a screen reader is told about a row.
 *
 * "Aç" on its own is useless in a list of eight projects: the name has to be
 * part of the control's own name, not merely next to it.
 */
export function projectRowLabel(summary: ProjectSummary): string {
  const open = summary.isActive ? ", açık" : "";
  return `${projectName(summary)}${open}. ${projectShape(summary)}`;
}

/** The sentence above the delete buttons. Says what goes, and that it stays gone. */
export function deleteConfirmation(summary: ProjectSummary): string {
  return (
    `"${projectName(summary)}" projesi silinecek.\n\n${projectShape(summary)}\n\n` +
    "Bu işlem şarkı geçmişinden geri alınamaz. " +
    "İstersen silmeden önce projeyi yedekleyebilirsin."
  );
}
