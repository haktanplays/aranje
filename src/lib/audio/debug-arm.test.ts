import { describe, expect, it } from "vitest";

import { debugArmed } from "@/lib/audio/debug-arm";

/*
 * The rule that decides whether the transport can be read from outside.
 *
 * It exists as a function because the old inline check cost a whole live
 * acceptance run: the guided route is opened by a person tapping a link, and
 * a person does not type `?debug=1`. The handle was therefore absent, the
 * watcher read nothing, and every transport control came back ISSUE while the
 * reader had in fact used all of them.
 */
describe("debugArmed", () => {
  it("arms for the query the harnesses have always used", () => {
    expect(debugArmed("?debug=1", "/")).toBe(true);
    expect(debugArmed("?debug", "/")).toBe(true);
  });

  it("arms on an eval route without anyone typing a query", () => {
    expect(debugArmed("", "/eval/android-acceptance")).toBe(true);
    expect(debugArmed("", "/eval/android-acceptance/")).toBe(true);
  });

  it("stays off on the app the reader normally opens", () => {
    expect(debugArmed("", "/")).toBe(false);
    expect(debugArmed("?practice=1", "/")).toBe(false);
  });

  /*
   * A prefix, not a substring: a route that merely mentions the word is not a
   * measured surface, or anyone could arm the handle by naming a project.
   */
  it("is not fooled by a path that only contains the word", () => {
    expect(debugArmed("", "/my-eval/")).toBe(false);
    expect(debugArmed("", "/songs/evaluation")).toBe(false);
  });
});
