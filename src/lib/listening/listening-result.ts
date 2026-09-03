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
import type { ListeningClip } from "@/lib/listening/clip-plan";

export type ListeningAnswers = Readonly<Record<string, string | null | undefined>>;

export type ListeningNotes = Readonly<Record<string, string | undefined>>;

/** Short labels for the paste block, so a line fits on a phone. */
const SHORT: Readonly<Record<string, string>> = {
  L1: "Gitar",
  L2: "Bas",
  L3: "Orta başlangıç",
  L4: "Resume",
  L5: "Slide",
  L6: "Vibrato",
  L7: "HO/PO",
  L8: "Power/Akor",
  L9: "Loop dönüşü",
  L10: "Hızlı dizi",
};

export function formatListeningResult(input: {
  readonly buildSha: string;
  readonly fingerprint: string;
  readonly clips: readonly ListeningClip[];
  readonly answers: ListeningAnswers;
  readonly notes: ListeningNotes;
  readonly note: string;
}): string {
  const lines = [`Build: ${input.buildSha}`];

  for (const clip of input.clips) {
    const given = input.answers[clip.id];
    const answer = given === undefined || given === null || given === "" ? "ölçülmedi" : given;
    const note = (input.notes[clip.id] ?? "").trim();
    const short = SHORT[clip.id] ?? clip.id;
    lines.push(`${clip.id} ${short}: ${answer}${note === "" ? "" : ` — ${note}`}`);
  }

  const unanswered = input.clips.filter((clip) => {
    const given = input.answers[clip.id];
    return given === undefined || given === null || given === "";
  }).length;

  lines.push("", `Cevaplanmamış: ${unanswered}/${input.clips.length}`);
  const free = input.note.trim();
  if (free !== "") lines.push(`Not: ${free}`);
  /* The fingerprint last and plainly: it identifies the music, and it is not
     something the founder is being asked to check. */
  lines.push(`Parça: ${input.fingerprint}`);
  return lines.join("\n");
}
