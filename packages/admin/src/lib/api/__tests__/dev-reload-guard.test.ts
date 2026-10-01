/**
 * The dev-reload EventSource is a development-only convenience: one SSE
 * connection that reloads the page when a code-first schema apply finishes.
 * In production it is worse than useless — the route only exists when the
 * server runs with NODE_ENV=development, so the stream answers 400 and
 * EventSource reconnects against it forever, a request loop on the hosting
 * bill of every deployed admin.
 *
 * It shipped enabled in production anyway: tsup substitutes
 * `process.env.NODE_ENV` with the ambient value at build time, so the guard
 * answered where the LIBRARY was built, never where the host is running.
 * That check no longer lives here at all. The RUNNING server answers through
 * `workspace.devReload` (computed from the same runtime comparison that
 * gates the route), and the provider opens the stream only on an explicit
 * `true` — so these pin the two halves of that contract:
 *
 * - importing this module must never open anything, under either folded
 *   value of NODE_ENV (the old bug fired at import time);
 * - `enableDevReload` opens exactly one stream and refuses duplicates,
 *   because it may be invoked on every workspace refetch.
 *
 * The build config pin stays: the tsup define still governs the OTHER
 * `NODE_ENV` sites in this package (dev-only diagnostics), and defaulting an
 * unset ambient value to production keeps them quiet in release dists.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  // eslint-disable-next-line no-var
  var __nextlyDevReloadEs: EventSource | undefined;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_EVENT_SOURCE = globalThis.EventSource;

beforeEach(() => {
  vi.resetModules();
  delete globalThis.__nextlyDevReloadEs;
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  globalThis.EventSource = ORIGINAL_EVENT_SOURCE;
  delete globalThis.__nextlyDevReloadEs;
});

async function importFetcher() {
  return import("../fetcher");
}

/** A constructible stub recording every URL it is handed. */
function eventSourceRecorder(constructedUrls: string[]) {
  class EventSourceStub {
    addEventListener = vi.fn();
    constructor(url: string) {
      constructedUrls.push(url);
    }
  }
  return EventSourceStub;
}

describe("dev-reload: nothing opens at import", () => {
  it("opens no stream when the bundle folded development", async () => {
    process.env.NODE_ENV = "development";
    const constructedUrls: string[] = [];
    globalThis.EventSource = eventSourceRecorder(
      constructedUrls
    ) as unknown as typeof EventSource;

    await importFetcher();
    // A tick for any module-scope work that might have been queued.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(constructedUrls).toEqual([]);
  });

  it("opens no stream when the bundle folded production", async () => {
    process.env.NODE_ENV = "production";
    const constructedUrls: string[] = [];
    globalThis.EventSource = eventSourceRecorder(
      constructedUrls
    ) as unknown as typeof EventSource;

    await importFetcher();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(constructedUrls).toEqual([]);
  });
});

describe("enableDevReload subscription", () => {
  it("opens the dev-reload stream exactly once", async () => {
    const constructedUrls: string[] = [];
    globalThis.EventSource = eventSourceRecorder(
      constructedUrls
    ) as unknown as typeof EventSource;

    const { enableDevReload } = await importFetcher();
    enableDevReload();
    enableDevReload();
    enableDevReload();

    expect(constructedUrls).toHaveLength(1);
    expect(constructedUrls[0]).toContain("/admin/api/dev-reload");
    expect(globalThis.__nextlyDevReloadEs).toBeDefined();
  });

  it("registers the schema-reload listener that reloads the page", async () => {
    globalThis.EventSource = eventSourceRecorder(
      []
    ) as unknown as typeof EventSource;

    const { enableDevReload } = await importFetcher();
    enableDevReload();

    const addEventListener = (
      globalThis.__nextlyDevReloadEs as unknown as {
        addEventListener: ReturnType<typeof vi.fn>;
      }
    ).addEventListener;
    expect(addEventListener).toHaveBeenCalledWith(
      "schema-reload",
      expect.any(Function)
    );
  });
});

describe("tsup NODE_ENV define", () => {
  // Read as text rather than imported: the vitest module graph won't resolve
  // a config file outside src/. The path is package-relative because
  // import.meta.url is not a file: URL under the jsdom environment; vitest
  // runs with the package root as cwd, and a wrong cwd fails the read loudly.
  const configSource = readFileSync(join("tsup.config.ts"), "utf8");

  it("pins process.env.NODE_ENV for the published browser bundle", () => {
    expect(configSource).toContain('"process.env.NODE_ENV"');
  });

  it("defaults an unset ambient NODE_ENV to production", () => {
    // The release pipeline never sets NODE_ENV; the define must not inherit
    // tsup's own "development" fallback for that case. This governs the
    // package's remaining NODE_ENV sites — dev-only diagnostics — and is
    // deliberately no longer what keeps dev-reload quiet (the server's
    // runtime `devReload` answer is).
    expect(configSource).toMatch(
      /"process\.env\.NODE_ENV"\s*:\s*JSON\.stringify\(\s*process\.env\.NODE_ENV\s*\?\?\s*"production"/
    );
  });
});
