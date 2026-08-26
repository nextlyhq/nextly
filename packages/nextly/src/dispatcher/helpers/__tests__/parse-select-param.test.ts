/**
 * What the REST layer does with a `select` it cannot read.
 *
 * The parser had no tests anywhere in the repository, and the behaviour they
 * would have pinned was the defect: every unreadable spelling returned
 * `undefined`, which is also what "no projection was asked for" returns, so the
 * read proceeded unprojected and answered with every field of every row.
 *
 * @module dispatcher/helpers/__tests__/parse-select-param
 */
import { describe, expect, it } from "vitest";

import { encodeSelectParam } from "../../../query/select-param";
import { parseSelectParam } from "../validation";

describe("parseSelectParam - a select the layer can honour", () => {
  it("returns the field map for the encoder's own output", () => {
    // The round trip is the contract: whatever the shared encoder writes, this
    // reads. Before it existed, callers wrote the format from memory.
    expect(parseSelectParam(encodeSelectParam(["id", "title"]))).toEqual({
      id: true,
      title: true,
    });
  });

  it("returns nothing when no projection was asked for", () => {
    // The one case that legitimately reads as "send every field".
    expect(parseSelectParam(undefined)).toBeUndefined();
    expect(parseSelectParam("")).toBeUndefined();
  });
});

describe("parseSelectParam - a select the layer cannot honour", () => {
  const refused = (raw: string): unknown => {
    try {
      parseSelectParam(raw);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it("refuses a comma list instead of answering with every field", () => {
    // The spelling the form builder shipped. It was accepted and discarded, so
    // the response looked correct and carried the whole document.
    expect(refused("id,title")).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a bare field name", () => {
    expect(refused("title")).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses an array", () => {
    expect(refused('["title"]')).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a projection that would select nothing", () => {
    // `{"title":false}` counted as a selection and then selected no field, and
    // a projection selecting nothing is answered with the whole document — the
    // opposite of what its author asked for.
    expect(refused('{"title":false}')).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(refused("{}")).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("says what the format is, in the message the caller receives", () => {
    // The reason a caller could not find anywhere else: the format was never
    // documented and had no encoder to read.
    const error = refused("id,title") as { publicMessage?: string };
    expect(error.publicMessage).toContain('{"title":true}');
  });
});
