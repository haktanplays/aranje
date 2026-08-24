/**
 * What is actually playable, before 2O-B.1 changes anything (§1).
 *
 * The checkpoint starts from a claim that has to be checked rather than
 * believed: a preset appearing in the registry is not the same thing as a
 * preset a reader can hear. This script keeps those two ideas in separate
 * columns and fills each one from a different source — the registry for
 * "visible", the vendored manifest **and the files on disk** for "playable" —
 * so a disagreement between them shows up as a row rather than as silence in
 * somebody's first song.
 *
 * Everything here reads production code and production assets. Nothing is
 * mutated, and no audio is rendered: the audible half of the proof belongs to
 * the browser harness, which renders the same tracks for real.
 *
 *   npx tsx eval/chord-audio/audit.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import manifest from "../../public/samples/manifest.json";

import { SAMPLE_LICENSE, samplePackFor } from "@/lib/audio/packs";
import {
  corePresets,
  getInstrument,
  getPreset,
  isCorePreset,
  isDrumInstrument,
  listInstruments,
} from "@/lib/instruments/registry";
import { SONG_TEMPLATES, materializeTemplate } from "@/lib/song/song-templates";
import { errorsOnly, runValidators } from "@/lib/validators";
import { songSchema } from "@/lib/song/schema";

const OUT = "eval/chord-audio/artifacts";
mkdirSync(OUT, { recursive: true });

/** Where a `baseUrl` of `/samples/x/y` actually lives in the repository. */
const onDisk = (baseUrl: string): string => join("public", baseUrl.replace(/^\//, ""));

/* ------------------------------------------------------ the manifest itself */

const manifestPacks = manifest.packs.map((pack) => {
  const dir = onDisk(pack.baseUrl);
  const missing = pack.files
    .filter((file) => !existsSync(join(dir, file.processedFileName)))
    .map((file) => `${pack.baseUrl}/${file.processedFileName}`);
  return {
    id: pack.id,
    baseUrl: pack.baseUrl,
    directoryOnDisk: dir,
    directoryExists: existsSync(dir),
    fileCount: pack.files.length,
    notes: pack.files.map((file) => file.note),
    missingUrls: missing,
    bytes: pack.bytes,
  };
});

const packById = new Map(manifestPacks.map((pack) => [pack.id, pack]));

/* --------------------------------------------------- one row per pair (§1) */

/**
 * Which templates name this instrument.
 *
 * A template does not name a preset — it names an instrument and lets the
 * registry choose — so the preset a template *lands on* is worked out the same
 * way `materializeTemplate` works it out, from the same function.
 */
const templatePresetFor = (instrumentId: string): string | undefined =>
  corePresets(instrumentId)[0]?.id;

type Pair = {
  instrumentId: string;
  presetId: string;
  /** In the registry at all, at any scope. */
  registryVisible: boolean;
  /** In the registry *and* offerable today: core instrument, core preset. */
  selectableInCoreScope: boolean;
  /** Templates whose materialisation lands on exactly this pair. */
  templateUsesIt: readonly string[];
  /** Whether a reader would hear this track. See `silentReason` when false. */
  playableInProduction: boolean;
  /** How it makes sound at all: vendored samples, synthesis, or nothing. */
  soundSource: "sample_pack" | "synthesised" | "none";
  silentReason: string | null;
  /** Packs in the vendored manifest carrying this id: 0 or 1. */
  manifestEntryCount: number;
  /** Note files the manifest promises for this pair. */
  expectedSampleCount: number;
  /** Promised files that are not on disk. */
  missingUrls: readonly string[];
  attributionId: string | null;
};

const pairs: Pair[] = [];
for (const instrument of listInstruments()) {
  for (const preset of instrument.presets) {
    const id = `${instrument.id}/${preset.id}`;
    const pack = packById.get(id);
    const drums = isDrumInstrument(instrument.id);
    const templates = SONG_TEMPLATES.filter(
      (template) =>
        template.trackPlans.some((plan) => plan.instrumentId === instrument.id) &&
        templatePresetFor(instrument.id) === preset.id,
    ).map((template) => template.id);

    const playable = drums || (pack !== undefined && pack.missingUrls.length === 0);
    pairs.push({
      instrumentId: instrument.id,
      presetId: preset.id,
      registryVisible: getPreset(instrument.id, preset.id) !== undefined,
      selectableInCoreScope: isCorePreset(instrument.id, preset.id),
      templateUsesIt: templates,
      playableInProduction: playable,
      soundSource: drums ? "synthesised" : pack ? "sample_pack" : "none",
      silentReason: playable
        ? null
        : pack === undefined
          ? "sample_pack_missing"
          : "sample_files_missing",
      manifestEntryCount: pack ? 1 : 0,
      expectedSampleCount: pack?.fileCount ?? 0,
      missingUrls: pack?.missingUrls ?? [],
      // One licence covers every vendored pack; a pair with no pack carries
      // no attribution because it contributes no recording.
      attributionId: pack ? SAMPLE_LICENSE.spdx : null,
    });
  }
}

/* -------------------------------------------- what each launch template does */

const templates = SONG_TEMPLATES.map((template) => {
  const song = materializeTemplate(template.id);
  const tracks = (song?.tracks ?? []).map((track) => {
    const pack = samplePackFor(track.instrumentId, track.presetId);
    const drums = isDrumInstrument(track.instrumentId);
    return {
      name: track.name,
      instrumentId: track.instrumentId,
      presetId: track.presetId,
      volumeDb: track.volumeDb,
      packId: pack?.id ?? null,
      audible: drums || pack !== undefined,
    };
  });
  const parsed = song ? songSchema.safeParse(song) : null;
  return {
    id: template.id,
    label: template.label,
    materialises: song !== null,
    /** A template is only honest if every track it stands up can be heard. */
    silentTracks: tracks.filter((track) => !track.audible).map((track) => track.name),
    tracks,
    schemaValid: parsed?.success ?? false,
    // What the central validator chain says about the song a template makes.
    // It is a separate question from audibility, and the answer is the point.
    validatorErrors: song ? errorsOnly(runValidators(song)).map((issue) => issue.code) : [],
  };
});

/* ----------------------------------------------------------- the ten answers */

const source = (path: string): string => readFileSync(path, "utf8");
const engineSource = source("src/lib/audio/engine.ts");
const trackSheetSource = source("src/components/workspace/TrackManagerSheet.tsx");
const templateSource = source("src/lib/song/song-templates.ts");

const guitarPresets = getInstrument("electric_guitar")?.presets ?? [];
const clean = packById.get("electric_guitar/clean");

const questions = [
  {
    q: "1. electric_guitar/clean registry'de var mı?",
    answer: getPreset("electric_guitar", "clean") !== undefined ? "Evet" : "Hayır",
    evidence: {
      preset: getPreset("electric_guitar", "clean") ?? null,
      coreScope: isCorePreset("electric_guitar", "clean"),
    },
    measuredBy: "instrument registry",
  },
  {
    q: "2. Sample manifest'i var mı?",
    answer: clean ? "Evet" : "Hayır — manifest'te bu id ile pack yok",
    evidence: { manifestPackIds: manifestPacks.map((pack) => pack.id) },
    measuredBy: "public/samples/manifest.json",
  },
  {
    q: "3. Sample dosyaları gerçekten vendor edilmiş mi?",
    answer: existsSync("public/samples/electric_guitar/clean")
      ? "Evet"
      : "Hayır — public/samples/electric_guitar/clean dizini yok",
    evidence: {
      directoryExists: existsSync("public/samples/electric_guitar/clean"),
      vendoredDirectories: manifestPacks.map((pack) => ({
        id: pack.id,
        exists: pack.directoryExists,
        files: pack.fileCount,
        missing: pack.missingUrls.length,
      })),
    },
    measuredBy: "dosya sistemi",
  },
  {
    q: "4. Loader bunu hata mı sayıyor, sessiz bank mı kuruyor?",
    answer:
      "İkisi de değil: pack yoksa buildVoice() null döner ve createEngine o " +
      "track'i grafiğe hiç eklemez. Boş bank kurulmaz, hata da atılmaz — " +
      "track sessizce yok sayılır ve motor başarı bildirir.",
    evidence: {
      buildVoiceReturnsNull: engineSource.includes("if (!pack) {"),
      engineSkipsSilently: engineSource.includes("if (!built) continue;"),
      // expectedBuffers is summed over packs that exist, so a missing pack
      // does not even show up as an unfinished download.
      progressCountsOnlyExistingPacks: engineSource.includes("if (entry.build.packId === null) continue;"),
    },
    measuredBy: "src/lib/audio/engine.ts — gerçek render kanıtı §2'de",
  },
  {
    q: "5. Şablon oluşturulduğunda validator bunu görüyor mu?",
    answer:
      "Hayır. trackReferences yalnız preset'in registry'de var olup olmadığını " +
      "sorar; clean vardır, dolayısıyla şablon temiz geçer. Bugün hiçbir " +
      "validator oynatılabilirliği sormuyor.",
    evidence: {
      templateValidatorErrors: templates.map((template) => ({
        id: template.id,
        errors: template.validatorErrors,
        silentTracks: template.silentTracks,
      })),
      validatorAsksRegistryOnly: source("src/lib/validators/trackReferences.ts").includes(
        "if (!getPreset(track.instrumentId, track.presetId))",
      ),
    },
    measuredBy: "runValidators(materializeTemplate(...))",
  },
  {
    q: "6. UI bunu seçilebilir bir preset gibi gösteriyor mu?",
    answer:
      "Evet. Track kurulum sayfası corePresets() listesini olduğu gibi bir " +
      "<select> içine döküyor; sessiz preset ile duyulan preset arasında " +
      "hiçbir görsel ayrım yok.",
    evidence: {
      listsCorePresetsVerbatim: trackSheetSource.includes("corePresets(draft.instrumentId).map"),
      offeredForElectricGuitar: corePresets("electric_guitar").map((preset) => preset.id),
    },
    measuredBy: "src/components/workspace/TrackManagerSheet.tsx",
  },
  {
    q: "7. Proje import'u bu preset'i koruyor mu?",
    answer:
      "Evet — ve bu doğru davranış. presetId şarkı byte'ının parçası; import " +
      "onu olduğu gibi okur, şema kabul eder, validator hata vermez. Hiçbir " +
      "yerde sessiz bir fallback yok.",
    evidence: {
      schemaAcceptsAnyPresetString: source("src/lib/song/schema.ts").includes(
        "presetId: z.string().min(1)",
      ),
      importMutatesPreset: false,
    },
    measuredBy: "src/lib/song/schema.ts + validator zinciri",
  },
  {
    q: "8. Playback ve preview aynı unavailable kararı veriyor mu?",
    answer:
      "Evet, çünkü ikisi de aynı createEngine/buildVoice yolundan geçiyor. " +
      "Ayrı bir preview kararı yok; ikisi de aynı sessizliği üretiyor.",
    evidence: {
      previewUsesPlaybackController: source("src/lib/workspace/use-chord-audition.ts").includes(
        "new PlaybackController(candidate)",
      ),
      playbackUsesCreateLiveEngine: source("src/lib/audio/playback.ts").includes(
        "options.createEngine ?? createLiveEngine",
      ),
      createLiveEngineDelegates: engineSource.includes("return createEngine(song, tone.getContext(), options);"),
    },
    measuredBy: "import zinciri",
  },
  {
    q: "9. Hangi elektrik gitar presetleri gerçekten çalışıyor?",
    answer: guitarPresets
      .map((preset) => {
        const pack = packById.get(`electric_guitar/${preset.id}`);
        return `${preset.id} (${preset.scope}): ${pack ? "çalışıyor" : "sessiz"}`;
      })
      .join(", "),
    evidence: {
      presets: guitarPresets.map((preset) => ({
        id: preset.id,
        scope: preset.scope,
        engine: preset.engine,
        packId: packById.get(`electric_guitar/${preset.id}`)?.id ?? null,
      })),
    },
    measuredBy: "registry × manifest",
  },
  {
    q: "10. Hangi launch şablonları sessiz track üretiyor?",
    answer:
      templates
        .filter((template) => template.silentTracks.length > 0)
        .map((template) => `${template.id} → ${template.silentTracks.join(", ")}`)
        .join(" | ") || "hiçbiri",
    evidence: {
      templatePicksFirstCorePreset: templateSource.includes("corePresets(plan.instrumentId)[0]"),
      templates: templates.map((template) => ({
        id: template.id,
        tracks: template.tracks,
        silentTracks: template.silentTracks,
      })),
    },
    measuredBy: "materializeTemplate(...) × manifest",
  },
];

/* ------------------------------------------------------------------- output */

const baseline = {
  what: "2O-B.1 §1 — registry, manifest ve launch şablonlarının ses denetimi",
  measuredOn: "Node; ses render'ı yok — duyulur kanıt §2 tarayıcı ölçümünde",
  rule: "Registry'de görünmek ile oynatılabilir olmak ayrı iki sütundur.",
  license: { spdx: SAMPLE_LICENSE.spdx, textVendored: SAMPLE_LICENSE.textVendored },
  totals: {
    registryPairs: pairs.length,
    coreSelectablePairs: pairs.filter((pair) => pair.selectableInCoreScope).length,
    playablePairs: pairs.filter((pair) => pair.playableInProduction).length,
    vendoredPacks: manifestPacks.length,
    manifestFilesMissingOnDisk: manifestPacks.reduce(
      (total, pack) => total + pack.missingUrls.length,
      0,
    ),
    silentCoreSelectablePairs: pairs
      .filter((pair) => pair.selectableInCoreScope && !pair.playableInProduction)
      .map((pair) => `${pair.instrumentId}/${pair.presetId}`),
  },
  manifestPacks,
  pairs,
  templates,
  questions,
};

writeFileSync(`${OUT}/BASELINE.json`, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`pairs=${pairs.length} playable=${baseline.totals.playablePairs}`);
console.log(`silent core-selectable: ${baseline.totals.silentCoreSelectablePairs.join(", ") || "none"}`);
for (const template of templates) {
  console.log(`${template.id}: silent=[${template.silentTracks.join(", ")}] validatorErrors=[${template.validatorErrors.join(",")}]`);
}
