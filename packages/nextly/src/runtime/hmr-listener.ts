// What: opens a WebSocket to Next.js's dev-server HMR endpoint and flips
// a reload flag when a serverComponentChanges event arrives. The actual
// reload runs lazily on the next getNextly() call (Payload's pattern:
// avoids racing with in-flight request handlers using the old config).
//
// Why this layer exists: the wrapper used to do this via chokidar; with
// the wrapper deleted (PR 4 of F1), we need an in-process signal for
// code-first config edits. Next.js dev server already broadcasts
// file-change events on /_next/webpack-hmr; we just listen.
//
// Stability: the endpoint is documented (Next.js docs explain how to
// proxy it), but the event payload format is internal and has changed
// before (data.action in Next 15 vs data.type in Next 16). We defend
// against both. If a future Next.js minor breaks both shapes, code-first
// auto-reload silently degrades; manual server restart still works.

import { WebSocket } from "ws";

// Process-wide cache lives on globalThis so listener state survives
// Turbopack HMR module re-execution. Same pattern as init.ts and the
// drizzle-kit-lazy module.
type HmrCache = {
  __nextly_hmrWs?: WebSocket;
  __nextly_hmrReload?: boolean | Promise<void>;
};

const g = globalThis as HmrCache;

// Opens the WebSocket if not already open. Idempotent. Skips silently
// in production, tests, or when explicitly disabled. Errors during
// connection are swallowed so the dev process never crashes from a
// transient HMR setup hiccup; the cost is silent loss of auto-reload
// in those rare cases.
export function ensureHmrListener(): void {
  if (g.__nextly_hmrWs) return;
  if (process.env.NODE_ENV === "production") return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.NEXTLY_DISABLE_HMR === "1") return;

  try {
    const port = process.env.PORT ?? "3000";
    const hasHttps =
      process.env.USE_HTTPS === "true" ||
      process.argv.includes("--experimental-https");
    const protocol = hasHttps ? "wss" : "ws";
    const prefix = process.env.__NEXT_ASSET_PREFIX ?? "";
    const url =
      process.env.NEXTLY_HMR_URL_OVERRIDE ??
      `${protocol}://localhost:${port}${prefix}/_next/webpack-hmr`;

    g.__nextly_hmrWs = new WebSocket(url);

    g.__nextly_hmrWs.onmessage = event => {
      if (typeof event.data !== "string") return;
      handleHmrMessage(event.data);
    };

    g.__nextly_hmrWs.onerror = () => {
      // Silent: dev WS errors are common (port mismatch, server not yet
      // bound, etc.) and not actionable here. The flag system degrades
      // gracefully. Without a listener, code-first auto-reload stops;
      // manual restarts still work.
    };
  } catch {
    // Same logic as onerror.
  }
}

// Debounce window for serverComponentChanges events. Next.js dev server
// emits one event per server-file save, and bursty editor saves (a save
// + auto-save chase, e.g. when ESLint --fix runs on save) used to each
// fire a full reloadNextlyConfig pipeline — including a Neon
// information_schema.columns roundtrip per HMR cycle. 300ms trailing
// debounce collapses bursts without making the reload feel laggy.
const HMR_DEBOUNCE_MS = 300;

// Stores the pending debounce timer so a follow-up event can reset it.
type HmrDebounceCache = {
  __nextly_hmrDebounce?: ReturnType<typeof setTimeout>;
};
const debounceCache = globalThis as HmrDebounceCache;

// Production reloader — resolved lazily on first use to avoid loading
// the full schema pipeline at module evaluation time in production.
// Tests override this via __setReloaderForTest before calling
// handleHmrMessageForTest, bypassing the need for vi.doMock + dynamic
// import inside a fake-timer callback (which cannot be awaited
// predictably under vi.useFakeTimers()).
let _reloaderFn: (() => Promise<void>) | null = null;

// Gets (or lazily loads) the reloadNextlyConfig function.
async function getReloader(): Promise<() => Promise<void>> {
  if (_reloaderFn) return _reloaderFn;
  const { reloadNextlyConfig } = await import("../init/reload-config");
  return reloadNextlyConfig;
}

// Test seam: allows unit tests to inject a mock reloader so they can
// control the reload function without relying on vi.doMock + dynamic
// imports inside fake-timer callbacks (which cannot be awaited
// predictably under vi.useFakeTimers()). Reset to null between tests.
export function __setReloaderForTest(fn: (() => Promise<void>) | null): void {
  _reloaderFn = fn;
}

function scheduleReload(): void {
  // If a reload is already running, let it complete and pick up the
  // latest config when it finishes. The previous behaviour (drop the
  // event) is preserved here for the same reason it was preserved
  // before.
  if (g.__nextly_hmrReload instanceof Promise) return;

  // Reset any pending debounce timer.
  if (debounceCache.__nextly_hmrDebounce) {
    clearTimeout(debounceCache.__nextly_hmrDebounce);
  }
  debounceCache.__nextly_hmrDebounce = setTimeout(() => {
    delete debounceCache.__nextly_hmrDebounce;
    if (g.__nextly_hmrReload instanceof Promise) return;
    const reload = (async () => {
      try {
        const reloadFn = await getReloader();
        await reloadFn();
      } catch {
        // Errors already logged inside reloadNextlyConfig.
      }
    })();
    markHmrReloadInFlight(reload);
  }, HMR_DEBOUNCE_MS);
}

function handleHmrMessage(raw: string): void {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof data !== "object" || data === null) return;
  const record = data as { type?: unknown; action?: unknown };
  const isServerChange =
    record.type === "serverComponentChanges" ||
    record.action === "serverComponentChanges";
  if (isServerChange) scheduleReload();
}

// Test seam. Production code uses the WS onmessage closure above; tests
// bypass the WebSocket and invoke the message handler directly.
// Exporting under a `*ForTest` name keeps the production API stable.
export function handleHmrMessageForTest(raw: string): void {
  handleHmrMessage(raw);
}

// Returns true exactly when HMR signaled a reload since the last call,
// and resets the flag. Returns false in two cases that the caller should
// treat the same way: (1) no event has fired, (2) a reload is already in
// flight from a peer request. In case (2) the in-flight reload will
// finish for the peer; this caller may proceed with the current cached
// instance and pick up the new schema on a subsequent call.
export function consumeHmrReloadFlag(): boolean {
  if (g.__nextly_hmrReload === true) {
    g.__nextly_hmrReload = false;
    return true;
  }
  return false;
}

// Marks a reload as in-flight by storing its promise. Subsequent HMR
// events during the reload are ignored (the in-flight reload picks up
// whatever is latest when it runs). When the promise settles, the flag
// clears unless another reload was scheduled during the in-flight one.
export function markHmrReloadInFlight(promise: Promise<void>): void {
  g.__nextly_hmrReload = promise;
  void promise.finally(() => {
    if (g.__nextly_hmrReload === promise) {
      g.__nextly_hmrReload = false;
    }
  });
}
