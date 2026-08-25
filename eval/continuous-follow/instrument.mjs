/**
 * Counters installed before the app's first line (2Q-C §1.2).
 *
 * Everything here answers a question the DOM cannot be asked afterwards:
 * how many listeners were *added*, how many observers were *constructed*, how
 * many times `scrollLeft` was *written*. A count taken at the end would miss
 * every one that was removed, and removal is not the thing being measured.
 *
 * It is a string rather than a function because it is evaluated inside the
 * page through `addInitScript`, before any bundle runs.
 */
export const INSTRUMENT = `
  window.__probe = {
    listeners: 0,
    listenersByType: {},
    observers: { resize: 0, intersection: 0, mutation: 0 },
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
  })();

  (() => {
    const wrap = (name, key) => {
      const Original = window[name];
      if (!Original) return;
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
      const match = /translateX\(([-0-9.]+)px\)/.exec(transform);
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
      scrollLeftWrites:
        window.__probe.scrollLeftWrites - (window.__probe.scrollLeftWritesAtStart ?? 0),
    };
  })();
`;
