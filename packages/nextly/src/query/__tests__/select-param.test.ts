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

  it("refuses a comma list rather than ignoring it", () => {
    // What the form builder shipped. It was accepted and discarded, so the
    // response looked correct and carried every field of every row.
    expect(readSelectParam("id,title,slug").kind).toBe("unreadable");
  });

  it("refuses a bare field name", () => {
    expect(readSelectParam("title").kind).toBe("unreadable");
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

  it("keeps the fields a caller did ask for alongside ones it did not", () => {
    // A mixed map is readable: the `true` entries are a real request, and the
    // `false` entries never did anything.
    expect(readSelectParam('{"title":true,"body":false}')).toEqual({
      kind: "fields",
      fields: { title: true },
    });
  });

  it("says why, in words a caller can act on", () => {
    const answer = readSelectParam("id,title");
    expect(answer.kind).toBe("unreadable");
    if (answer.kind === "unreadable") {
      expect(answer.reason).toContain('{"title":true}');
    }
  });
});
