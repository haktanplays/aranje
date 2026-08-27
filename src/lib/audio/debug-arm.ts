/**
 * Whether the transport may be read from outside the app (spec 8.4/8.5).
 *
 * Two ways in, and both are deliberate:
 *
 * - `?debug=1`, which is what every browser harness has always appended;
 * - any route under `/eval/`, which is a measured surface by definition.
 *
 * The second one is not a convenience. The guided Android route is opened by
 * a person tapping a link, and a person does not type a query string — so on
 * the live run the handle was simply absent, the watcher read `idle` forever,
 * and the result block reported every transport control as a problem while
 * the reader had used all of them. A measurement that cannot see is worse
 * than no measurement, because it produces confident wrong answers.
 *
 * It stays off on the app itself. Reading only, either way: nothing behind
 * this flag can drive playback.
 */
const MEASURED_PREFIX = "/eval/";

export function debugArmed(search: string, pathname: string): boolean {
  if (new URLSearchParams(search).has("debug")) return true;
  return pathname.startsWith(MEASURED_PREFIX);
}
