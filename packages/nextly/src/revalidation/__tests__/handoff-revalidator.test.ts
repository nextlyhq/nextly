/**
 * The revalidator a process without Next.js uses (the CLI, a script, a job):
 * a write's tags go to the ledger's hand-off; tags a refused record left
 * behind are retried with the next write's; a ledger that never answers
 * cannot hold a committed write past the hand-off's bound; and with only the
 * in-process hand-off installed, nothing is handed off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../../observability/logger";
import { LedgerExpiryHandoff } from "../../runtime/cache/ledger-wiring";
import { HANDOFF_TIMEOUT_MS } from "../../runtime/cache/next-cache-revalidator";
import type { TagExpiryLedger } from "../../runtime/cache/tag-expiry-ledger";
import { publishTagExpiryLedger } from "../../runtime/cache/tag-expiry-view";
import { setExpiryHandoff, takePendingExpiries } from "../expiry-handoff";
import { HandOffRevalidator } from "../handoff-revalidator";

const write = (...tags: string[]) => [{ tags }];

function ledgerThat(record: TagExpiryLedger["record"]) {
  const ledger = {
    record: vi.fn(record),
    expiriesOf: async () => ({ expired: new Map() }),
    prune: async () => 0,
  };
  publishTagExpiryLedger(ledger);
  return ledger;
}

beforeEach(() => {
  for (const key of [
    "__nextly_tag_expiry_view",
    "__nextly_expiry_handoff",
    "__nextly_expiry_fallback",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  const ignore = () => undefined;
  setNextlyLogger({ warn: ignore, error: ignore, info: ignore, debug: ignore });
});
afterEach(() => {
  vi.useRealTimers();
  setNextlyLogger(undefined);
  setExpiryHandoff(null);
  publishTagExpiryLedger(null);
});

describe("the revalidator outside Next.js", () => {
  it("retries tags a refused record left behind with the next write's", async () => {
    let refusing = true;
    const ledger = ledgerThat(async () => {
      if (refusing) throw new Error("connection reset");
      return true;
    });
    setExpiryHandoff(new LedgerExpiryHandoff());
    const revalidator = new HandOffRevalidator();

    await revalidator.flush(write("posts"));
    refusing = false;
    await revalidator.flush(write("pages"));

    expect(ledger.record).toHaveBeenLastCalledWith(
      expect.arrayContaining(["posts", "pages"])
    );
    expect(takePendingExpiries()).toEqual([]);
  });

  it("returns within the hand-off's bound when the ledger never answers, keeping the tags", async () => {
    vi.useFakeTimers();
    ledgerThat(() => new Promise<boolean>(() => undefined));
    setExpiryHandoff(new LedgerExpiryHandoff());

    const flushing = new HandOffRevalidator().flush(write("posts"));
    await vi.advanceTimersByTimeAsync(HANDOFF_TIMEOUT_MS);

    await expect(flushing).resolves.toBeUndefined();
    expect(takePendingExpiries()).toEqual(["posts"]);
  });

  it("hands nothing off with only the in-process hand-off installed", async () => {
    const ledger = ledgerThat(async () => true);
    setExpiryHandoff(null);
    await new HandOffRevalidator().flush(write("posts"));
    expect(ledger.record).not.toHaveBeenCalled();
    expect(takePendingExpiries()).toEqual([]);
  });
});
