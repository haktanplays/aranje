/**
 * The three graph calls the mixer is allowed to make (2L-C, 2Q-A §14).
 *
 * A binder, extracted from the composition root without changing what it
 * does. It was ten lines of `bind` inside `Workspace.tsx` whose only job was
 * to hand the mixer a stable object; the root has a line budget and this was
 * never root work.
 *
 * The narrow shape is the point: the mixer can preview a level, put the
 * levels back, and say who is heard. It cannot start, stop, seek or schedule
 * anything, because none of those are a mixer's business.
 */
import type { MixerAudio } from "@/lib/workspace/use-mixer";

/** The controller methods the mixer needs, named rather than passed whole. */
type MixerCapableTransport = {
  setTrackMix(trackId: string, volumeDb: number, pan: number): void;
  clearTrackMixPreview(): void;
  setTrackAudibility(audibleTrackIds: readonly string[]): void;
};

export function mixerAudioOf(transport: MixerCapableTransport): MixerAudio {
  return {
    previewMix: transport.setTrackMix.bind(transport),
    clearPreview: transport.clearTrackMixPreview.bind(transport),
    setAudibility: transport.setTrackAudibility.bind(transport),
  };
}
