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

const PACKS: ReadonlyMap<string, SamplePack> = new Map(
  manifest.packs.map((pack) => [
    pack.id,
    {
      id: pack.id,
      baseUrl: `${pack.baseUrl}/`,
      urls: Object.fromEntries(
        pack.files.map((file) => [file.note, file.processedFileName]),
      ),
      bytes: pack.bytes,
      trimDb: TRIM_DB[pack.id] ?? 0,
    },
  ]),
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
