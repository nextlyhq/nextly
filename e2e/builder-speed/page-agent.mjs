/**
 * What runs inside the measured page: the counters installed in every frame
 * before the page's own scripts, and the checks the timing probe runs in
 * every animation frame. Both are serialised into the page, so each function
 * here uses nothing from outside its own body.
 *
 * @module builder-speed/page-agent
 */

/**
 * Installed in every frame before any of the page's scripts. Counts React
 * commits (through a stand-in for the DevTools hook), long tasks, and the
 * admin requests the page sends with the time it sent them; and offers the
 * checks `visible` runs in every animation frame. Times are milliseconds since
 * the epoch (`timeOrigin + now`), so the admin's frame and the canvas frame,
 * which keep separate clocks, can be compared.
 */
export function pageAgent() {
  const now = () => performance.timeOrigin + performance.now();
  const speed = {
    commits: 0,
    longTasks: [],
    sent: [],
    probe: null,
  };
  window.__builderSpeed = speed;
  // React reads this hook once, when it loads, and reports each commit.
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot() {
      speed.commits += 1;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries())
        speed.longTasks.push({
          start: performance.timeOrigin + entry.startTime,
          duration: entry.duration,
        });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // No long-task timing in this frame.
  }
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    let entry = null;
    try {
      const request = input instanceof Request ? input : null;
      const url =
        request !== null
          ? request.url
          : input instanceof URL
            ? input.href
            : typeof input === "string"
              ? input
              : "";
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      entry = { url, method, t: now(), done: null };
      speed.sent.push(entry);
    } catch {
      // Recording never stands in the way of the request.
    }
    const answer = originalFetch.apply(this, arguments);
    // When the answer arrived, on the same clock, for round trips and saves.
    answer.then(
      () => {
        if (entry) entry.done = now();
      },
      () => {
        if (entry) entry.done = now();
      }
    );
    return answer;
  };
  // The first input event of the kind armed, in this frame or the canvas's.
  const onInput = event => {
    const probe = window.top?.__builderSpeed?.probe;
    if (!probe || probe.start !== null || !probe.on.includes(event.type))
      return;
    probe.start = performance.timeOrigin + event.timeStamp;
  };
  for (const type of ["pointerdown", "pointerup", "keydown"])
    window.addEventListener(type, onInput, { capture: true });
}

/**
 * The checks `visible` can run, by name, in the admin's frame. Each reads the
 * canvas frame's document where the result is drawn.
 */
export function pageChecks() {
  const canvas = () =>
    document.querySelector('iframe[title^="Page canvas"]')?.contentDocument ??
    null;
  const node = id =>
    canvas()?.querySelector(`.nx-canvas [data-nx-node="${id}"]`) ?? null;
  const inspector = () => document.querySelector('[data-testid="inspector"]');
  window.__builderSpeedChecks = {
    /** The inspector shows the block whose text is `text`. */
    sidebarShows({ text }) {
      const root = inspector();
      if (!root) return false;
      for (const field of root.querySelectorAll(
        "[data-content-control] input, [data-content-control] textarea"
      ))
        if (field.value === text) return true;
      // A Text's words are edited in a rich field: a text box that holds them
      // as text, editable once the shared editor attaches.
      for (const field of root.querySelectorAll(
        '[data-content-control] [role="textbox"]'
      ))
        if (field.textContent?.trim() === text) return true;
      return false;
    },
    /** The selection outline lies over block `id`. */
    outlineOn({ id }) {
      const frame = document.querySelector('iframe[title^="Page canvas"]');
      const block = node(id);
      const mark = document.querySelector(
        '.nx-canvas-mark[data-mark="selected"]:not([data-hidden])'
      );
      if (!frame || !block || !mark) return false;
      const outer = frame.getBoundingClientRect();
      const scale = frame.offsetWidth ? outer.width / frame.offsetWidth : 1;
      const inner = block.getBoundingClientRect();
      const drawn = mark.getBoundingClientRect();
      // The outline is drawn a few pixels outside the block, so it is
      // matched by its centre and, loosely, its width.
      const x = outer.left + (inner.left + inner.width / 2) * scale;
      const y = outer.top + (inner.top + inner.height / 2) * scale;
      return (
        Math.abs(drawn.left + drawn.width / 2 - x) < 3 &&
        Math.abs(drawn.top + drawn.height / 2 - y) < 3 &&
        Math.abs(drawn.width - inner.width * scale) < 16
      );
    },
    /** Block `id` reads `text` on the canvas. */
    canvasText({ id, text }) {
      return node(id)?.textContent?.trim() === text;
    },
    /** Block `id`'s font size on the canvas is `size`. */
    canvasFontSize({ id, size }) {
      const element = node(id);
      if (!element) return false;
      return (
        element.ownerDocument.defaultView?.getComputedStyle(element)
          .fontSize === size
      );
    },
    /** The page's blocks on the canvas number `count`. */
    canvasBlocks({ count }) {
      return (
        canvas()?.querySelectorAll(".nx-canvas [data-nx-node]").length === count
      );
    },
    /** The canvas has drawn block `id`. */
    canvasDrawn({ id }) {
      const element = node(id);
      return element !== null && element.getBoundingClientRect().height > 0;
    },
    /** The Add panel is open with its blocks listed. */
    addPanelOpen() {
      const search = document.querySelector(
        'input[cmdk-input][placeholder^="Search blocks"]'
      );
      return (
        search !== null &&
        document.querySelectorAll('[role="option"]').length > 0
      );
    },
    /** The editor says the page is saved and has nothing left to save. */
    saved() {
      // The save itself must have been sent after the click and answered:
      // the indicator can still read "saved" from an earlier autosave while
      // the button is already disabled for the save in flight.
      const start = window.__builderSpeed.probe?.start ?? null;
      const answered = window.__builderSpeed.sent.some(
        s =>
          start !== null &&
          s.t >= start &&
          s.done !== null &&
          s.method !== "GET" &&
          s.url.includes("/collections/pages/entries/") &&
          !s.url.includes("/versions/")
      );
      const button = document.querySelector(
        '[data-publish-split] [data-primary="true"]'
      );
      const state = document.querySelector(
        '[data-testid="save-state-indicator"]'
      );
      // The button says it has nothing left to do by `aria-disabled`, kept
      // focusable to explain why, rather than by `disabled`.
      const finished =
        button instanceof HTMLButtonElement &&
        (button.disabled || button.getAttribute("aria-disabled") === "true");
      const tone = state?.getAttribute("data-tone") ?? null;
      // What each part read last, so a measure that never sees the saved
      // state can say which part it waited on.
      window.__builderSpeed.savedParts = {
        answered,
        finished,
        buttonKind: button?.getAttribute("data-state-kind") ?? null,
        tone,
      };
      return answered && finished && tone === "saved";
    },
  };
}
