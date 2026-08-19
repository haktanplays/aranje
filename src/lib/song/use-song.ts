"use client";

import { useSyncExternalStore } from "react";

import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { loadSong, type LoadResult } from "@/lib/song/storage";

/*
 * localStorage is an external store, so it is read through useSyncExternalStore
 * rather than an effect. The read happens once and the result is cached, since
 * getSnapshot must return a stable value.
 *
 * Nothing changes the song yet, so there is nothing to subscribe to.
 */
const NO_CHANGES = () => () => {};

let clientSnapshot: LoadResult | null = null;

function getClientSnapshot(): LoadResult {
  clientSnapshot ??= loadSong();
  return clientSnapshot;
}

/* Prerender and hydration show the sample song; the stored song replaces it as
   soon as the client can reach storage. */
const SERVER_SNAPSHOT: LoadResult = { song: SAMPLE_SONG, outcome: "empty" };

function getServerSnapshot(): LoadResult {
  return SERVER_SNAPSHOT;
}

export function useSong(): LoadResult {
  return useSyncExternalStore(NO_CHANGES, getClientSnapshot, getServerSnapshot);
}
