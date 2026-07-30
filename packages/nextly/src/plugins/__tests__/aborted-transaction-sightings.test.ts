/**
 * Detection has to be structural, because the message is not stable.
 *
 * PostgreSQL translates its human-readable error text according to the server's `lc_messages`, so
 * an English substring match fails to fire on a localized server. That failure is silent and it
 * fails open: nothing is recorded, the shared assertion sees an empty buffer, and the suite
 * reports green over a transaction that discarded its writes. SQLSTATE `25P02` is fixed by the
 * wire protocol and carries the same meaning on every server.
 *
 * No database needed — these are the shapes the adapter and the driver actually produce, asserted
 * directly.
 */
import { describe, expect, it } from "vitest";

import {
  PG_ABORTED_TRANSACTION_SQLSTATE,
  describeAbortedTransactions,
  isAbortedTransactionError,
  recordAbortedTransaction,
  takeAbortedTransactionSightings,
} from "../aborted-transaction-sightings";

/** The `DatabaseError` shape `createDatabaseError` produces, minus the fields not read here. */
function classified(fields: {
  message: string;
  code?: string;
  cause?: unknown;
}): Error & { code?: string } {
  const error = new Error(fields.message) as Error & {
    code?: string;
    cause?: unknown;
  };
  if (fields.code !== undefined) error.code = fields.code;
  if (fields.cause !== undefined) error.cause = fields.cause;
  return error;
}

describe("isAbortedTransactionError", () => {
  it("matches on SQLSTATE when the message is not English", () => {
    // A German `lc_messages` server reporting 25P02. The English matcher cannot see this, which
    // is the whole reason the code is consulted first.
    const error = classified({
      message:
        "FEHLER: aktuelle Transaktion wurde abgebrochen, Befehle werden bis zum Ende des Transaktionsblocks ignoriert",
      code: PG_ABORTED_TRANSACTION_SQLSTATE,
    });

    expect(isAbortedTransactionError(error)).toBe(true);
  });

  it("matches on the message when the code was stripped on the way up", () => {
    const error = classified({
      message:
        "current transaction is aborted, commands ignored until end of transaction block",
    });

    expect(isAbortedTransactionError(error)).toBe(true);
  });

  it("finds the code on the cause when the wrapper does not carry it", () => {
    // What the adapter produces: its own classified error wrapping the driver's, where only the
    // inner one carries the SQLSTATE.
    const error = classified({
      message: "Query failed",
      cause: classified({
        message: "aktuelle Transaktion wurde abgebrochen",
        code: PG_ABORTED_TRANSACTION_SQLSTATE,
      }),
    });

    expect(isAbortedTransactionError(error)).toBe(true);
  });

  it("matches a bare string carrying the driver text", () => {
    expect(
      isAbortedTransactionError(
        "current transaction is aborted, commands ignored"
      )
    ).toBe(true);
  });

  it("ignores unrelated database errors", () => {
    const unique = classified({
      message:
        'duplicate key value violates unique constraint "posts_slug_key"',
      code: "23505",
    });

    expect(isAbortedTransactionError(unique)).toBe(false);
    expect(isAbortedTransactionError(new Error("connection terminated"))).toBe(
      false
    );
    expect(isAbortedTransactionError(undefined)).toBe(false);
    expect(isAbortedTransactionError(null)).toBe(false);
    expect(isAbortedTransactionError({})).toBe(false);
  });

  it("terminates on a self-referencing cause chain", () => {
    // A wrapper that points at itself would spin a naive walk forever, taking the suite with it.
    const looping = classified({ message: "wrapped" });
    (looping as { cause?: unknown }).cause = looping;

    expect(isAbortedTransactionError(looping)).toBe(false);
  });
});

describe("the sightings buffer", () => {
  it("hands back what was recorded and clears itself", () => {
    // Held on globalThis so the source module and the copy bundled into `dist/testing.mjs` share
    // one array; a per-module array would let a recorded abort go unseen by the assertion.
    recordAbortedTransaction("first");
    recordAbortedTransaction("second");

    expect(takeAbortedTransactionSightings()).toEqual(["first", "second"]);
    // Cleared on read, so one test's failure is never re-reported against the next.
    expect(takeAbortedTransactionSightings()).toEqual([]);
  });
});

describe("describeAbortedTransactions", () => {
  it("returns null when nothing was recorded", () => {
    // Returning rather than throwing is what lets the same message serve this package's vitest
    // setup and a plugin author's runner, without shipping a dependency on either.
    expect(describeAbortedTransactions()).toBeNull();
  });

  it("names every sighting and says the message is not the defect", () => {
    recordAbortedTransaction("current transaction is aborted (one)");
    recordAbortedTransaction("current transaction is aborted (two)");

    const described = describeAbortedTransactions();

    expect(described).toContain("Seen 2 time(s)");
    expect(described).toContain("(one)");
    expect(described).toContain("(two)");
    // The point of the message: whoever reads it must go looking for the swallowed error.
    expect(described).toContain("swallowed");
  });

  it("consumes the buffer so the next test starts clean", () => {
    recordAbortedTransaction("current transaction is aborted");

    expect(describeAbortedTransactions()).not.toBeNull();
    expect(describeAbortedTransactions()).toBeNull();
  });
});
