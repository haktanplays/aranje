/**
 * The three defects this checkpoint exists to close, measured on the build
 * that has them (2Q-A §0).
 *
 * Nothing here touches production code. Defect A is driven through the real
 * `create_track` command and the real write path — a fixture with hand-filled
 * slot maps would prove nothing, because the whole defect is *which keys the
 * command leaves behind*. Defects B and C are measured in a real browser by
 * `measure-baseline.mjs`; this module records the parts that are answerable
 * from the pure core.
 *
 *   npx tsx eval/multitrack/baseline.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { applyEdit } from "@/lib/song/edit";
import { applyTrackCommand } from "@/lib/song/track-lifecycle";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { canonicalJson } from "@/lib/copilot/fingerprint";
import { isDrumInstrument } from "@/lib/instruments/registry";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import type { Song } from "@/lib/song/schema";

const OUT = "eval/multitrack";
mkdirSync(OUT, { recursive: true });

const bytes = (song: Song) => canonicalJson(song).length;

/* ------------------------------------------------------------- defect A */

/**
 * The user flow, step by step, with nothing skipped.
 *
 * Open a project, add a guitar, pick it, go to a bar, try to write a note.
 * Every step is the production command a control actually invokes.
 */
function defectA() {
  const before = SAMPLE_SONG;
  const created = applyTrackCommand(before, {
    kind: "create_track",
    setup: {
      name: "Solo Gitar",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      fretboard: { tuning: [...TUNING_PRESETS.e_standard!.tuning], capo: 0 },
    },
  });
  if (!created.ok) throw new Error(`create_track refused: ${created.error.code}`);
  const song = created.song;
  const track = song.tracks.at(-1)!;
  const sectionId = song.sections[0]!.id;

  // Step 4: go to a bar. Any bar — the track is new, so every bar is empty.
  const barIndex = 0;
  const bar = song.sections[0]!.bars[barIndex]!;
  const timeline = buildTrackTimeline(song, track.id);

  // Step 6: write the first note, through the same command the cell uses.
  const write = applyEdit(song, {
    kind: "set_note",
    target: { sectionId, trackId: track.id, barIndex, slotIndex: 0 },
    stringIndex: 0,
    fret: 5,
  });

  return {
    what:
      "Yeni bir track eklendikten sonra ilk notanin yazilamamasi. Akis " +
      "gercek create_track ve gercek yazma komutu uzerinden kosuldu.",
    trackInRegistry: song.tracks.some((entry) => entry.id === track.id),
    trackKeyInThatBar: Object.prototype.hasOwnProperty.call(bar.slots, track.id),
    barKeysPresent: Object.keys(bar.slots).sort(),
    // What the tab surface can draw for this track: no bar carries a key, so
    // the timeline has nothing to lay a grid over.
    gridDrawable: timeline.kind === "fretted"
      ? timeline.bars.some((entry) => !entry.silent)
      : false,
    timelineKind: timeline.kind,
    barsReportedSilent:
      timeline.kind === "fretted" ? timeline.bars.filter((b) => b.silent).length : null,
    barsTotal: timeline.kind === "fretted" ? timeline.bars.length : null,
    // A cell can be pressed and a sheet can open; both are drawn from the bar
    // geometry, which exists. The refusal happens one layer below.
    cellSelectable: true,
    editSheetOpens: true,
    writeAccepted: write.ok,
    writeErrorCode: write.ok ? null : write.error.code,
    writeMessage: write.ok ? null : write.error.message,
    // The sentence names an action, and no control anywhere performs it.
    messageNamesAnActionTheUserCanTake: false,
    whyNot:
      "Cumle 'once bu bara eklenmeli' diyor. Bir track'i tek bir bara ekleyen " +
      "kontrol ne Track sheet'inde, ne bar islemlerinde, ne de riff " +
      "duzenleyicisinde var; komut da bunu kendisi yapmiyor.",
    storageWrites: write.ok ? 1 : 0,
    historyWrites: write.ok ? 1 : 0,
    songBytesBefore: bytes(before),
    songBytesAfterCreate: bytes(song),
    songBytesAfterWriteAttempt: bytes(write.ok ? write.song : song),
    rootCause:
      "create_track hicbir bar'a anahtar birakmiyor. Spec 5.5'e gore eksik " +
      "anahtar 'burada sessiz' demek; yazma yolu ayni eksikligi 'bu barda " +
      "yazili degil' olarak okuyor. Iki dogru okuma, tek bir gosterge: yeni " +
      "track hicbir yerde yazilabilir degil.",
  };
}

/** The same flow for the other track kinds a reader can create. */
function defectAAcrossKinds() {
  const kinds: { label: string; setup: Parameters<typeof applyTrackCommand>[1] }[] = [
    {
      label: "elektrik bas",
      setup: {
        kind: "create_track",
        setup: {
          name: "Bas",
          instrumentId: "electric_bass",
          presetId: "finger",
          fretboard: { tuning: [...TUNING_PRESETS.bass_standard!.tuning], capo: 0 },
        },
      },
    },
    {
      label: "celik telli akustik",
      setup: {
        kind: "create_track",
        setup: {
          name: "Akustik",
          instrumentId: "steel_acoustic",
          presetId: "finger",
          fretboard: { tuning: [...TUNING_PRESETS.e_standard!.tuning], capo: 0 },
        },
      },
    },
    {
      label: "davul",
      setup: {
        kind: "create_track",
        setup: { name: "Davul 2", instrumentId: "drum_kit", presetId: "rock" },
      },
    },
  ];

  return kinds.map(({ label, setup }) => {
    const created = applyTrackCommand(SAMPLE_SONG, setup);
    if (!created.ok) return { label, refused: created.error.code };
    const track = created.song.tracks.at(-1)!;
    const barsWithKey = created.song.sections.reduce(
      (total, section) =>
        total +
        section.bars.filter((bar) =>
          Object.prototype.hasOwnProperty.call(bar.slots, track.id),
        ).length,
      0,
    );
    const barsTotal = created.song.sections.reduce(
      (total, section) => total + section.bars.length,
      0,
    );
    return {
      label,
      drums: isDrumInstrument(track.instrumentId),
      barsWithKey,
      barsTotal,
      writableAnywhere: barsWithKey > 0,
    };
  });
}

/* ------------------------------------------------------------ baseline C */

/**
 * How much of the arrangement one Tab screen can show at once.
 *
 * Read from the production surface's own contract rather than from the
 * screen: the tab is built for exactly one track id, so the answer is one by
 * construction, and the cost of looking at another track is the cost of
 * changing that id.
 */
function baselineC(song: Song) {
  const melodic = song.tracks.filter((track) => !isDrumInstrument(track.instrumentId));
  return {
    what: "Mevcut Tab gorunumunun ayni anda kac track'i gosterebildigi.",
    tracksInSection: song.tracks.length,
    melodicTracks: melodic.length,
    drumTracks: song.tracks.length - melodic.length,
    // buildTrackTimeline(song, trackId) — one track id in, one timeline out.
    notationsVisibleAtOnce: 1,
    // Track sheet → track row. Measured again in the browser harness.
    userActionsToReachAnotherTrack: 2,
    // Both measured in the browser, on the running build.
    horizontalTimePositionKeptOnTrackChange: true,
    playbackSurvivesTrackChange: true,
    audioContextsAcrossTrackChange: "1 → 1",
    measuredInBrowser: "eval/multitrack/artifacts/BASELINE-BROWSER.json",
    honestNote:
      "Track degistirmek bugun de calmayi durdurmuyor ve yatay konumu " +
      "koruyor. Eksik olan sey karsilastirma: ayni anda tek notasyon var, " +
      "yani iki enstrumani yan yana gormek mumkun degil.",
  };
}

/* ---------------------------------------------------------------- write */

const fourPart: Song = SAMPLE_SONG;

const report = {
  what: "2Q-A §0 — kapatilacak uc kusurun mevcut build uzerindeki olcumu",
  measuredOn: "Node; B ve C'nin ekran kismi masaustu Chromium — telefon degil",
  head: process.env.BASELINE_HEAD ?? "4e919bc",
  defectA: defectA(),
  defectAAcrossTrackKinds: defectAAcrossKinds(),
  defectB: {
    what: "320x700'de transport kirpilmasi",
    measuredIn: "eval/multitrack/artifacts/BASELINE-BROWSER.json",
    note:
      "Onceki raporun 344/320 sayisi burada tekrar edilmedi; tarayici " +
      "harness'i her kontrolun kutusunu yeniden olctu ve baska bir sayi " +
      "buldu.",
    summary: {
      requiredWidthPx: 355.7,
      availableWidthPx: 320,
      overflowPx: 35.7,
      clippedControl: "Calisma hizi pill'i",
      clippedControlWidthPx: 59.7,
      clippedControlVisiblePx: 36,
      clippedPx: 23.7,
      // The root is not the clipper; the workspace shell is.
      rootOverflowX: "visible",
      clippingAncestor: "div.flex.h-dvh.flex-col.overflow-hidden",
      clippingAncestorClientWidth: 320,
      clippingAncestorScrollWidth: 344,
      bodyOverflowPx: 0,
      controlsBelow44px: 0,
      at390: "tasma 0; butun kontroller tam gorunur",
    },
  },
  baselineC: baselineC(fourPart),
};

writeFileSync(`${OUT}/BASELINE.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.defectA, null, 2));
console.log(JSON.stringify(report.defectAAcrossTrackKinds, null, 2));
