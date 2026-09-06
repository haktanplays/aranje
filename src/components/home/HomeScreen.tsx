"use client";

/**
 * The first screen (2V-E.1 §4, §28).
 *
 * One question at a time. With nothing on the device that question is "shall
 * we start?", and there is exactly one control for it; with projects on the
 * device it is "which one?", and the open project answers first because it is
 * the one the reader almost always means.
 *
 * Everything on a card is about the music — its name, its key, its tempo, its
 * shape, when it was last touched. The id the app uses to find it does not
 * appear, on the screen or in an accessible name.
 */
import { EMPTY_HOME_BLURB } from "@/lib/home/home-model";
import type { HomeHandle } from "@/lib/home/use-home";
import { BRAND_NAME } from "@/lib/brand";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { ProjectCard } from "@/components/home/ProjectCard";
import { StartingPoint } from "@/components/home/StartingPoint";

export function HomeScreen({ home }: { home: HomeHandle }) {
  const model = home.model;

  return (
    <main
      data-home
      className="bg-bg text-text mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 pt-6 pb-10"
    >
      <header className="flex flex-col gap-1">
        <p className="text-bronze text-[10px] font-semibold tracking-[0.2em] uppercase">
          {BRAND_NAME}
        </p>
        <h1 className="font-display text-2xl leading-tight">Parçaların</h1>
      </header>

      {home.error ? (
        <p
          data-home-error
          role="alert"
          className="border-reject/50 text-reject rounded-lg border px-3 py-2 text-sm"
        >
          {home.error}
        </p>
      ) : null}

      {model.kind === "empty" ? (
        <section className="flex flex-col gap-4" data-home-empty>
          <p className="text-muted text-sm">{EMPTY_HOME_BLURB}</p>
          <StartingPoint home={home} />
        </section>
      ) : (
        <>
          {model.recent ? (
            <section className="flex flex-col gap-2" data-home-recent>
              <h2 className="text-muted text-xs tracking-wide uppercase">
                Son çalıştığın
              </h2>
              <ProjectCard card={model.recent} onOpen={home.open} emphasis />
            </section>
          ) : null}

          <StartingPoint home={home} />

          {model.others.length > 0 ? (
            <section className="flex flex-col gap-2" data-home-others>
              <h2 className="text-muted text-xs tracking-wide uppercase">
                Tüm parçalar
              </h2>
              <ul className="flex list-none flex-col gap-2 p-0">
                {model.others.map((card) => (
                  <li key={card.id}>
                    <ProjectCard card={card} onOpen={home.open} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {/* A device that cannot be written to says so once, here, rather than
          refusing silently when the reader taps. */}
      {home.canStart ? null : (
        <p className="text-muted text-xs" style={{ minHeight: MIN_TOUCH_TARGET_PX / 2 }}>
          Bu cihazda yeni parça oluşturulamıyor. Tarayıcının site verilerine izin
          verdiğinden emin ol.
        </p>
      )}
    </main>
  );
}
