/**
 * A receipt runs only for the write a caller pinned it for.
 *
 * Every content write path calls `recordWriteReceipt` in its transaction, so
 * the property that matters most is the ordinary case: with no receipt
 * pinned, the call does nothing at all and touches nothing through the
 * transaction it is handed.
 *
 * @module shared/lib/__tests__/write-receipt.test
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import {
  recordWriteReceipt,
  runWithWriteReceipt,
  type WriteReceiptTarget,
} from "../write-receipt";

/** A transaction that fails the test on any use at all. */
function untouchableTx(): TransactionContext {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`the transaction was used: ${String(property)}`);
      },
    }
  ) as TransactionContext;
}

const post: WriteReceiptTarget = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
};

describe("recordWriteReceipt", () => {
  it("records nothing and touches nothing on an ordinary write", async () => {
    await expect(
      recordWriteReceipt(untouchableTx(), post, { status: "published" })
    ).resolves.toBeUndefined();
  });

  it("leaves a receipt alone for a write to another document", async () => {
    const record = vi.fn(async () => {});
    await runWithWriteReceipt({ target: post, record }, async () => {
      await recordWriteReceipt(
        untouchableTx(),
        { ...post, entryId: "e2" },
        { status: "published" }
      );
      await recordWriteReceipt(
        untouchableTx(),
        { ...post, scopeSlug: "pages" },
        { status: "published" }
      );
      await recordWriteReceipt(
        untouchableTx(),
        { scopeKind: "single", scopeSlug: "posts", entryId: "e1" },
        { status: "published" }
      );
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("runs the receipt for the document it was pinned for, with what was stored", async () => {
    // The control: the cases above are only evidence while this one runs.
    const calls: [TransactionContext, unknown][] = [];
    const record = async (tx: TransactionContext, written: unknown) => {
      calls.push([tx, written]);
    };
    const tx = untouchableTx();
    await runWithWriteReceipt({ target: post, record }, () =>
      recordWriteReceipt(tx, post, { status: "draft" })
    );
    // Compared by identity: the guard transaction refuses being inspected.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0] === tx).toBe(true);
    expect(calls[0]?.[1]).toEqual({ status: "draft" });
  });

  it("matches a Single on its slug, whatever its row id", async () => {
    const record = vi.fn(async () => {});
    await runWithWriteReceipt(
      {
        target: { scopeKind: "single", scopeSlug: "banner", entryId: "old" },
        record,
      },
      () =>
        recordWriteReceipt(
          untouchableTx(),
          { scopeKind: "single", scopeSlug: "banner", entryId: "new" },
          { status: "published" }
        )
    );
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("does not outlive the write it was pinned for", async () => {
    const record = vi.fn(async () => {});
    await runWithWriteReceipt({ target: post, record }, async () => {});
    await recordWriteReceipt(untouchableTx(), post, { status: "published" });
    expect(record).not.toHaveBeenCalled();
  });
});
