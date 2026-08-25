/**
 * Counters installed before the app's first line (2Q-C §1.2).
 *
 * Everything here answers a question the DOM cannot be asked afterwards:
 * how many listeners were *added* and *removed*, how many observers were
 * *constructed*, how
 * many times `scrollLeft` was *written*. A count taken at the end would miss
 * every one that was removed, and removal is not the thing being measured.
 *
 * It is a string rather than a function because it is evaluated inside the
 * page through `addInitScript`, before any bundle runs.
 */
export const INSTRUMENT = `
  window.__probe = {
    listeners: 0,
    listenersRemoved: 0,
    listenersByType: {},
    observers: { resize: 0, intersection: 0, mutation: 0 },
    observersDisconnected: { resize: 0, intersection: 0, mutation: 0 },
    timersSet: 0,
    timersCleared: 0,
    intervalsSet: 0,
    intervalsCleared: 0,
    audioContexts: 0,
    scrollLeftWrites: 0,
    sampleRequests: 0,
    externalRequests: [],
    longTasks: [],
    frames: [],
    scrollSamples: [],
    recording: false,
  };
  window.__playheadProbe = { scheduled: {}, drawn: {}, live: {} };

  (() => {
    const addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      window.__probe.listeners += 1;
      const by = window.__probe.listenersByType;
      by[type] = (by[type] || 0) + 1;
      return addEventListener.call(this, type, listener, options);
    };
    /*
     * The other side of the ledger. A windowed surface attaches a handler for
     * every bar it mounts and detaches it when the bar leaves; counting only
     * the additions would call that a leak.
     */
    const removeEventListener = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      window.__probe.listenersRemoved += 1;
      return removeEventListener.call(this, type, listener, options);
    };
  })();

  (() => {
    /*
     * Both sides of an observer's life. A windowed surface constructs one per
     * mounted scroller and disconnects it on cleanup; counting constructions
     * alone reported 72 across 46 taps for a surface that was holding exactly
     * one at a time.
     */
    const wrap = (name, key) => {
      const Original = window[name];
      if (!Original) return;
      const disconnect = Original.prototype.disconnect;
      Original.prototype.disconnect = function () {
        window.__probe.observersDisconnected[key] += 1;
        return disconnect.call(this);
      };
      window[name] = new Proxy(Original, {
        construct(target, args) {
          window.__probe.observers[key] += 1;
          return Reflect.construct(target, args);
        },
      });
    };
    wrap("ResizeObserver", "resize");
    wrap("IntersectionObserver", "intersection");
    wrap("MutationObserver", "mutation");
  })();

  (() => {
    // Timers, for the same reason: an interval left running after a project
    // is replaced is a leak that no listener count would show.
    const setTimeout_ = window.setTimeout;
    const clearTimeout_ = window.clearTimeout;
    const setInterval_ = window.setInterval;
    const clearInterval_ = window.clearInterval;
    window.setTimeout = function (...args) {
      window.__probe.timersSet += 1;
      return setTimeout_.apply(window, args);
    };
    window.clearTimeout = function (...args) {
      window.__probe.timersCleared += 1;
      return clearTimeout_.apply(window, args);
    };
    window.setInterval = function (...args) {
      window.__probe.intervalsSet += 1;
      return setInterval_.apply(window, args);
    };
    window.clearInterval = function (...args) {
      window.__probe.intervalsCleared += 1;
      return clearInterval_.apply(window, args);
    };
  })();

  (() => {
    // A Proxy on the constructor rather than a subclass: a subclass breaks
    // Tone's decoder and would measure the instrument instead of the app.
    for (const name of ["AudioContext", "webkitAudioContext"]) {
      const Original = window[name];
      if (!Original) continue;
      window[name] = new Proxy(Original, {
        construct(target, args) {
          window.__probe.audioContexts += 1;
          return Reflect.construct(target, args);
        },
      });
    }
  })();

  (() => {
    // Every physical write to scrollLeft, wherever it comes from. The
    // descriptor lives on Element.prototype, so this sees the app's writes and
    // the harness's alike — the harness never writes during a recording.
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(Element.prototype, "scrollLeft", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        window.__probe.scrollLeftWrites += 1;
        return descriptor.set.call(this, value);
      },
    });
  })();

  (() => {
    const original = window.fetch;
    window.fetch = function (input, init) {
      const url = String(typeof input === "string" ? input : (input && input.url) || "");
      if (url.indexOf("/samples/") !== -1) window.__probe.sampleRequests += 1;
      if (/^https?:\\/\\//.test(url) && url.indexOf(location.origin) !== 0) {
        window.__probe.externalRequests.push(url);
      }
      return original.call(this, input, init);
    };
  })();

  (() => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!window.__probe.recording) continue;
          window.__probe.longTasks.push(Math.round(entry.duration * 100) / 100);
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Not every build exposes longtask; the artefact says so rather than
      // reporting a zero it did not measure.
      window.__probe.longTasks = null;
    }
  })();
`;

/** Start a recording window: frames, scroll samples and long tasks. */
export const START_RECORDING = `
  (() => {
    const probe = window.__probe;
    probe.recording = true;
    probe.frames = [];
    probe.scrollSamples = [];
    if (probe.longTasks !== null) probe.longTasks = [];
    probe.scrollLeftWritesAtStart = probe.scrollLeftWrites;
    // The one element that really scrolls horizontally right now. Found by
    // measurement rather than by a selector, so the recording does not depend
    // on a class name the production surface never promised.
    const scroller = [...document.querySelectorAll("*")].find((el) => {
      const style = getComputedStyle(el);
      return (
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth + 1
      );
    }) ?? null;
    // Kept for the report: "a jump bigger than half a screen" needs to know
    // how big the screen is, and asking again at the end could ask a
    // different element.
    probe.scrollerClientWidth = scroller ? scroller.clientWidth : null;
    // Additions and removals, so "listeners grew" can mean the net figure
    // rather than the number of times React ever attached one — a windowed
    // surface attaches a handler for every bar it mounts and detaches it
    // again, and counting only one side calls that a leak.
    probe.listenersAtStart = probe.listeners;
    probe.removedAtStart = probe.listenersRemoved;
    probe.byTypeAtStart = { ...probe.listenersByType };
    let last = performance.now();
    const step = (now) => {
      if (!probe.recording) return;
      probe.frames.push(Math.round((now - last) * 100) / 100);
      last = now;
      /*
       * The playhead is the one element the surface moves by transform. It
       * carries no data attribute in this build, so it is found by the
       * property that makes it what it is rather than by a name added for
       * the measurement — the baseline must be taken on production as it
       * stands, not on production plus a hook.
       */
      const playhead = document.querySelector('div[aria-hidden][style*="will-change"]');
      const transform = playhead ? playhead.style.transform : "";
      /*
       * Escaped twice on purpose. This whole block is a template literal that
       * is eval'd in the page, and a single backslash before a parenthesis
       * inside a template literal is just the parenthesis — which turned the
       * two literal parentheses into capture groups and made the pattern
       * match nothing at all. Every playheadX this harness had ever recorded
       * was null because of it; no reported number used the field, but none
       * could have.
       */
      const match = /translateX\\(([-0-9.]+)px\\)/.exec(transform);
      probe.scrollSamples.push({
        t: Math.round(now),
        scrollLeft: scroller ? Math.round(scroller.scrollLeft * 10) / 10 : null,
        section:
          document.querySelector("[data-viewed-section]")?.getAttribute("data-viewed-section") ??
          null,
        playheadX: match ? Math.round(Number(match[1]) * 10) / 10 : null,
        playheadShown: playhead ? playhead.style.opacity !== "0" : false,
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  })();
`;

export const STOP_RECORDING = `
  (() => {
    window.__probe.recording = false;
    return {
      frames: window.__probe.frames,
      scrollSamples: window.__probe.scrollSamples,
      longTasks: window.__probe.longTasks,
      clientWidth: window.__probe.scrollerClientWidth ?? null,
      listenersAdded: window.__probe.listeners - (window.__probe.listenersAtStart ?? 0),
      listenersByTypeAdded: Object.fromEntries(
        Object.entries(window.__probe.listenersByType)
          .map(([type, count]) => [
            type,
            count - ((window.__probe.byTypeAtStart ?? {})[type] ?? 0),
          ])
          .filter(([, count]) => count !== 0),
      ),
      listenersRemoved:
        window.__probe.listenersRemoved - (window.__probe.removedAtStart ?? 0),
      scrollLeftWrites:
        window.__probe.scrollLeftWrites - (window.__probe.scrollLeftWritesAtStart ?? 0),
    };
  })();
`;
