"use client";

/**
 * The founder's whole job, on one screen (2W §3, §6).
 *
 * ## What this page is not
 *
 * It is not a test. There is no step counter, no gate, no disabled "next", no
 * required order and no way to get stuck — the four things that turned the
 * editor acceptance round into work. Nothing here has to be completed, and a
 * partial answer set copies out as a partial answer set rather than as a
 * failure.
 *
 * ## What it is
 *
 * Eight short clips, each with a question, played through the real production
 * engine. Tap once to hear one; tap the button at the top to hear them all in
 * order. Answer the ones you have an opinion about. Copy the block.
 *
 * The founder is expected to be done in three to five minutes.
 */
import { useState } from "react";

import { BUILD_SHA, shortSha } from "@/lib/acceptance/build-id";
import { BRAND_NAME } from "@/lib/brand";
import { SAMPLE_LICENSE } from "@/lib/audio/packs";
import { formatListeningResult } from "@/lib/listening/listening-result";
import {
  FOUNDER_AUTHORITY,
  VERDICT_LABEL,
} from "@/lib/listening/founder-authority";
import { activeClips } from "@/lib/listening/listening-scope";
import { useListeningPack, type TakeState } from "@/components/listening/useListeningPack";

/** Everything a finger has to hit is at least this tall (2W §3). */
const TOUCH = 44;

/** What a take's state says on its button. */
function takeLabel(state: TakeState | undefined, name: string): string {
  switch (state?.kind) {
    case "rendering":
      return "Hazırlanıyor…";
    case "playing":
      return "Çalıyor…";
    case "ready":
      return `${name} · tekrar`;
    case "faulty":
      return `${name} · ${state.reason}`;
    case "failed":
      return `${name} · açılamadı`;
    default:
      return name;
  }
}

function TakeButton({
  id,
  name,
  state,
  onPlay,
}: {
  id: string;
  name: string;
  state: TakeState | undefined;
  onPlay(): void;
}) {
  const broken = state?.kind === "faulty" || state?.kind === "failed";
  const busy = state?.kind === "rendering";
  return (
    <button
      type="button"
      data-listen-take={id}
      data-listen-state={state?.kind ?? "idle"}
      onClick={onPlay}
      disabled={busy}
      style={{ minHeight: TOUCH }}
      className={`flex-1 rounded-lg border px-3 text-sm font-medium transition-colors ${
        broken
          ? "border-reject/50 text-reject"
          : state?.kind === "playing"
            ? "border-bronze bg-bronze/20 text-bronze"
            : "border-bronze/60 bg-bronze/10 text-bronze active:bg-bronze/25"
      } ${busy ? "opacity-60" : ""}`}
    >
      {takeLabel(state, name)}
    </button>
  );
}

export function ListeningPackPage() {
  const pack = useListeningPack();
  const [copied, setCopied] = useState(false);
  /*
   * This round's cards, and only those (2V-C.2 §4). Everything older has a
   * recorded physical result and is shown below as the record it is — a
   * browser session cannot answer it and is not asked to.
   */
  const asked = activeClips(pack.clips);
  const decided = asked.filter((clip) => {
    const answer = pack.answers[clip.id];
    return answer !== undefined && answer !== null && answer !== "";
  }).length;

  const result = () =>
    formatListeningResult({
      buildSha: shortSha(BUILD_SHA),
      fingerprint: pack.fingerprint,
      clips: pack.clips,
      answers: pack.answers,
      notes: pack.notes,
      note: pack.note,
    });

  return (
    <main className="mx-auto flex max-w-[520px] flex-col gap-3 px-4 pt-4 pb-10">
      <header className="flex flex-col gap-1">
        <p className="text-muted text-[11px] tracking-[0.18em] uppercase">
          {BRAND_NAME}
        </p>
        <h1 className="text-text text-lg font-medium">Kulak testi</h1>
        <p className="text-muted text-xs">
          Editörü test etmen gerekmiyor. Yalnızca kısa örnekleri dinle ve kulağına
          nasıl geldiğini söyle.
        </p>
        <p className="text-text text-xs" data-listen-round>
          Bu tur: {decided}/{asked.length}
        </p>
        <p className="text-muted text-[11px]">
          Build <span data-listen-sha>{shortSha(BUILD_SHA)}</span>
          {" · "}
          <span className="opacity-70" data-listen-fingerprint>
            {pack.title} · {pack.fingerprint}
          </span>
        </p>
      </header>

      <button
        type="button"
        data-listen-all
        onClick={pack.runningAll ? pack.stop : pack.playAll}
        style={{ minHeight: TOUCH + 8 }}
        className="border-bronze bg-bronze/15 text-bronze active:bg-bronze/30 rounded-xl border text-sm font-medium"
      >
        {pack.runningAll ? "Durdur" : "Tümünü sırayla dinle"}
      </button>

      <ol className="flex list-none flex-col gap-2 p-0">
        {asked.map((clip) => {
          const answer = pack.answers[clip.id];
          return (
            <li
              key={clip.id}
              data-listen-clip={clip.id}
              className="border-line flex flex-col gap-2 rounded-xl border p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-text text-sm font-medium">
                  <span className="text-muted mr-1.5 text-[11px]">{clip.id}</span>
                  {clip.label}
                </h2>
                <span
                  data-listen-answered={answer ? "yes" : "no"}
                  className={`text-[10px] ${answer ? "text-muted" : "text-muted/60"}`}
                >
                  {answer ?? "ölçülmedi"}
                </span>
              </div>
              <p className="text-muted text-xs">{clip.instruction}</p>

              <div className="flex gap-2">
                {clip.takes.map((take) => (
                  <TakeButton
                    key={take.id}
                    id={take.id}
                    name={take.name}
                    state={pack.takes[take.id]}
                    onPlay={() => pack.play(take.id)}
                  />
                ))}
              </div>

              <p className="text-text text-xs">{clip.question}</p>
              <div className="flex flex-wrap gap-1.5">
                {clip.answers.map((option) => (
                  <button
                    key={option}
                    type="button"
                    data-listen-answer={`${clip.id}:${option}`}
                    aria-pressed={answer === option}
                    onClick={() => pack.answer(clip.id, option)}
                    style={{ minHeight: TOUCH }}
                    className={`flex-1 rounded-lg border px-2 text-xs ${
                      answer === option
                        ? "border-bronze bg-bronze/20 text-bronze"
                        : "border-line text-muted active:bg-line/40"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <input
                data-listen-note={clip.id}
                value={pack.notes[clip.id] ?? ""}
                onChange={(event) => pack.setNote(clip.id, event.target.value)}
                placeholder="Kısa not (isteğe bağlı)"
                style={{ minHeight: TOUCH }}
                className="border-line text-text placeholder:text-muted/60 rounded-lg border bg-transparent px-2 text-xs"
              />
            </li>
          );
        })}
      </ol>

      {/*
        The record, open on request (§4).

        Readable and not answerable: these are physical results the founder
        gave on real devices, and a button that let this session overwrite one
        would be a second authority for the same fact.
      */}
      <details data-listen-archive={FOUNDER_AUTHORITY.length}>
        <summary
          style={{ minHeight: TOUCH }}
          className="border-line text-muted flex items-center rounded-lg border px-3 text-xs"
        >
          Önceki turlar ({FOUNDER_AUTHORITY.length} kart, kayıtlı)
        </summary>
        <ul className="mt-2 flex list-none flex-col gap-1 p-0">
          {FOUNDER_AUTHORITY.map((card) => (
            <li
              key={card.id}
              data-listen-archived={card.id}
              className="border-line/60 flex items-baseline justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <span className="text-muted text-xs">
                <span className="mr-1.5 text-[11px] opacity-70">{card.id}</span>
                {card.title}
              </span>
              <span className="text-muted/80 shrink-0 text-[11px]">
                {VERDICT_LABEL[card.verdict]}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Genel not (isteğe bağlı)</span>
        <textarea
          data-listen-free-note
          value={pack.note}
          onChange={(event) => pack.setFreeNote(event.target.value)}
          rows={2}
          className="border-line text-text rounded-lg border bg-transparent p-2 text-xs"
        />
      </label>

      <pre
        data-listen-result
        className="border-line text-muted overflow-auto rounded-lg border p-2 text-[10px] whitespace-pre-wrap"
      >
        {result()}
      </pre>

      <button
        type="button"
        data-listen-copy
        onClick={() => {
          void navigator.clipboard?.writeText(result()).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        style={{ minHeight: TOUCH + 8 }}
        className="border-bronze bg-bronze/15 text-bronze active:bg-bronze/30 rounded-xl border text-sm font-medium"
      >
        {copied ? "Kopyalandı" : "Sonucu kopyala"}
      </button>

      {/*
        The credit travels with the sound, not as a footnote nobody reads:
        these clips are made from a vendored soundfont and the licence asks
        for attribution wherever it is heard.
      */}
      <p className="text-muted/70 text-[10px]">
        Sesler:{" "}
        <a
          data-listen-attribution
          href={SAMPLE_LICENSE.sourceRepository}
          target="_blank"
          rel="noreferrer noopener"
          className="underline"
        >
          {SAMPLE_LICENSE.soundfont} · {SAMPLE_LICENSE.name}
        </a>
      </p>
    </main>
  );
}
