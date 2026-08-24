/**
 * Which sample pack, or which synthesised kit, plays a given track.
 *
 * The file list comes straight from the vendored manifest, so the code and the
 * assets on disk cannot drift apart. Nothing is fetched from a third party at
 * runtime (spec 7.2).
 */
import manifest from "../../../public/samples/manifest.json";

export type SamplePack = {
  id: string;
  baseUrl: string;
  /** Note name to file name, the shape Tone.Sampler expects. */
  urls: Record<string, string>;
  bytes: number;
  /**
   * Identity of the decoded asset set, for anything that caches banks.
   *
   * Not the preset id, and not the pack id: two different presets must never
   * collide, and the same pack pointed at a different set of files must not
   * be mistaken for the one already decoded. So the key is built from where
   * the files live and from every note-to-file pair, sorted, which is exactly
   * what a decoded bank *is*. The context boundary is not in here — a
   * `ToneAudioBuffer` belongs to the context that decoded it, so the cache
   * keeps a separate table per context and this key identifies the bank
   * within one of them (spec 8.1, K-28).
   */
  bankKey: string;
  /**
   * Level correction for this pack, in dB.
   *
   * The FluidR3 renders are cut well below full scale and each instrument sits
   * at a different level, so a pack needs a trim before the mix balance in the
   * song data means anything. These numbers come from measuring each track
   * rendered on its own, not from taste, and they are an engine concern: the
   * volumes written in the song stay untouched.
   */
  trimDb: number;
};

const TRIM_DB: Readonly<Record<string, number>> = {
  "electric_guitar/high_gain": 14,
  "steel_acoustic/finger": 15,
  "electric_bass/finger": 17,
};

/** See `SamplePack.bankKey`: where the files are, plus which files they are. */
function bankKeyOf(baseUrl: string, urls: Record<string, string>): string {
  const assets = Object.entries(urls)
    .map(([note, file]) => `${note}=${file}`)
    .sort()
    .join(",");
  return `${baseUrl}#${assets}`;
}

const PACKS: ReadonlyMap<string, SamplePack> = new Map(
  manifest.packs.map((pack) => {
    const baseUrl = `${pack.baseUrl}/`;
    const urls = Object.fromEntries(
      pack.files.map((file) => [file.note, file.processedFileName]),
    );
    return [
      pack.id,
      {
        id: pack.id,
        baseUrl,
        urls,
        bytes: pack.bytes,
        bankKey: bankKeyOf(baseUrl, urls),
        trimDb: TRIM_DB[pack.id] ?? 0,
      },
    ];
  }),
);

export function samplePackFor(
  instrumentId: string,
  presetId: string,
): SamplePack | undefined {
  return PACKS.get(`${instrumentId}/${presetId}`);
}

export const SAMPLE_LICENSE = manifest.license;

export function totalSampleBytes(): number {
  return manifest.totalBytes;
}
