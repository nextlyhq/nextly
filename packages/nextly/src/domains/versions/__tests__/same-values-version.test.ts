import { describe, expect, it } from "vitest";

import { NEXTLY_ERROR_STATUS } from "../../../errors";
import { NextlyError } from "../../../errors/nextly-error";
import {
  sameValuesVersionRequirement,
  versionRequiredFor,
} from "../stale-version";

/** The code a call threw, or what it returned. */
function verdict(call: () => unknown): unknown {
  try {
    return call();
  } catch (error) {
    return NextlyError.is(error) ? error.code : error;
  }
}

const IDS = ["a", "b"];

describe("sameValuesVersionRequirement", () => {
  it("judges each id on its own version when every id names one", () => {
    expect(
      sameValuesVersionRequirement(
        { title: "x" },
        { ids: IDS, revs: { a: "4", b: "7.en:2" } }
      )
    ).toEqual({ kind: "per-document", revs: { a: "4", b: "7.en:2" } });
  });

  it("overwrites every id when the data says to", () => {
    expect(
      sameValuesVersionRequirement(
        { title: "x", _overwrite: true },
        { ids: IDS }
      )
    ).toEqual({ kind: "overwrite" });
    expect(
      sameValuesVersionRequirement(
        { title: "x", _overwrite: true },
        { ids: undefined }
      )
    ).toEqual({ kind: "overwrite" });
  });

  it("says a version is required when neither is given, by ids or by query", () => {
    // Whether that is refused yet is the caller's call; the verdict is the same.
    expect(sameValuesVersionRequirement({ title: "x" }, { ids: IDS })).toEqual({
      kind: "required",
      byIds: true,
    });
    expect(
      sameValuesVersionRequirement(
        { title: "x", _overwrite: false },
        { ids: undefined }
      )
    ).toEqual({ kind: "required", byIds: false });
  });

  it("refuses a version for some ids only as a version required", () => {
    expect(
      verdict(() =>
        sameValuesVersionRequirement({}, { ids: IDS, revs: { a: "4" } })
      )
    ).toBe("VERSION_REQUIRED");
  });

  it("reads only an id's own version, never one a prototype member names", () => {
    expect(
      verdict(() =>
        sameValuesVersionRequirement(
          {},
          { ids: ["a", "toString"], revs: { a: "4" } }
        )
      )
    ).toBe("VERSION_REQUIRED");
  });

  it.each([
    ["a version in the shared data", { _rev: "4" }, { ids: IDS }],
    [
      "an overwrite that is not true or false",
      { _overwrite: "yes" },
      { ids: IDS },
    ],
    ["versions on an update by query", {}, { ids: undefined, revs: {} }],
    ["versions that are a list", {}, { ids: IDS, revs: ["4", "7"] }],
    ["versions that are not text", {}, { ids: IDS, revs: { a: 4, b: 7 } }],
    [
      "a version for an id the update does not name",
      {},
      { ids: IDS, revs: { a: "4", b: "7", c: "1" } },
    ],
    [
      "a version that is not one",
      {},
      { ids: IDS, revs: { a: "4", b: "seven" } },
    ],
    [
      "versions and the overwrite choice together",
      { _overwrite: true },
      { ids: IDS, revs: { a: "4", b: "7" } },
    ],
  ])("refuses %s as a validation error", (_name, data, target) => {
    expect(
      verdict(() =>
        sameValuesVersionRequirement(
          data as Record<string, unknown>,
          target as { ids: readonly string[] | undefined; revs?: unknown }
        )
      )
    ).toBe("VALIDATION_ERROR");
  });
});

describe("versionRequiredFor", () => {
  it("answers 428, naming how to give a version or overwrite, for an update by ids", () => {
    const error = versionRequiredFor("ids");
    expect(error.code).toBe("VERSION_REQUIRED");
    expect(error.statusCode).toBe(NEXTLY_ERROR_STATUS.VERSION_REQUIRED);
    expect(NEXTLY_ERROR_STATUS.VERSION_REQUIRED).toBe(428);
    expect(error.publicMessage).toBe(
      "An update that writes the same values to many documents must set `_overwrite: true`: it can't carry each document's version. Or update each document with its own `_rev`. Or give each document's `_rev` in `revs`."
    );
    expect(error.publicData).toEqual({
      versionKey: "_rev",
      overwriteKey: "_overwrite",
      revsKey: "revs",
    });
  });

  it("names no versions by id for an update by query, which has no ids to key them on", () => {
    const error = versionRequiredFor("query");
    expect(error.publicMessage).toBe(
      "An update that writes the same values to many documents must set `_overwrite: true`: it can't carry each document's version. Or update each document with its own `_rev`."
    );
    expect(error.publicData).toEqual({
      versionKey: "_rev",
      overwriteKey: "_overwrite",
    });
  });
});
