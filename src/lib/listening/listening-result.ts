/**
 * The block the founder pastes back (2W §6).
 *
 * Short on purpose. The editor round produced a report with four isolation
 * domains, five ledger rows and thirteen three-line step records, because it
 * was measuring a machine. This one is measuring an ear, and an ear has one
 * answer per question.
 *
 * The rule the old report had to be corrected into having is here from the
 * start: **an unanswered question is `ölçülmedi`**, never an approval, never
 * blank, and never filled in from the fact that the clip rendered cleanly.
 */
import { archiveLines } from "@/lib/listening/founder-authority";
import { activeClips } from "@/lib/listening/listening-scope";
import type { ListeningClip } from "@/lib/listening/clip-plan";

export type ListeningAnswers = Readonly<Record<string, string | null | undefined>>;

export type ListeningNotes = Readonly<Record<string, string | undefined>>;

/**
 * The undecided answers, told apart (2V-C.2 §15).
 *
 * A card with a comment and no verdict is not the same as a card nobody
 * touched: the founder wrote something down and then did not commit to a
 * word. Reporting both as a bare "ölçülmedi" loses the sentence they took the
 * trouble to type, and reporting the comment as if it were a verdict invents
 * one. So it says both things.
 */
const UNMEASURED = "ölçülmedi";
const UNMEASURED_WITH_NOTE = "ölçülmedi — yorum var";

export function formatListeningResult(input: {
  readonly buildSha: string;
  readonly fingerprint: string;
  readonly clips: readonly ListeningClip[];
  readonly answers: ListeningAnswers;
  readonly notes: ListeningNotes;
  readonly note: string;
}): string {
  /*
   * Only this round's cards are counted (§4). The archive is printed below
   * as history, and it is not arithmetic the founder is being asked to do.
   */
  const asked = activeClips(input.clips);
  const lines = [`Build: ${input.buildSha}`, `Bu tur: ${asked.length} kart`, ""];

  for (const clip of asked) {
    const given = input.answers[clip.id];
    const note = (input.notes[clip.id] ?? "").trim();
    const decided = given !== undefined && given !== null && given !== "";
    const answer = decided
      ? given
      : note === ""
        ? UNMEASURED
        : UNMEASURED_WITH_NOTE;
    /* The clip's own title, from the one place it is written (§5). A second
       table of short names is how "L11 L11" came to be printed. */
    lines.push(`${clip.id} ${clip.label}: ${answer}${note === "" ? "" : ` — ${note}`}`);
  }

  const unanswered = asked.filter((clip) => {
    const given = input.answers[clip.id];
    return given === undefined || given === null || given === "";
  }).length;

  lines.push("", `Cevaplanmamış: ${unanswered}/${asked.length}`);
  const free = input.note.trim();
  if (free !== "") lines.push(`Not: ${free}`);

  /* The record, unchanged by anything this session did. */
  lines.push("", "Önceki turlar (kayıtlı):", ...archiveLines());
  /* The fingerprint last and plainly: it identifies the music, and it is not
     something the founder is being asked to check. */
  lines.push(`Parça: ${input.fingerprint}`);
  return lines.join("\n");
}
