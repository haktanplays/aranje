"use client";

/**
 * Everything above the notation (2S-A §11).
 *
 * The title strip, the recovery banner, the view switch and the section
 * navigator. Four blocks that were in the composition root because they are
 * first on the screen, not because the root had anything to decide about
 * them — and when the edit strip below grew a fourth block of its own, that
 * became the difference between a root that composes and a root that draws.
 *
 * It decides nothing. Every callback belongs to a handle made elsewhere, and
 * the one rule it carries — a time selection belongs to the tab — is the same
 * rule it carried when it was inline.
 */
import { RecoveryBanner } from "@/components/workspace/RecoveryBanner";
import { SectionNavigator } from "@/components/workspace/SectionNavigator";
import { ViewSwitch } from "@/components/workspace/ViewSwitch";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { WorkspaceNavigation } from "@/lib/workspace/use-workspace-navigation";
import type { PlaybackState } from "@/lib/audio/playback";
import type { RecoveryState } from "@/lib/song/storage";
import type { SectionRun } from "@/lib/tab/timeline";
import type { Song } from "@/lib/song/schema";

export function WorkspaceChrome({
  song,
  meter,
  state,
  navigation,
  session,
  runs,
  recovery,
  recoveryMessage,
  onDismissRecovery,
  onInfo,
  onProjects,
  onOpenSectionList,
  onJumpSection,
}: {
  song: Song;
  meter: string;
  state: PlaybackState;
  navigation: WorkspaceNavigation;
  session: SelectionSession;
  runs: readonly SectionRun[];
  recovery: RecoveryState | null;
  recoveryMessage: string | null;
  onDismissRecovery: () => void;
  onInfo: () => void;
  onProjects: () => void;
  onOpenSectionList: () => void;
  onJumpSection: (sectionId: string) => void;
}) {
  return (
    <>
      <WorkspaceHeader
        title={song.title}
        songKey={song.key}
        bpm={song.bpm}
        meter={meter}
        activeBpm={state.activeBpm}
        hasTempoChanges={state.hasTempoChanges}
        onInfo={onInfo}
        onProjects={onProjects}
      />

      {/* One strip, and the recovery state owns it: four states, four
          sentences, and no path from a diagnostic to a musician. */}
      {recovery && recoveryMessage ? (
        <RecoveryBanner
          state={recovery}
          message={recoveryMessage}
          onDismiss={onDismissRecovery}
        />
      ) : null}

      <ViewSwitch
        view={navigation.view}
        onChange={(next) => {
          /*
           * A time selection belongs to the tab: it is a span of time on one
           * track, drawn on a staff that is about to be unmounted. Leaving
           * for either of the other two surfaces drops it — without
           * committing whatever it had staged. The clipboards and the history
           * stay; they belong to the song.
           */
          if (next !== "tab") session.time.clear();
          if (next === "arrange") navigation.showArrange();
          else if (next === "multi") navigation.showMulti();
          else navigation.showTab();
        }}
      />

      {/* Not on the arrangement: it draws every section already (2Q-A §6). */}
      {navigation.view !== "arrange" ? (
        <SectionNavigator
          runs={runs}
          activeSectionId={navigation.viewedSectionId}
          loopSectionId={state.loop.kind === "section" ? state.loop.sectionId : null}
          onJump={onJumpSection}
          onOpenList={onOpenSectionList}
        />
      ) : null}
    </>
  );
}
