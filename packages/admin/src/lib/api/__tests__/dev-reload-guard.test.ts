/**
 * The dev-reload EventSource is a development-only convenience: one SSE
 * connection that reloads the page when a code-first schema apply finishes.
 * In production it is worse than useless — the route only exists when the
 * server runs with NODE_ENV=development, so the stream answers 400 and
 * EventSource reconnects against it forever, a request loop on the hosting
 * bill of every deployed admin.
 *
 * It shipped enabled in production anyway: tsup substitutes
 * `process.env.NODE_ENV` with the ambient value at build time, and its
 * fallback for an unset NODE_ENV is "development", so release builds (which
 * never set it) compiled the guard ON. Two pins keep that from coming back:
 * the source-level guard must respect NODE_ENV, and the build config must
 * define NODE_ENV with a production default.
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

describe("dev-reload EventSource guard", () => {
  it("opens the stream in a development build", async () => {
    process.env.NODE_ENV = "development";
    const constructedUrls: string[] = [];
    class EventSourceStub {
      addEventListener = vi.fn();
      constructor(url: string) {
        constructedUrls.push(url);
      }
    }
    globalThis.EventSource = EventSourceStub as unknown as typeof EventSource;

    await importFetcher();

    expect(constructedUrls).toHaveLength(1);
    expect(constructedUrls[0]).toContain("/admin/api/dev-reload");
  });

  it("does not open the stream outside a development build", async () => {
    process.env.NODE_ENV = "production";
    const eventSource = vi.fn();
    globalThis.EventSource = eventSource as unknown as typeof EventSource;

    await importFetcher();

    expect(eventSource).not.toHaveBeenCalled();
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
    // tsup's own "development" fallback for that case.
    expect(configSource).toMatch(
      /"process\.env\.NODE_ENV"\s*:\s*JSON\.stringify\(\s*process\.env\.NODE_ENV\s*\?\?\s*"production"/
    );
  });
});
