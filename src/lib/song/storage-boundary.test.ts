/**
 * Storage decisions live in one place (spec 13.14, K-45).
 *
 * Recovery is the code that runs when everything else has already failed, and
 * it is the code with the most power to make things worse: it quarantines,
 * it clears keys, it decides whether a file is worth keeping. A component
 * reaching for `localStorage` "just to check" is how that power ends up in a
 * render pass, in a place with no tests around it.
 *
 * Read from disk on purpose. These are facts about the wiring rather than
 * about any function.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema } from "@/lib/song/schema";

const COMPONENTS = "src/components/workspace";

const components = readdirSync(COMPONENTS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, text: readFileSync(`${COMPONENTS}/${name}`, "utf8") }));

const read = (path: string) => readFileSync(path, "utf8");

const songModules = readdirSync("src/lib/song")
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => `src/lib/song/${name}`);

describe("30. no component touches storage", () => {
  it("has components to check", () => {
    expect(components.length).toBeGreaterThan(5);
  });

  it("never names the browser store", () => {
    for (const source of components) {
      expect(source.text, source.name).not.toContain("localStorage");
      expect(source.text, source.name).not.toContain("sessionStorage");
    }
  });

  it("never decides what an envelope version means", () => {
    for (const source of components) {
      expect(source.text, source.name).not.toContain("SONG_ENVELOPE_VERSION");
      expect(source.text, source.name).not.toContain("decideLoad");
      expect(source.text, source.name).not.toContain("nextEnvelope");
    }
  });

  it("never parses a song out of a string", () => {
    for (const source of components) {
      expect(source.text, source.name).not.toContain("JSON.parse");
      expect(source.text, source.name).not.toContain("songSchema");
    }
  });

  it("never writes a quarantine key", () => {
    for (const source of components) {
      expect(source.text, source.name).not.toContain("CORRUPT_KEY_PREFIX");
      expect(source.text, source.name).not.toContain("aranje.corrupt.");
    }
  });

  it("takes the recovery message as a value, not as a sentence it builds", () => {
    const banner = read(`${COMPONENTS}/RecoveryBanner.tsx`);
    // Every sentence lives in the table; the banner only places one.
    for (const fragment of ["Son kayıt", "Bozuk veri", "kaydedilemedi"]) {
      expect(banner, fragment).not.toContain(fragment);
    }
    expect(read("src/lib/song/storage.ts")).toContain("RECOVERY_MESSAGES");
  });
});

describe("31. the history stays out of the file", () => {
  it("is never part of what is serialised", () => {
    const envelope = read("src/lib/song/storage-envelope.ts");
    for (const word of ["snapshots", "cursor", "actionFromPrevious"]) {
      expect(envelope, word).not.toContain(word);
    }
  });

  it("has no storage key of its own", () => {
    const store = read("src/lib/song/song-store.ts");
    expect(store).not.toContain("HISTORY_KEY");
  });
});

describe("32. recovery is not part of a Copilot request", () => {
  it("stays out of the fingerprint and the contract", () => {
    const fingerprint = read("src/lib/copilot/fingerprint.ts").toLowerCase();
    const contract = read("src/lib/copilot/contract.ts").toLowerCase();
    for (const word of ["revision", "envelope", "recovery", "previous"]) {
      expect(fingerprint, `fingerprint: ${word}`).not.toContain(word);
      expect(contract, `contract: ${word}`).not.toContain(word);
    }
  });

  it("stays out of the Song contract", () => {
    const schema = read("src/lib/song/schema.ts").toLowerCase();
    for (const word of ["envelope", "revision"]) {
      expect(schema, word).not.toContain(word);
    }
    /*
     * "previous" is an ordinary word — the contract uses it about ties — so
     * the check that matters is behavioural: the Song schema must refuse an
     * envelope outright. If it ever accepted one, `decideLoad` would read a
     * wrapper as a song and the two formats would stop being distinguishable.
     */
    expect(
      songSchema.safeParse({
        format: "aranje.song",
        version: 1,
        revision: 1,
        current: SAMPLE_SONG,
        previous: null,
      }).success,
    ).toBe(false);
  });
});

describe("33. the song and the settings keep separate keys", () => {
  it("are two keys under one prefix, and neither reads the other's", () => {
    const settings = read("src/lib/settings/settings.ts");
    const storage = read("src/lib/song/storage.ts");
    expect(settings).toContain("SETTINGS_KEY");
    expect(settings).not.toContain("SONG_KEY");
    expect(storage).not.toContain("SETTINGS_KEY");
  });

  it("keeps recovery away from the settings key entirely", () => {
    const envelope = read("src/lib/song/storage-envelope.ts");
    expect(envelope).not.toContain("settings");
  });
});

describe("34. nothing saves on the way out", () => {
  it("registers no unload or visibility listener anywhere", () => {
    /*
     * There is no flush-on-close, and there must not be: every edit is already
     * written at the moment it happens. A listener here would be a second
     * write path that only runs when the page is disappearing — the worst
     * possible time to discover it is wrong.
     */
    const sources = [...components.map((entry) => entry.text), ...songModules.map(read)];
    for (const text of sources) {
      expect(text).not.toContain("beforeunload");
      expect(text).not.toContain("visibilitychange");
      expect(text).not.toContain("pagehide");
    }
  });

  it("adds no timer-driven autosave", () => {
    const storage = read("src/lib/song/storage.ts");
    const store = read("src/lib/song/song-store.ts");
    for (const text of [storage, store]) {
      expect(text).not.toContain("setInterval");
      expect(text).not.toContain("setTimeout");
    }
  });
});
