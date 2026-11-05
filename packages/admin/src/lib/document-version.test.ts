/**
 * The admin's side of a document's version: reading the version off a read,
 * recognising the refusal of a save made from an older one, and naming who
 * changed it since. The keys themselves are pinned to the server's in
 * `version-keys-parity.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  STALE_VERSION_CODE,
  changerName,
  staleVersionOf,
  versionOf,
} from "./document-version";

describe("versionOf", () => {
  it("reads the version a read put on a document, and nothing else", () => {
    expect(versionOf({ id: "1", _rev: "7.en:2" })).toBe("7.en:2");
    expect(versionOf({ id: "1" })).toBeUndefined();
    expect(versionOf({ id: "1", _rev: 7 })).toBeUndefined();
    expect(versionOf({ id: "1", _rev: "" })).toBeUndefined();
    expect(versionOf(null)).toBeUndefined();
  });
});

/** An error as the admin's fetcher throws one for an API envelope. */
function apiError(
  status: number,
  code: string,
  data?: Record<string, unknown>
): Error {
  return Object.assign(new Error("refused"), { status, code, data });
}

describe("staleVersionOf", () => {
  it("reads the refusal of a save made from an older version", () => {
    expect(
      staleVersionOf(
        apiError(409, "STALE_VERSION", {
          currentVersion: "8",
          changedBy: { kind: "person", name: "Ana Ruiz" },
          changedAt: "2026-11-05T10:42:00.000Z",
          historyVersion: { version: 13, locale: null },
        })
      )
    ).toEqual({
      currentVersion: "8",
      changedBy: { kind: "person", name: "Ana Ruiz" },
      changedAt: "2026-11-05T10:42:00.000Z",
      historyVersion: { version: 13, locale: null },
    });
  });

  it("keeps only the current version when the refusal names nobody", () => {
    expect(
      staleVersionOf(apiError(409, "STALE_VERSION", { currentVersion: "8" }))
    ).toEqual({ currentVersion: "8" });
  });

  it("answers undefined for any other failure, the lock's conflict included", () => {
    expect(staleVersionOf(apiError(409, "CONFLICT", {}))).toBeUndefined();
    expect(
      staleVersionOf(
        apiError(409, "CONFLICT", { reason: "shared-fields-out-of-date" })
      )
    ).toBeUndefined();
    expect(
      staleVersionOf(apiError(400, STALE_VERSION_CODE, { currentVersion: "8" }))
    ).toBeUndefined();
    expect(staleVersionOf(apiError(409, "STALE_VERSION"))).toBeUndefined();
    expect(staleVersionOf(new Error("network"))).toBeUndefined();
  });

  it("drops a malformed part rather than trusting it", () => {
    expect(
      staleVersionOf(
        apiError(409, "STALE_VERSION", {
          currentVersion: "8",
          changedBy: { kind: "person", name: 3 },
          changedAt: "not a time",
          historyVersion: { version: "13" },
        })
      )
    ).toEqual({ currentVersion: "8" });
  });
});

describe("changerName", () => {
  it.each([
    [{ kind: "person", name: "Ana Ruiz" }, "Ana Ruiz"],
    [{ kind: "person", name: null }, "Someone"],
    [{ kind: "apiKey", name: null }, "An API key"],
    [{ kind: "release", name: null }, "A scheduled release"],
    [{ kind: "agent", name: null }, "An agent"],
    [{ kind: "principal", name: null }, "Someone"],
    [{ kind: "system", name: null }, "Nextly"],
    [undefined, "Someone"],
  ] as const)("names %j as %s", (changedBy, expected) => {
    expect(changerName(changedBy)).toBe(expected);
  });
});
