/**
 * nextly's incremental cache handler answers a miss from what `next build`
 * wrote to disk, so a new server process serves the prerendered pages instead
 * of rendering each again on its first request.
 *
 * The build's reader is stood in for in the handler's cases, since what is
 * under test there is what the handler does with its answer: keep it, and
 * judge it from when the build wrote it. `build-output-reader.test.ts` loads
 * Next.js's own reader.
 */
import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const built = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock("../build-output", async importOriginal => ({
  ...(await importOriginal<typeof import("../build-output")>()),
  buildOutputReader: () => built.read,
}));

import IncrementalHandler from "../incremental-cache-handler";
import { expireTags } from "../tag-expiry-view";

const BUILT_AT = Date.UTC(2026, 10, 11, 9, 0, 0);
const PAGE = { kind: "APP_PAGE", html: "<p>admin</p>", headers: {} };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BUILT_AT + 60_000);
  delete (globalThis as { __nextly_cache_entries?: unknown })
    .__nextly_cache_entries;
  delete (globalThis as { __nextly_tag_expiry_view?: unknown })
    .__nextly_tag_expiry_view;
  built.read.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a miss in a new process", () => {
  it("is answered from the build's files, and kept", async () => {
    built.read.mockResolvedValue({ lastModified: BUILT_AT, value: PAGE });
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });

    const first = await handler.get("/admin", { kind: "APP_PAGE" });
    const second = await handler.get("/admin", { kind: "APP_PAGE" });

    expect(first?.value).toEqual(PAGE);
    expect(first?.lastModified).toBe(BUILT_AT);
    expect(second?.value).toEqual(PAGE);
    // Read from disk once; the second answer is the kept entry.
    expect(built.read).toHaveBeenCalledTimes(1);
  });

  it("never replaces a page stored while the build's copy was being read", async () => {
    let finishRead: (entry: unknown) => void = () => {};
    built.read.mockReturnValue(
      new Promise(resolve => {
        finishRead = resolve;
      })
    );
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });
    const fresh = { ...PAGE, html: "<p>admin, regenerated</p>" };

    // One request waits on the disk while another stores a fresher render.
    const pending = handler.get("/admin", { kind: "APP_PAGE" });
    await handler.set("/admin", fresh, {});
    finishRead({ lastModified: BUILT_AT, value: PAGE });

    expect((await pending)?.value).toEqual(fresh);
    expect((await handler.get("/admin", { kind: "APP_PAGE" }))?.value).toEqual(
      fresh
    );
  });

  it("is a miss still when the build wrote nothing for the key", async () => {
    built.read.mockResolvedValue(null);
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });

    expect(await handler.get("/nowhere", { kind: "APP_PAGE" })).toBeNull();
  });

  it("is expired by a write made since the build", async () => {
    built.read.mockResolvedValue({ lastModified: BUILT_AT, value: PAGE });
    await expireTags(["nextly:single:site-style"]);
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });

    const answer = await handler.get("/admin", {
      kind: "APP_PAGE",
      tags: ["nextly:single:site-style"],
    });

    expect(answer).toBeNull();
  });
});
