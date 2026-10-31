/**
 * The tag expiry ledger connected at registration: the expiry hand-off records
 * into it and expires in this process at once; a ledger that refuses, or whose
 * table a pending migration has not made yet, leaves the tags with this
 * process's next flush and is warned about once; withdrawing it restores the
 * in-process hand-off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import {
  expiryHandoff,
  isPendingExpiryHandoff,
  takePendingExpiries,
} from "../../../revalidation/expiry-handoff";
import useCacheHandler from "../use-cache-handler";
import IncrementalHandler from "../incremental-cache-handler";
import {
  installTagExpiryLedger,
  LedgerExpiryHandoff,
  withdrawTagExpiryLedger,
} from "../ledger-wiring";
import type { TagExpiryLedger } from "../tag-expiry-ledger";
import { publishTagExpiryLedger } from "../tag-expiry-view";

const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);

const warnings: Record<string, unknown>[] = [];

function ledgerThat(record: TagExpiryLedger["record"]): TagExpiryLedger {
  return {
    record: vi.fn(record),
    expiriesOf: async () => ({ expired: new Map() }),
    prune: async () => 0,
  };
}

/** An adapter whose database has not run the migration that adds the table. */
function adapterWithoutTheTable() {
  return {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    tableExists: async () => false,
    getDrizzle: () => {
      throw new Error("a statement reached the missing table");
    },
  } as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  for (const key of [
    "__nextly_tag_expiry_view",
    "__nextly_cache_entries",
    "__nextly_cache_reads",
    "__nextly_expiry_handoff",
    "__nextly_expiry_fallback",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  warnings.length = 0;
  const ignore = () => undefined;
  setNextlyLogger({
    warn: (payload: object) =>
      warnings.push(payload as Record<string, unknown>),
    error: ignore,
    info: ignore,
    debug: ignore,
  });
});
afterEach(() => {
  vi.useRealTimers();
  setNextlyLogger(undefined);
  withdrawTagExpiryLedger();
});

describe("the ledger's expiry hand-off", () => {
  it("records the tags and expires them in this process at once", async () => {
    const ledger = ledgerThat(async () => new Map());
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    await handler.set("k", { kind: "FETCH", data: 1 }, { tags: ["posts"] });
    vi.advanceTimersByTime(1);

    await new LedgerExpiryHandoff().handOff(["posts"], "outside a request");

    expect(ledger.record).toHaveBeenCalledWith(["posts"]);
    expect(await handler.get("k")).toBeNull();
    expect(takePendingExpiries()).toEqual([]);
  });

  it("keeps the tags for the next flush when the ledger refuses, warning once", async () => {
    publishTagExpiryLedger(
      ledgerThat(async () => {
        throw new Error("read-only transaction");
      })
    );
    const handoff = new LedgerExpiryHandoff();

    await handoff.handOff(["posts"], "outside a request");
    await handoff.handOff(["pages"], "outside a request");

    expect(takePendingExpiries().sort()).toEqual(["pages", "posts"]);
    expect(
      warnings.filter(w => w.kind === "cache-tag-ledger-unreachable")
    ).toHaveLength(1);
  });

  it("keeps the tags for the next flush while a pending migration has not made the table, warning once", async () => {
    installTagExpiryLedger(adapterWithoutTheTable());

    await expiryHandoff().handOff(["posts"], "outside a request");
    await expiryHandoff().handOff(["pages"], "outside a request");

    expect(takePendingExpiries().sort()).toEqual(["pages", "posts"]);
    expect(
      warnings.filter(w => w.kind === "cache-tag-ledger-missing")
    ).toHaveLength(1);
  });

  it("keeps the tags for the next flush with no ledger published", async () => {
    publishTagExpiryLedger(null);
    await new LedgerExpiryHandoff().handOff(["posts"], "outside a request");
    expect(takePendingExpiries()).toEqual(["posts"]);
  });
});

describe("the handlers' own expiries", () => {
  it("keep a refused record for the next flush to retry", async () => {
    publishTagExpiryLedger(
      ledgerThat(async () => {
        throw new Error("read-only transaction");
      })
    );
    await new IncrementalHandler().revalidateTag("posts");
    await useCacheHandler.updateTags(["pages"]);
    expect(takePendingExpiries().sort()).toEqual(["pages", "posts"]);
  });

  it("keep nothing while the table is missing, so no request expires them again", async () => {
    installTagExpiryLedger(adapterWithoutTheTable());
    await new IncrementalHandler().revalidateTag("posts");
    await useCacheHandler.updateTags(["pages"]);
    expect(takePendingExpiries()).toEqual([]);
  });
});

describe("installing and withdrawing the ledger", () => {
  it("hands the ledger tags the in-process hand-off took before it was installed", async () => {
    // A write between a release and the next registration.
    await expiryHandoff().handOff(["posts"], "outside a request");
    installTagExpiryLedger(adapterWithoutTheTable());
    // Handed to the ledger's hand-off, which keeps them for the next flush
    // while the table is missing; left in the replaced hand-off, they would be
    // in neither and lost.
    await vi.waitFor(() => expect(takePendingExpiries()).toEqual(["posts"]));
  });

  it("installs the ledger's hand-off, and withdrawing restores the in-process one", () => {
    installTagExpiryLedger(adapterWithoutTheTable());
    expect(expiryHandoff()).toBeInstanceOf(LedgerExpiryHandoff);

    withdrawTagExpiryLedger();
    expect(isPendingExpiryHandoff(expiryHandoff())).toBe(true);
  });
});
