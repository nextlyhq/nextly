/**
 * What the live field-group read pass shares, and what it puts back.
 *
 * `sharedPerTransaction` is how a bulk write's item responses resolve the
 * field groups' schemas and the caller's grants once for the batch rather
 * than once per row. `withFieldGroupEvidence` is how an entity's second read
 * pass is judged against the field groups as stored, rather than as the first
 * field-group pass left them.
 */
import { describe, expect, it, vi } from "vitest";

import type { ReadAccessRedactions } from "../../../shared/lib/field-level-registry";
import {
  sharedPerTransaction,
  withFieldGroupEvidence,
} from "../live-read-access";

describe("sharedPerTransaction", () => {
  it("makes one value per transaction and key, and shares it inside the transaction", () => {
    const tx = {};
    const make = vi.fn(() => ({}));
    const first = sharedPerTransaction(tx, "fieldGroupReadPass:pages", make);
    const again = sharedPerTransaction(tx, "fieldGroupReadPass:pages", make);
    expect(again).toBe(first);
    expect(make).toHaveBeenCalledTimes(1);

    // Another key, and another transaction, each make their own.
    sharedPerTransaction(tx, "fieldGroupReadPass:posts", make);
    sharedPerTransaction({}, "fieldGroupReadPass:pages", make);
    expect(make).toHaveBeenCalledTimes(3);
  });

  it("shares nothing outside a transaction", () => {
    const make = vi.fn(() => ({}));
    expect(sharedPerTransaction(undefined, "grants:u1", make)).not.toBe(
      sharedPerTransaction(undefined, "grants:u1", make)
    );
    expect(make).toHaveBeenCalledTimes(2);
  });
});

describe("withFieldGroupEvidence", () => {
  it("shows the pass what the field-group passes removed, then takes it out again", async () => {
    const instance: Record<string, unknown> = { heading: "h" };
    const row: Record<string, unknown> = { id: "r1", one: instance };
    const redactions: ReadAccessRedactions = new WeakMap();
    redactions.set(instance, { secret: "S" });

    let seen: unknown;
    await withFieldGroupEvidence(row, redactions, async () => {
      seen = (row.one as Record<string, unknown>).secret;
    });

    expect(seen).toBe("S");
    expect(instance).not.toHaveProperty("secret");
    expect(instance.heading).toBe("h");
  });

  it("leaves a value the pass replaced as the pass left it", async () => {
    const instance: Record<string, unknown> = {};
    const redactions: ReadAccessRedactions = new WeakMap();
    redactions.set(instance, { secret: "S" });

    await withFieldGroupEvidence({ one: instance }, redactions, async () => {
      instance.secret = "replaced";
    });

    expect(instance.secret).toBe("replaced");
  });
});
