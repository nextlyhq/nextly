/**
 * What an overwrite's history event keeps, from the rows as they stood
 * before its write: no version, the current one, or one out of date, and
 * then who made the latest change it replaced.
 */
import { describe, expect, it } from "vitest";

import { overwriteRecordOf } from "../overwrite-record";
import type { DecodedVersion, PartState } from "../stale-version";

const part = (
  name: string,
  counter: number,
  changer: Partial<PartState["changer"]> = {},
  at = 0
): PartState => ({
  part: name,
  counter,
  changer: { kind: null, id: null, principalKind: null, ...changer },
  at: new Date(at),
});

const overwrite = (given?: DecodedVersion) =>
  ({ kind: "overwrite", ...(given ? { given } : {}) }) as const;

const BEN = { kind: "person", id: "u-ben" };
const CLEO = { kind: "person", id: "u-cleo" };

describe("what an overwrite replaced", () => {
  it("names no one when no version was given", () => {
    expect(
      overwriteRecordOf(overwrite(), { main: part("main", 4, BEN) })
    ).toEqual({ given: "none", replaced: null });
  });

  it("names no one when the version given was current", () => {
    expect(
      overwriteRecordOf(overwrite({ main: 4, languages: { es: 2 } }), {
        main: part("main", 4, BEN),
        language: part("es", 2, CLEO),
      })
    ).toEqual({ given: "current", replaced: null });
  });

  it("names who moved the main row since the version given", () => {
    expect(
      overwriteRecordOf(overwrite({ main: 3, languages: {} }), {
        main: part("main", 4, BEN),
      })
    ).toEqual({
      given: "stale",
      replaced: { kind: "person", id: "u-ben", principalKind: null },
    });
  });

  it("names who moved the save's language when only that moved", () => {
    expect(
      overwriteRecordOf(overwrite({ main: 4, languages: { es: 1 } }), {
        main: part("main", 4, BEN, 2_000),
        language: part("es", 2, CLEO, 1_000),
      })
    ).toMatchObject({ given: "stale", replaced: { id: "u-cleo" } });
  });

  it("names the later of the two when both moved", () => {
    expect(
      overwriteRecordOf(overwrite({ main: 3, languages: { es: 1 } }), {
        main: part("main", 4, BEN, 1_000),
        language: part("es", 2, CLEO, 2_000),
      })
    ).toMatchObject({ replaced: { id: "u-cleo" } });
  });

  it("is out of date naming no one when the row records no maker", () => {
    expect(
      overwriteRecordOf(overwrite({ main: 3, languages: {} }), {
        main: part("main", 4),
      })
    ).toEqual({ given: "stale", replaced: null });
  });

  it("counts a language with no row as 0", () => {
    // Read when there was no Spanish yet, and someone has written it since.
    expect(
      overwriteRecordOf(overwrite({ main: 4, languages: { es: 0 } }), {
        main: part("main", 4),
        language: part("es", 1, CLEO),
      })
    ).toMatchObject({ given: "stale", replaced: { id: "u-cleo" } });
  });
});
