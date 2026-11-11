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

import { clearStart, publishStart } from "../../../init/start-in-flight";
import type { Nextly } from "../../../init/nextly-instance";
import IncrementalHandler from "../incremental-cache-handler";
import type { TagExpiryLedger } from "../tag-expiry-ledger";
import { expireTags, publishTagExpiryLedger } from "../tag-expiry-view";

const BUILT_AT = Date.UTC(2026, 10, 11, 9, 0, 0);
const PAGE = { kind: "APP_PAGE", html: "<p>admin</p>", headers: {} };
const SITE_STYLE = "nextly:single:site-style";

/** A ledger answering that each of `expired`'s tags expired when it says. */
function ledgerSaying(expired: Record<string, number> = {}): TagExpiryLedger {
  return {
    record: async () => false,
    expiriesOf: async () => ({
      now: Date.now(),
      expired: new Map(Object.entries(expired)),
    }),
    prune: async () => 0,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BUILT_AT + 60_000);
  delete (globalThis as { __nextly_cache_entries?: unknown })
    .__nextly_cache_entries;
  delete (globalThis as { __nextly_tag_expiry_view?: unknown })
    .__nextly_tag_expiry_view;
  built.read.mockReset();
  clearStart();
  // A process whose start has connected: what expired can be asked.
  publishTagExpiryLedger(ledgerSaying());
});

afterEach(() => {
  clearStart();
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

describe("a miss while the start has not yet connected", () => {
  beforeEach(() => {
    publishTagExpiryLedger(null);
    built.read.mockResolvedValue({ lastModified: BUILT_AT, value: PAGE });
  });

  /** A start in flight, which publishes `ledger` when `connect()` is called. */
  function startConnecting(ledger: TagExpiryLedger): () => void {
    publishStart(new Promise<Nextly>(() => {}));
    return () => publishTagExpiryLedger(ledger);
  }

  it("waits until what expired can be asked, and refuses a page changed since the build", async () => {
    const connect = startConnecting(
      ledgerSaying({ [SITE_STYLE]: BUILT_AT + 30_000 })
    );
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });

    let answered = false;
    const pending = handler
      .get("/admin", { kind: "APP_PAGE", tags: [SITE_STYLE] })
      .finally(() => {
        answered = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toBe(false);

    connect();
    expect(await pending).toBeNull();
  });

  it("serves the build's page once the ledger says nothing changed", async () => {
    const connect = startConnecting(ledgerSaying());
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });

    const pending = handler.get("/admin", {
      kind: "APP_PAGE",
      tags: [SITE_STYLE],
    });
    connect();

    expect((await pending)?.value).toEqual(PAGE);
  });

  it("serves at once a page that carries only its path tags", async () => {
    // The page's own path tags, as the build writes them beside it: no
    // database read is tagged, so nothing another process recorded about
    // content can have changed it.
    const shell = {
      ...PAGE,
      headers: {
        "x-next-cache-tags": "_N_T_/layout,_N_T_/admin/layout,_N_T_/admin",
      },
    };
    built.read.mockResolvedValue({ lastModified: BUILT_AT, value: shell });
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });

    const answer = await handler.get("/admin", {
      kind: "APP_PAGE",
      softTags: ["_N_T_/layout", "_N_T_/admin/layout", "_N_T_/admin"],
    });

    expect(answer?.value).toEqual(shell);
  });

  it("waits for a page whose build copy names a content tag", async () => {
    built.read.mockResolvedValue({
      lastModified: BUILT_AT,
      value: {
        ...PAGE,
        headers: { "x-next-cache-tags": `_N_T_/admin,${SITE_STYLE}` },
      },
    });
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });

    expect(await handler.get("/admin", { kind: "APP_PAGE" })).toBeNull();
  });

  it("is a miss when no start is under way to connect", async () => {
    const handler = new IncrementalHandler({ fs, serverDistDir: "/app/.next" });

    expect(
      await handler.get("/admin", { kind: "APP_PAGE", tags: [SITE_STYLE] })
    ).toBeNull();
  });
});
