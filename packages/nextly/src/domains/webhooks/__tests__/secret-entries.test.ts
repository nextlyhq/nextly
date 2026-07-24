/**
 * The stored signing-secret entry lifecycle. The crypto is stubbed so these
 * assert the shape and rotation rules (normalize, liveness, ordering) without an
 * encryption key: `secret.ts` owns and separately tests the AES-GCM round trip.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../secret", () => ({
  encryptWebhookSecret: (plaintext: string) => `enc(${plaintext})`,
  webhookSecretPrefix: (secret: string) => secret.slice(0, 8),
}));

import {
  isSecretEntryLive,
  liveSecretEntries,
  newSecretEntry,
  normalizeSecretEntries,
  WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS,
  WEBHOOK_ROTATION_MAX_OVERLAP_SECONDS,
  type StoredSecretEntry,
} from "../secret-entries";

const FALLBACK = { prefix: "whsec_fb", createdAt: "2026-01-01T00:00:00.000Z" };

function entry(over: Partial<StoredSecretEntry> = {}): StoredSecretEntry {
  return {
    ciphertext: "ct",
    prefix: "whsec_ab",
    createdAt: "2026-07-24T00:00:00.000Z",
    expiresAt: null,
    ...over,
  };
}

describe("normalizeSecretEntries", () => {
  it("reads a legacy bare-string entry as a never-expiring primary", () => {
    expect(normalizeSecretEntries(["ct-legacy"], FALLBACK)).toEqual([
      {
        ciphertext: "ct-legacy",
        prefix: FALLBACK.prefix,
        createdAt: FALLBACK.createdAt,
        expiresAt: null,
      },
    ]);
  });

  it("reads the current object form, filling gaps from the fallback", () => {
    const stored = [
      {
        ciphertext: "a",
        prefix: "whsec_aa",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: null,
      },
      { ciphertext: "b" },
    ];
    expect(normalizeSecretEntries(stored, FALLBACK)).toEqual([
      {
        ciphertext: "a",
        prefix: "whsec_aa",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: null,
      },
      {
        ciphertext: "b",
        prefix: FALLBACK.prefix,
        createdAt: FALLBACK.createdAt,
        expiresAt: null,
      },
    ]);
  });

  it("drops malformed entries and non-array cells", () => {
    expect(
      normalizeSecretEntries(["", null, 3, { prefix: "x" }], FALLBACK)
    ).toEqual([]);
    expect(normalizeSecretEntries(null, FALLBACK)).toEqual([]);
    expect(normalizeSecretEntries("nope", FALLBACK)).toEqual([]);
  });
});

describe("isSecretEntryLive", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("treats a null expiry (primary) as always live", () => {
    expect(isSecretEntryLive(entry({ expiresAt: null }), now)).toBe(true);
  });

  it("is live before the expiry and dead after", () => {
    expect(
      isSecretEntryLive(entry({ expiresAt: "2026-07-24T13:00:00.000Z" }), now)
    ).toBe(true);
    expect(
      isSecretEntryLive(entry({ expiresAt: "2026-07-24T11:00:00.000Z" }), now)
    ).toBe(false);
  });

  it("treats a malformed expiry as dead rather than eternal", () => {
    expect(isSecretEntryLive(entry({ expiresAt: "not-a-date" }), now)).toBe(
      false
    );
  });
});

describe("liveSecretEntries", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("drops expired entries and puts the primary first", () => {
    const entries = [
      entry({ ciphertext: "overlap", expiresAt: "2026-07-25T00:00:00.000Z" }),
      entry({ ciphertext: "primary", expiresAt: null }),
      entry({ ciphertext: "dead", expiresAt: "2026-07-01T00:00:00.000Z" }),
    ];
    const live = liveSecretEntries(entries, now);
    expect(live.map(e => e.ciphertext)).toEqual(["primary", "overlap"]);
  });

  it("orders overlapping secrets latest-expiry first", () => {
    const entries = [
      entry({ ciphertext: "soon", expiresAt: "2026-07-24T13:00:00.000Z" }),
      entry({ ciphertext: "later", expiresAt: "2026-07-26T00:00:00.000Z" }),
    ];
    expect(liveSecretEntries(entries, now).map(e => e.ciphertext)).toEqual([
      "later",
      "soon",
    ]);
  });
});

describe("newSecretEntry", () => {
  const now = new Date("2026-07-24T00:00:00.000Z");

  it("builds a never-expiring primary from a plaintext secret", () => {
    expect(newSecretEntry("whsec_abcdefgh", now)).toEqual({
      ciphertext: "enc(whsec_abcdefgh)",
      prefix: "whsec_ab",
      createdAt: "2026-07-24T00:00:00.000Z",
      expiresAt: null,
    });
  });

  it("stamps an overlap expiry when one is passed", () => {
    const expiresAt = "2026-07-26T00:00:00.000Z";
    expect(newSecretEntry("whsec_abcdefgh", now, expiresAt).expiresAt).toBe(
      expiresAt
    );
  });
});

describe("rotation window constants", () => {
  it("defaults to 48 hours and caps at 30 days", () => {
    expect(WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS).toBe(48 * 60 * 60);
    expect(WEBHOOK_ROTATION_MAX_OVERLAP_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});
