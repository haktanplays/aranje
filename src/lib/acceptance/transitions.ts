/**
 * What the transport actually did, in the order it did it (K-59.1 §7).
 *
 * The first version of this asked a poll "is it playing right now?" and kept
 * a boolean. That is a question about the instant the timer happened to fire,
 * not about what the reader did, and it fails in both directions: a passage
 * that starts and ends between two ticks never happened, and a pause held for
 * one tick is indistinguishable from a transport that never ran.
 *
 * So this is a log. Each sample is compared with the one before it, and a
 * transition is recorded once, by name, in sequence. Recording is idempotent:
 * feeding the same sample twice adds nothing, so a fast poll costs accuracy
 * nothing and a slow one loses less.
 *
 * ## Evidence that outlives the moment
 *
 * Some states are evidence of a transition the poll may have missed:
 * `ended` can only follow playing, and a transport sitting at a non-zero
 * position while paused can only have got there by running or by being sent.
 * Those count. What does not count is a guess: nothing here infers a
 * transition the samples cannot support.
 */
export type TransportStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type TransportSample = {
  readonly status: TransportStatus;
  readonly ticks: number;
  readonly barIndex: number;
  readonly loopOn: boolean;
  /** The practice speed the settings store is actually holding. */
  readonly percent: number;
  /** True when the play control still offers to play. */
  readonly offersPlay: boolean;
};

export type TransportEvent =
  | "play"
  | "pause"
  | "resume"
  | "seek"
  | "loop"
  | "tempo"
  | "rewind";

export type TransportLog = {
  readonly order: readonly TransportEvent[];
  readonly played: boolean;
  readonly paused: boolean;
  readonly resumed: boolean;
  /** The bar the reader jumped to, in zero-based index. */
  readonly seekedBarIndex: number | null;
  readonly loopSeen: boolean;
  /** A confirmed practice speed away from the default, or null. */
  readonly tempoPercent: number | null;
  readonly rewound: boolean;
  /** The engine claims to play while the button still offers to. */
  readonly desyncTicks: number;
  readonly desync: boolean;
  /** The highest position seen, so a rewind has something to be back from. */
  readonly maxTicks: number;
};

export const DEFAULT_PERCENT = 100;
/** Three samples of disagreement, so a transition is not one. */
export const DESYNC_TICKS = 3;

export function emptyTransportLog(): TransportLog {
  return {
    order: [],
    played: false,
    paused: false,
    resumed: false,
    seekedBarIndex: null,
    loopSeen: false,
    tempoPercent: null,
    rewound: false,
    desyncTicks: 0,
    desync: false,
    maxTicks: 0,
  };
}

const note = (
  order: readonly TransportEvent[],
  event: TransportEvent,
  already: boolean,
): readonly TransportEvent[] => (already ? order : [...order, event]);

/**
 * Fold one sample into the log.
 *
 * `previous` is the sample before it, or null for the first one. Pure, so the
 * same pair always produces the same log and a test can state a whole session
 * as a list.
 */
export function observeTransport(
  log: TransportLog,
  sample: TransportSample,
  previous: TransportSample | null,
): TransportLog {
  let order = log.order;

  /*
   * Playing, or something that could only have followed playing. `ended` is
   * the transport having reached the end of the song, which no amount of
   * seeking produces on its own.
   */
  const nowPlaying = sample.status === "playing";
  const played = log.played || nowPlaying || sample.status === "ended";
  if (played && !log.played) order = note(order, "play", false);

  /*
   * A pause is the transition into it, or a transport standing still
   * somewhere other than the beginning — which it cannot be unless it ran.
   */
  const stopped = sample.status === "paused";
  const paused =
    log.paused ||
    (stopped && (previous?.status === "playing" || sample.ticks > 0));
  if (paused && !log.paused) order = note(order, "pause", false);

  const resumed = log.resumed || (nowPlaying && log.paused);
  if (resumed && !log.resumed) order = note(order, "resume", false);

  /*
   * A seek is the position moving while nothing is playing. Measured as a
   * *change*, so the bar the fixture opens on is not mistaken for a jump, and
   * the playhead crossing a bar under its own power is not either.
   */
  const jumped =
    !nowPlaying &&
    previous !== null &&
    previous.status !== "playing" &&
    sample.barIndex !== previous.barIndex &&
    sample.barIndex > 0;
  const seekedBarIndex = log.seekedBarIndex ?? (jumped ? sample.barIndex : null);
  if (seekedBarIndex !== null && log.seekedBarIndex === null) {
    order = note(order, "seek", false);
  }

  const loopSeen = log.loopSeen || sample.loopOn;
  if (loopSeen && !log.loopSeen) order = note(order, "loop", false);

  /*
   * The speed comes from the settings the app is actually holding, not from a
   * class on a button: a pill that looks changed and a transport that plays
   * at the old rate is the failure this is here to catch.
   */
  const tempoPercent =
    log.tempoPercent ?? (sample.percent !== DEFAULT_PERCENT ? sample.percent : null);
  if (tempoPercent !== null && log.tempoPercent === null) {
    order = note(order, "tempo", false);
  }

  const maxTicks = Math.max(log.maxTicks, sample.ticks);
  const rewound = log.rewound || (log.maxTicks > 0 && sample.ticks === 0 && !nowPlaying);
  if (rewound && !log.rewound) order = note(order, "rewind", false);

  const desyncTicks = nowPlaying && sample.offersPlay ? log.desyncTicks + 1 : 0;

  return {
    order,
    played,
    paused,
    resumed,
    seekedBarIndex,
    loopSeen,
    tempoPercent,
    rewound,
    desyncTicks,
    desync: log.desync || desyncTicks >= DESYNC_TICKS,
    maxTicks,
  };
}

/** Run a whole session through the fold. The shape every test states. */
export function foldTransport(
  samples: readonly TransportSample[],
  from: TransportLog = emptyTransportLog(),
): TransportLog {
  let log = from;
  let previous: TransportSample | null = null;
  for (const sample of samples) {
    log = observeTransport(log, sample, previous);
    previous = sample;
  }
  return log;
}
