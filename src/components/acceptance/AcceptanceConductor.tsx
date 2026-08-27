"use client";

/**
 * The five-minute guided Android test (K-59.1 §5).
 *
 * One task on screen at a time, in Turkish, with one large button. The reader
 * is never asked for a coordinate, a log line or a technical term: everything
 * a machine can notice, the page notices for itself, and everything left is a
 * question a guitarist can answer.
 *
 * The workspace underneath is the real one, on a fixed riff, in a storage this
 * page owns — so the test can be run on a phone that already has the reader's
 * own music on it without touching a byte of it.
 */
import { useMemo, useState, useSyncExternalStore } from "react";

import { Workspace } from "@/components/workspace/Workspace";
import { useAcceptanceWatch } from "@/components/acceptance/useAcceptanceWatch";
import { LISTEN_WINDOWS } from "@/lib/acceptance/riff";
import { acceptanceSession, type AcceptanceSession } from "@/lib/acceptance/session";
import {
  LISTEN_KEYS,
  LISTEN_TITLES,
  formatResult,
  type AcceptanceAnswers,
  type CheckAnswer,
  type ListenAnswer,
  type ListenKey,
} from "@/lib/acceptance/report";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/** What a listener is asked about each technique. Plain words, no theory. */
const LISTEN_PROMPTS: Readonly<Record<ListenKey, string>> = {
  palmMute: "Riffin başındaki üç vuruş boğuk ve kısa mı geldi?",
  hopo: "Beş nota tek vuruşla akıp gitti mi, yoksa beşi de ayrı ayrı mı vuruldu?",
  slide: "Perde yukarı ve geri kayarken ses kesintisiz kaydı mı?",
  bendHalf: "Bükülen nota yukarı çıkıp geri indi mi?",
  bendFull: "Bu büküm bir öncekinden daha fazla yükseldi mi?",
  vibrato: "Uzun notada hafif bir titreşim duydun mu?",
};

const LISTEN_OPTIONS: readonly { readonly value: Exclude<ListenAnswer, null>; readonly label: string }[] = [
  { value: "clear", label: "Net duydum" },
  { value: "unsure", label: "Belirsiz" },
  { value: "wrong", label: "Yanlış geldi" },
  { value: "silent", label: "Ses çıkmadı" },
];

const EMPTY_LISTEN = Object.fromEntries(
  LISTEN_KEYS.map((key) => [key, null]),
) as Record<ListenKey, ListenAnswer>;

function Big({
  children,
  onClick,
  tone = "primary",
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary" | "plain";
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-acceptance-action={testId}
      onClick={onClick}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      className={`w-full rounded-lg border px-3 text-sm font-medium ${
        tone === "primary"
          ? "border-bronze bg-bronze/15 text-bronze"
          : "border-line text-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function AcceptanceConductor() {
  /*
   * The storage swap, read the way the song itself is read.
   *
   * Installing it in a plain `useState` initializer was the obvious thing and
   * was wrong twice over: the server has no storage to swap, so the two
   * passes disagreed and React threw the server HTML away — and the
   * re-render asked for a second session, which the installer correctly
   * refused, so the route accused itself of already being set up. An external
   * store is what this actually is, and `useSyncExternalStore` is where React
   * puts the seam: the server and the hydration pass both see `null`, the
   * client sees the installed session, and no pass disagrees with another.
   *
   * Nothing below renders until it exists, so the workspace cannot mount
   * against `localStorage` even for one frame. A failure is shown rather than
   * swallowed: a test that quietly ran against the reader's own music would
   * be worse than no test.
   */
  const session = useSyncExternalStore<AcceptanceSession | null>(
    () => () => {},
    acceptanceSession,
    () => null,
  );

  /*
   * When the test started, stamped once.
   *
   * `new Date()` in the result builder made the block different on every
   * paint — which is invisible to a reader and fatal to any check that the
   * answers survived a step back, and it put the time of the last repaint
   * where the time of the test belongs.
   */
  const [startedAt] = useState(() => new Date().toISOString());

  const windows = useMemo(() => LISTEN_WINDOWS, []);
  const { observed, loadingText, loadMs, firstSoundMs, markFirstTap } =
    useAcceptanceWatch(windows);

  const [step, setStep] = useState(0);
  const [listenIndex, setListenIndex] = useState(0);
  const [answers, setAnswers] = useState<AcceptanceAnswers>({
    visual: null,
    ghost: null,
    listen: { ...EMPTY_LISTEN },
    note: "",
  });
  const [copied, setCopied] = useState(false);

  const next = () => setStep((current) => current + 1);
  /*
   * One step back, and the answers stay.
   *
   * A guided test with no way back is a test that ends the moment someone
   * mis-taps, and the honest answer they meant to give is lost — so "Geri"
   * only moves the cursor. On the listening screen it walks the questions
   * rather than the steps, because that is what the reader sees as a step.
   */
  const back = () => {
    if (step === 5 && listenIndex > 0) {
      setListenIndex(listenIndex - 1);
      return;
    }
    if (step === 6) setListenIndex(LISTEN_KEYS.length - 1);
    setStep((current) => Math.max(0, current - 1));
  };
  const check = (field: "visual" | "ghost", value: CheckAnswer) => {
    setAnswers((current) => ({ ...current, [field]: value }));
    next();
  };

  const result = () =>
    formatResult({
      device: {
        date: startedAt,
        userAgent: navigator.userAgent,
        platform: navigator.platform ?? "",
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        pixelRatio: window.devicePixelRatio,
        touchPoints: navigator.maxTouchPoints ?? 0,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        online: navigator.onLine,
        audioState: loadingText || "—",
        loadMs,
        firstSoundMs,
        buffers: loadingText || "—",
      },
      answers,
      observed,
    });

  /* Steps 1, 6 and 7 own the screen; the rest sit above the workspace. */
  const overlay = step === 0 || step >= 5;

  /*
   * One neutral shell, identical on the server and on the first client pass.
   * The workspace underneath must not mount before the storage is swapped.
   */
  if (session === null) {
    return (
      <div className="bg-app flex h-dvh flex-col items-center justify-center">
        <p className="text-muted text-xs">Test hazırlanıyor…</p>
      </div>
    );
  }

  return (
    <div className="bg-app flex h-dvh flex-col overflow-hidden">
      <div
        data-acceptance-step={step}
        className="border-line bg-app shrink-0 border-b px-3 py-2"
      >
        {!session.ok ? (
          <p role="alert" className="text-reject text-xs">
            Test kendi deposunu kuramadı: {session.reason}. Bu turda devam etme.
          </p>
        ) : null}

        {step > 0 ? (
          <button
            type="button"
            data-acceptance-action="back"
            onClick={back}
            style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
            className="text-muted -mt-1 mb-0.5 text-xs"
          >
            ‹ Geri
          </button>
        ) : null}

        {step === 0 ? (
          <Panel title="1 / 7 · Hazırlık">
            <Line>Telefon sesini yaklaşık %50’ye getir.</Line>
            <Line>Mümkünse kulaklık kullan.</Line>
            <Line>Hazırsan aşağıdaki düğmeye dokun.</Line>
            <Big
              testId="start"
              onClick={() => {
                markFirstTap();
                next();
              }}
            >
              Hazırım — testi başlat
            </Big>
          </Panel>
        ) : null}

        {step === 1 ? (
          <Panel title="2 / 7 · Görünüm">
            <Line>Aşağıdaki nota satırına bak ve şunları kontrol et:</Line>
            <Line>• altı tel de görünüyor</Line>
            <Line>• beş notalık bağın yayı ve üstündeki H / P harfleri okunuyor</Line>
            <Line>• kayma, büküm, titreşim ve PM işaretleri rakamların üstünü kapatmıyor</Line>
            <Line>• ekran yana taşmıyor</Line>
            <div className="flex gap-2 pt-1">
              <Big testId="visual-ok" onClick={() => check("visual", "ok")}>
                Doğru
              </Big>
              <Big
                testId="visual-issue"
                tone="plain"
                onClick={() => check("visual", "issue")}
              >
                Bir sorun var
              </Big>
            </div>
          </Panel>
        ) : null}

        {step === 2 ? (
          <Panel title="3 / 7 · Dokunma ve seçim">
            <Line>1. Aşağıdaki <b>Düzenle</b>’ye dokun.</Line>
            <Line>2. Bağ yayının altındaki <b>ilk nota</b>ya uzun bas.</Line>
            <Line>3. Çıkan tutamağı sağa sürükleyip beş notayı da seç.</Line>
            <Line>4. <b>Bağla / Taşı / Devam / Daha fazla</b> satırını gör.</Line>
            <Line>5. <b>Daha fazla</b>’yı aç, sonra kapat.</Line>
            <Line>6. Üstteki <b>İptal</b> ile seçimden çık.</Line>
            <Big testId="selection-next" onClick={next}>
              Yaptım — sonraki
            </Big>
          </Panel>
        ) : null}

        {step === 3 ? (
          <Panel title="4 / 7 · Power Chord önizlemesi">
            <Line>1. <b>Şekil</b>’e dokun, <b>Power chord · 3 ses</b>’i seç.</Line>
            <Line>2. Nota satırında <b>boş bir yere</b> basılı tut.</Line>
            <Line>3. Parmağını kaldırmadan satırın dışına kaydırıp bırak.</Line>
            <Line>Basılıyken üç soluk rakam belirmeli; bıraktığında hiçbiri yazılmamalı.</Line>
            <div className="flex gap-2 pt-1">
              <Big testId="ghost-ok" onClick={() => check("ghost", "ok")}>
                Üç rakamı da gördüm
              </Big>
              <Big
                testId="ghost-issue"
                tone="plain"
                onClick={() => check("ghost", "issue")}
              >
                Eksik veya belirsizdi
              </Big>
            </div>
          </Panel>
        ) : null}

        {step === 4 ? (
          <Panel title="5 / 7 · Çalma">
            <Line>Sırayla yap, aralarda bekleme:</Line>
            <Line>1. ▶ Çal · 2. ⏸ Duraklat · 3. tekrar ▶ Çal</Line>
            <Line>4. İkinci ölçüye dokunup oraya git</Line>
            <Line>5. Döngü düğmesini aç</Line>
            <Line>6. %100 yazan düğmeden hızı bir kademe değiştir</Line>
            <Line>7. Başa sar</Line>
            <Big testId="transport-next" onClick={next}>
              Yaptım — sonraki
            </Big>
          </Panel>
        ) : null}

        {step === 5 ? (
          <Panel title="6 / 7 · Dinleme">
            <Line>
              Riffi bir kez baştan sona dinle, sonra soruları sırayla cevapla.
              İstersen tekrar çalabilirsin.
            </Line>
            <Line className="text-bronze">
              {LISTEN_TITLES[LISTEN_KEYS[listenIndex]!]} —{" "}
              {LISTEN_PROMPTS[LISTEN_KEYS[listenIndex]!]}
            </Line>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {LISTEN_OPTIONS.map((option) => (
                <Big
                  key={option.value}
                  testId={`listen-${option.value}`}
                  tone={option.value === "clear" ? "primary" : "plain"}
                  onClick={() => {
                    const key = LISTEN_KEYS[listenIndex]!;
                    setAnswers((current) => ({
                      ...current,
                      listen: { ...current.listen, [key]: option.value },
                    }));
                    if (listenIndex + 1 < LISTEN_KEYS.length) {
                      setListenIndex(listenIndex + 1);
                    } else {
                      next();
                    }
                  }}
                >
                  {option.label}
                </Big>
              ))}
            </div>
            <Line className="text-muted/70">
              {listenIndex + 1} / {LISTEN_KEYS.length}
            </Line>
          </Panel>
        ) : null}

        {step >= 6 ? (
          <Panel title="7 / 7 · Sonuç">
            <label className="text-muted block text-xs" htmlFor="acceptance-note">
              Eklemek istediğin bir şey varsa yaz (isteğe bağlı):
            </label>
            <textarea
              id="acceptance-note"
              data-acceptance-note
              value={answers.note}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, note: event.target.value }))
              }
              rows={2}
              className="border-line bg-panel text-text w-full rounded-lg border px-2 py-1 text-sm"
            />
            <pre
              data-acceptance-result
              className="border-line text-muted max-h-40 overflow-auto rounded-lg border p-2 text-[10px] leading-snug whitespace-pre-wrap"
            >
              {result()}
            </pre>
            <Big
              testId="copy"
              onClick={() => {
                const text = result();
                navigator.clipboard?.writeText(text).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? "Kopyalandı ✓" : "Sonucu kopyala"}
            </Big>
            <Line className="text-muted/70">
              Kopyalanan sonucu Haktan’ın açık ChatGPT konuşmasına yapıştır.
            </Line>
          </Panel>
        ) : null}
      </div>

      {/*
        The real workspace, and only its own height.

        `Workspace` sizes itself to the viewport, which is right on its own
        page and wrong under a strip — so the arbitrary variant below hands it
        the room that is actually left. Nothing about the workspace changes.
      */}
      <div
        className={`min-h-0 flex-1 overflow-hidden [&>div]:h-full ${overlay ? "hidden" : ""}`}
      >
        <Workspace />
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-bronze text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

function Line({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={`text-text text-xs leading-snug ${className}`}>{children}</p>;
}
