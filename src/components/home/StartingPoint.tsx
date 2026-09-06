"use client";

/**
 * "Yeni parça", and what one tap will assume (2V-E.1 §5).
 *
 * One primary control, and the assumptions under it in plain sight. A reader
 * who is happy with them taps once and is writing music; a reader who is not
 * opens the same list they would have been forced through, and nobody has to
 * fill in a form to find out what the defaults were.
 */
import { useState } from "react";

import { startingAssumptions } from "@/lib/home/first-song";
import { NEW_SONG_CTA } from "@/lib/home/home-model";
import type { HomeHandle } from "@/lib/home/use-home";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export function StartingPoint({ home }: { home: HomeHandle }) {
  const [showing, setShowing] = useState(false);
  const rows = startingAssumptions();

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        data-home-start
        disabled={!home.canStart}
        onClick={home.start}
        style={{ minHeight: MIN_TOUCH_TARGET_PX + 8 }}
        className="border-bronze bg-bronze/20 text-bronze active:bg-bronze/30 w-full rounded-xl border text-base font-medium disabled:opacity-40"
      >
        {NEW_SONG_CTA}
      </button>

      <button
        type="button"
        data-home-assumptions
        aria-expanded={showing}
        onClick={() => setShowing((value) => !value)}
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        className="text-muted border-line w-full rounded-lg border text-sm"
      >
        {showing ? "Ayarları gizle" : "Ayarları değiştir"}
      </button>

      {showing ? (
        <dl data-home-defaults className="border-line divide-line divide-y rounded-lg border">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <dt className="text-muted text-xs">{row.label}</dt>
              <dd className="truncate text-sm">{row.value}</dd>
            </div>
          ))}
          <p className="text-muted px-3 py-2 text-[11px]">
            Bunlar başlangıç varsayımları. Parçayı açtıktan sonra hepsini
            değiştirebilirsin.
          </p>
        </dl>
      ) : null}
    </section>
  );
}
