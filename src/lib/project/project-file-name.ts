/**
 * The name an exported project file is offered under (spec 13.15, 2L-A).
 *
 * One pure helper, so no component carries a regex or its own opinion about
 * what a filesystem accepts. The title is the musician's; the cleaning removes
 * only what a download would choke on, and Unicode survives — a song called
 * "Gece Yürüyüşü" downloads as itself, not as an ASCII shadow of itself.
 */
import { BRAND_SLUG } from "@/lib/brand";
import { projectFileLimits } from "@/lib/limits";

export const PROJECT_FILE_EXTENSION = `.${BRAND_SLUG}.json`;
export const PROJECT_FILE_MIME = "application/json";

/** The stem used when a title cleans down to nothing. */
export const FALLBACK_FILE_STEM = `${BRAND_SLUG}-proje`;

/*
 * Characters no download name may carry: path separators, wildcards, quotes
 * and the rest of the set every major filesystem reserves, plus `%` because a
 * name that looks percent-encoded gets mangled by things that try to decode it.
 */
const FORBIDDEN = /[/\\?%*:|"<>]/g;
const CONTROL = /[\u0000-\u001F\u007F]/g;

/**
 * `<safe-title>.aranje.json`.
 *
 * Order matters: whitespace collapses first (a tab is both whitespace and a
 * control character, and it should read as a separator, not vanish), the
 * remaining control and forbidden characters are stripped (so a title of
 * `///` becomes empty and takes the fallback), and leading/trailing dots,
 * spaces and hyphens are trimmed last — a name that begins with a dot is a
 * hidden file on half the world's machines.
 */
export function projectFileName(title: string): string {
  const cleaned = title
    .replace(/\s+/g, "-")
    .replace(CONTROL, "")
    .replace(FORBIDDEN, "")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, projectFileLimits.maxFileNameChars)
    // The cut may have exposed a new trailing dot or hyphen; trim once more.
    .replace(/[-. ]+$/g, "");

  return `${cleaned === "" ? FALLBACK_FILE_STEM : cleaned}${PROJECT_FILE_EXTENSION}`;
}
