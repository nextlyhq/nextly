import { describe, expect, it } from "vitest";

import { encodeSelectParam, readSelectParam } from "../select-param";

describe("encodeSelectParam / readSelectParam round trip", () => {
  it("reads back exactly the fields that were written", () => {
    const written = encodeSelectParam(["id", "title", "slug"]);
    expect(readSelectParam(written)).toEqual({
      kind: "fields",
      fields: { id: true, title: true, slug: true },
    });
  });

  it("writes a value a caller can put in a URL", () => {
    const url = new URL("https://example.test/e");
    url.searchParams.set("select", encodeSelectParam(["id", "title"]));
    expect(
      readSelectParam(new URL(url.href).searchParams.get("select") ?? undefined)
    ).toEqual({ kind: "fields", fields: { id: true, title: true } });
  });

  it("writes nothing for an empty selection", () => {
    // Rather than `{}`, which reads as a projection that selects nothing and
    // is answered with every field — the opposite of what it appears to say.
    expect(encodeSelectParam([])).toBe("");
  });
});

describe("readSelectParam - what a caller is actually asking", () => {
  it("treats an absent parameter as asking for everything", () => {
    expect(readSelectParam(undefined)).toEqual({ kind: "all" });
    expect(readSelectParam("")).toEqual({ kind: "all" });
    expect(readSelectParam("   ")).toEqual({ kind: "all" });
  });

  it("reads the comma-separated form the REST reference documents", () => {
    // `?select=id,title,publishedAt` is the ONLY form the documentation shows,
    // and it never worked: the reader took JSON objects alone, so a caller
    // following the docs had their projection discarded and was answered with
    // every field. That is why the one caller that followed them shipped a
    // select that selected nothing.
    expect(readSelectParam("id,title,slug")).toEqual({
      kind: "fields",
      fields: { id: true, title: true, slug: true },
    });
  });

  it("reads a single field name", () => {
    expect(readSelectParam("title")).toEqual({
      kind: "fields",
      fields: { title: true },
    });
  });

  it("tolerates spacing around the commas", () => {
    expect(readSelectParam("id, title")).toEqual({
      kind: "fields",
      fields: { id: true, title: true },
    });
  });

  it("refuses a comma list with an empty segment", () => {
    expect(readSelectParam("id,,title").kind).toBe("unreadable");
  });

  it("refuses debris that is neither spelling", () => {
    // Truncated JSON does not parse, so it reaches the comma reader — where,
    // without a guard, `{not json` would be accepted as the name of a field.
    expect(readSelectParam("{not json").kind).toBe("unreadable");
    expect(readSelectParam('{"title":').kind).toBe("unreadable");
  });

  it("refuses an array", () => {
    expect(readSelectParam('["title"]').kind).toBe("unreadable");
  });

  it("refuses a projection that names no fields", () => {
    // `{}` and `{"title":false}` both selected nothing, and a projection that
    // selects nothing is answered with the whole document.
    expect(readSelectParam("{}").kind).toBe("unreadable");
    expect(readSelectParam('{"title":false}').kind).toBe("unreadable");
  });

  it("refuses values that are not booleans", () => {
    expect(readSelectParam('{"title":"yes"}').kind).toBe("unreadable");
    expect(readSelectParam('{"title":1}').kind).toBe("unreadable");
  });

  it("refuses a map whose bad entry sits beside a good one", () => {
    // The separating case. Skipping what it cannot read would accept this as a
    // projection over `title` alone — answering a different question than the
    // caller asked, quietly, which is the defect this module removes rather
    // than relocates. A map with NO valid sibling is refused by a weaker rule
    // and cannot tell the two implementations apart.
    expect(readSelectParam('{"title":true,"body":"yes"}').kind).toBe(
      "unreadable"
    );
  });

  it("keeps the fields a caller did ask for alongside ones it did not", () => {
    // The control for the case above: `false` IS a boolean, so a map mixing
    // wanted and unwanted fields is a readable request, not a malformed one.
    expect(readSelectParam('{"title":true,"body":false}')).toEqual({
      kind: "fields",
      fields: { title: true },
    });
  });

  it("says both accepted spellings when it refuses one", () => {
    const answer = readSelectParam('["title"]');
    expect(answer.kind).toBe("unreadable");
    if (answer.kind === "unreadable") {
      expect(answer.reason).toContain("id,title");
      expect(answer.reason).toContain('{"title":true}');
    }
  });
});
