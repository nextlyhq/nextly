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
      // If a reload is already in flight, drop the event. The in-flight
      // reload will pick up the latest config when it runs.
      if (g.__nextly_hmrReload instanceof Promise) return;
      if (typeof event.data !== "string") return;

      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      // Defensive: Next.js has shipped both shapes historically.
      // Next 15 used data.action; Next 16 uses data.type. Accept both.
      if (typeof data !== "object" || data === null) return;
      const record = data as { type?: unknown; action?: unknown };
      const isServerChange =
        record.type === "serverComponentChanges" ||
        record.action === "serverComponentChanges";

      if (isServerChange) {
        g.__nextly_hmrReload = true;
      }
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

// Returns true if HMR signaled a reload since the last call. Resets the
// flag in the process. Returns false if a reload is already in flight
// (the caller should await the in-flight promise instead).
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
