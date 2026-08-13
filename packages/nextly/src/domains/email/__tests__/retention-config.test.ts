/**
 * Resolving a delivery-log retention policy never throws and never deletes more
 * than it was asked to.
 *
 * The asymmetry is the whole subject. A resolver that rejects a bad window by
 * substituting the default is not "safe" — the default is SHORTER, so it would
 * delete rows the configuration asked to retain. Every clamp here is checked for
 * DIRECTION, not merely for having clamped.
 */

import { CALENDAR_COLUMN_MAX_OFFSET_MS } from "../../retention/window";
import { afterEach, describe, expect, it } from "vitest";

import {
  activeEmailRetention,
  resolveEmailRetentionConfig,
  setEmailRetention,
  type ResolvedEmailRetentionConfig,
} from "../retention-config";
import type { EmailConfig } from "../types";

const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

afterEach(() => {
  // Process-global, so a published policy would leak into the next test and
  // into whatever configuration initialises after it.
  setEmailRetention(undefined);
});

describe("resolving the delivery-log retention policy", () => {
  it("fills in defaults when nothing is configured", () => {
    // The instrument control. Every assertion below compares against a resolved
    // value; if resolution returned something empty they would all pass for the
    // wrong reason.
    const policy = resolveEmailRetentionConfig();
    expect(policy.maxAgeMs).toBe(DEFAULT_MAX_AGE_MS);
    expect(policy.intervalMs).toBeGreaterThan(0);
    expect(policy.maxBatchesPerRun).toBeGreaterThan(0);
  });

  it("keeps everything when retention is turned off", () => {
    // `false` is a deliberate operator position, not a missing value, so it
    // must not fall back to a window that deletes.
    expect(resolveEmailRetentionConfig(false).maxAgeMs).toBe(false);
    expect(resolveEmailRetentionConfig({ maxAgeMs: false }).maxAgeMs).toBe(
      false
    );
  });

  it("honours a window longer than the default", () => {
    const twoYears = 730 * 24 * 60 * 60 * 1000;
    expect(resolveEmailRetentionConfig({ maxAgeMs: twoYears }).maxAgeMs).toBe(
      twoYears
    );
  });

  it.each([
    ["unrepresentable", Number.MAX_SAFE_INTEGER],
    ["infinite", Number.POSITIVE_INFINITY],
  ])(
    "degrades an %s window to keeping everything, not to the default",
    (_label, value) => {
      // The direction assertion, and the reason this file exists. Falling back to
      // the default here would silently delete three months of rows for an install
      // that asked to keep them for longer than the Date range allows.
      const policy = resolveEmailRetentionConfig({ maxAgeMs: value });
      expect(policy.maxAgeMs).toBe(false);
      expect(policy.maxAgeMs).not.toBe(DEFAULT_MAX_AGE_MS);
    }
  );

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("falls back to the default for a %s window", (_label, value) => {
    // The opposite direction, and it is safe here: neither says anything
    // coherent about how long to keep rows, and neither asked for MORE
    // retention than the default gives.
    expect(resolveEmailRetentionConfig({ maxAgeMs: value }).maxAgeMs).toBe(
      DEFAULT_MAX_AGE_MS
    );
  });

  it("reads zero as keeping nothing, because this is a delivery ledger", () => {
    // Deliberate, and the opposite of what an audit trail does with the same
    // input. A delivery row exists to make a retry possible and to answer "did
    // this send"; an operator who does not want recipient addresses stored at
    // all is expressing a position, and `false` already means keep forever, so
    // zero has no other coherent reading left to it. The audit trails call the
    // same value malformed, because erasing the record of who did what on a
    // typo is not recoverable — one shared resolver, two stated policies.
    expect(resolveEmailRetentionConfig({ maxAgeMs: 0 }).maxAgeMs).toBe(0);
  });

  it("keeps a window the ledger's column can actually store", () => {
    // The bound belongs to `email_deliveries.created_at`, a MySQL `datetime(3)`
    // reaching back to year 1000 — not to the `Date` range. An earlier copy of
    // this resolver bounded by `8.64e15`, which accepted windows whose cutoff no
    // column can hold: the pass then failed on every run while the setting read
    // as accepted.
    const past = CALENDAR_COLUMN_MAX_OFFSET_MS + 1;
    expect(resolveEmailRetentionConfig({ maxAgeMs: past }).maxAgeMs).toBe(
      false
    );
    expect(
      resolveEmailRetentionConfig({ maxAgeMs: CALENDAR_COLUMN_MAX_OFFSET_MS })
        .maxAgeMs
    ).toBe(CALENDAR_COLUMN_MAX_OFFSET_MS);
  });

  it("keeps the interval inside the range the gate can compare", () => {
    // The gate subtracts the interval from now; a value outside the Date range
    // makes "is a pass due?" unanswerable and no pass ever runs again.
    const defaults = resolveEmailRetentionConfig();
    for (const bad of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(resolveEmailRetentionConfig({ intervalMs: bad }).intervalMs).toBe(
        defaults.intervalMs
      );
    }
  });

  it("keeps the batch cap a whole number of batches", () => {
    const defaults = resolveEmailRetentionConfig();
    expect(
      resolveEmailRetentionConfig({ maxBatchesPerRun: 4.7 }).maxBatchesPerRun
    ).toBe(4);
    // Rounding to zero would mean a pass that runs and prunes nothing, which is
    // indistinguishable from a pass with nothing to prune.
    expect(
      resolveEmailRetentionConfig({ maxBatchesPerRun: 0.4 }).maxBatchesPerRun
    ).toBe(defaults.maxBatchesPerRun);
  });
});

describe("the reloaded policy", () => {
  const reloaded: ResolvedEmailRetentionConfig = {
    maxAgeMs: false,
    intervalMs: 1000,
    maxBatchesPerRun: 1,
  };

  it("prefers a published policy over the one a runner was built with", () => {
    const built = resolveEmailRetentionConfig();
    // Without this, a runner built at boot keeps pruning on the previous window
    // until restart — including a change to `false`, where it goes on deleting
    // exactly the rows the operator has just asked to keep.
    expect(activeEmailRetention(built)).toBe(built);
    setEmailRetention(reloaded);
    expect(activeEmailRetention(built)).toBe(reloaded);
  });

  it("restores the built-in policy when the published one is cleared", () => {
    const built = resolveEmailRetentionConfig();
    setEmailRetention(reloaded);
    setEmailRetention(undefined);
    expect(activeEmailRetention(built)).toBe(built);
  });
});

/**
 * Compile-time coverage for the public shape.
 *
 * An install that manages its providers in the admin UI has no code-first
 * provider and no default `from` — those live on the stored provider row. It
 * must still be able to bound or disable its delivery log. While `EmailConfig`
 * required `providerConfig` and `from`, the only way to write this was to
 * invent a provider the install never used, so the honest configuration did not
 * typecheck. `check-types` is what enforces this; the runtime assertion below
 * just keeps the value referenced.
 */
describe("configuring retention without a code-first provider", () => {
  it("is a valid email block on its own", () => {
    const retentionOnly: EmailConfig = { retention: { maxAgeMs: 1000 } };
    expect(retentionOnly.providerConfig).toBeUndefined();

    const disabled: EmailConfig = { retention: false };
    expect(disabled.retention).toBe(false);

    // And a code-first provider still carries its address, because those two
    // are required together rather than each being optional.
    const codeFirst: EmailConfig = {
      providerConfig: { provider: "resend", apiKey: "k" },
      from: "Nextly <no-reply@example.com>",
    };
    expect(codeFirst.from).toContain("@");
  });
});
