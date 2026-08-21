/**
 * One history, and no way around it (spec 13.13, K-44).
 *
 * The multi-step promise only holds while there is exactly one place that
 * commits and exactly one list of snapshots. A component that kept its own
 * `useState` undo stack, or reached into the store's array, would look right
 * on screen and quietly give one surface a different past from another —
 * which the reader would only discover by pressing undo and getting music
 * from a branch they abandoned.
 *
 * Read from disk on purpose. These are properties of the wiring rather than
 * of any function, and wiring is what decays the moment someone needs an undo
 * "just here".
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const COMPONENTS = "src/components/workspace";

const components = readdirSync(COMPONENTS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, text: readFileSync(`${COMPONENTS}/${name}`, "utf8") }));

const read = (path: string) => readFileSync(path, "utf8");

describe("26. no component owns a history", () => {
  it("has components to check", () => {
    expect(components.length).toBeGreaterThan(5);
  });

  it("never touches the snapshot list", () => {
    for (const source of components) {
      expect(source.text, source.name).not.toContain("snapshots");
    }
  });

  it("never does cursor arithmetic", () => {
    for (const source of components) {
      expect(source.text, source.name).not.toMatch(/cursor\s*[+-]/);
      expect(source.text, source.name).not.toContain("recordEdit");
    }
  });

  it("keeps no second undo stack of its own", () => {
    /*
     * A `useState` holding anything called past/future/history/undo/redo is
     * the shape the second stack always takes. The Workspace may hold *sheet*
     * state with those words in it, so the check is on `useState` lines only.
     */
    for (const source of components) {
      const suspicious = source.text
        .split("\n")
        .filter((line) => /useState[<(]/.test(line))
        .filter((line) => /\b(past|future|history|undoStack|redoStack)\b/i.test(line));
      expect(suspicious, source.name).toEqual([]);
    }
  });

  it("never writes to storage itself", () => {
    for (const source of components) {
      expect(source.text, source.name).not.toContain("localStorage");
      expect(source.text, source.name).not.toContain("HISTORY_KEY");
    }
  });
});

describe("27. every mutation path goes through the one gate", () => {
  const workspace = read(`${COMPONENTS}/Workspace.tsx`);

  it("commits only through the song handle", () => {
    // The Workspace is allowed to call `commit`; nobody else is, and the only
    // `commit` in scope there is the one `useSong` hands it.
    expect(workspace).toContain("useSong");
    for (const source of components) {
      if (source.name === "Workspace.tsx") continue;
      expect(source.text, source.name).not.toMatch(/\bcommit\(/);
    }
  });

  it("names an action at every commit, so no step is anonymous", () => {
    const calls = workspace.match(/commit\([\s\S]{0,200}?\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toContain("kind:");
    }
  });

  it("routes riff edits, group moves and the Copilot through it", () => {
    expect(workspace).toMatch(/commit\(result\.song, \{ kind: "note_edit" \}\)/);
    expect(workspace).toMatch(/commit\(result\.song, \{ kind: "group_move" \}\)/);
    expect(workspace).toContain('kind: "copilot_apply"');
  });

  it("routes selection and bar transforms through their hooks", () => {
    expect(read("src/lib/song/use-transform.ts")).toContain(
      'kind: "selection_transform"',
    );
    expect(read("src/lib/song/use-bar-transform.ts")).toContain(
      'kind: "bar_transform"',
    );
    // And those hooks are the only things that reach the cores.
    for (const source of components) {
      expect(source.text, source.name).not.toContain("applyBarCommand");
      expect(source.text, source.name).not.toContain("applyTransform");
    }
  });

  it("leaves the store as the only module that records a step", () => {
    const store = read("src/lib/song/song-store.ts");
    expect(store).toContain("recordEdit");

    const owners = [
      "src/lib/song/song-store.ts",
      "src/lib/song/edit-history.ts",
      "src/lib/song/edit-history.test.ts",
      "src/lib/song/history-store.test.ts",
      "src/lib/song/history-boundary.test.ts",
    ];
    const others = readdirSync("src/lib/song")
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `src/lib/song/${name}`)
      .filter((path) => !owners.includes(path));
    for (const path of others) {
      expect(read(path), path).not.toContain("recordEdit(");
    }
  });
});

describe("28. the history never leaves the session", () => {
  it("is not persisted", () => {
    const store = read("src/lib/song/song-store.ts");
    const history = read("src/lib/song/edit-history.ts");
    for (const text of [store, history]) {
      expect(text).not.toContain("HISTORY_KEY");
    }
    // The store writes exactly one thing, and it is the song.
    expect(store).toContain("saveSong(song");
  });

  it("is not part of what a Copilot request is made of", () => {
    const fingerprint = read("src/lib/copilot/fingerprint.ts");
    const contract = read("src/lib/copilot/contract.ts");
    for (const word of ["history", "snapshots", "cursor", "undo", "redo"]) {
      expect(fingerprint.toLowerCase(), `fingerprint: ${word}`).not.toContain(
        word,
      );
      expect(contract.toLowerCase(), `contract: ${word}`).not.toContain(word);
    }
  });

  it("is not part of the Song contract", () => {
    const schema = read("src/lib/song/schema.ts").toLowerCase();
    for (const word of ["snapshots", "actionfromprevious", "undodepth"]) {
      expect(schema, word).not.toContain(word);
    }
  });
});

describe("29. the limit is central", () => {
  it("lives in limits.ts and nowhere else", () => {
    expect(read("src/lib/limits.ts")).toContain("maxUndoSteps");
    for (const source of components) {
      expect(source.text, source.name).not.toContain("maxUndoSteps");
      expect(source.text, source.name).not.toMatch(/\b50\b\s*(?:\/\/.*)?$/m);
    }
  });
});
