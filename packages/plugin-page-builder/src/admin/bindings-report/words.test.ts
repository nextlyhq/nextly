/**
 * The one wording the "Bindings to fix" page, card and editor notice share:
 * the first problem that explains the others, and what a visitor sees.
 */
import { describe, expect, it } from "vitest";

import type { BindingsToFixRow } from "../../bindings-report/contract";

import { boundTo, visitorsSee, whatChanged, whereBound } from "./words";

const row = (over: Partial<BindingsToFixRow>): BindingsToFixRow => ({
  nodeId: "n1",
  blockType: "core/heading",
  prop: "text",
  binding: { source: "entry", path: "headline" },
  codes: [],
  shows: { kind: "own", value: "Welcome" },
  blockLabel: "Heading",
  propLabel: "Text",
  ...over,
});

describe("whatChanged", () => {
  it("names a removed prop before anything judged on it", () => {
    // A removed prop also leaves its fallback invalid; the removal explains both.
    const r = row({
      codes: ["binding-fallback-invalid", "binding-prop-missing"],
    });
    expect(whatChanged(r, "Posts")).toBe(
      "The Heading block has no “Text” any more"
    );
  });

  it("names a metadata prop by the page, not a block", () => {
    const r = row({
      blockLabel: "",
      propLabel: "Title",
      codes: ["binding-prop-missing"],
    });
    expect(whatChanged(r, "Posts")).toBe("This page has no “Title” any more");
  });

  it("names the source a missing field was read from", () => {
    expect(
      whatChanged(row({ codes: ["binding-field-missing"] }), "Posts")
    ).toBe("Posts has no field “headline”");
    const single = row({
      codes: ["binding-field-missing"],
      binding: { source: "single", sourceKey: "footer", path: "links.label" },
    });
    expect(whatChanged(single, "Posts")).toBe(
      "The “footer” Single has no field “label”"
    );
  });

  it("says what a misfit field is now, when the schema says", () => {
    const known = row({
      codes: ["binding-type-misfit"],
      reaches: { name: "headline", type: "number" },
    });
    expect(whatChanged(known, "Posts")).toBe(
      "“headline” is now a number; Text can’t show it"
    );
    const unknown = row({ codes: ["binding-type-misfit"] });
    expect(whatChanged(unknown, "Posts")).toBe(
      "“headline” no longer fits Text"
    );
  });

  it("names a path, a format and a fallback problem", () => {
    expect(
      whatChanged(row({ codes: ["binding-path-too-deep"] }), "Posts")
    ).toBe("The path “headline” can’t be followed any more");
    expect(
      whatChanged(row({ codes: ["binding-format-misfit"] }), "Posts")
    ).toBe("Its format no longer fits “headline”");
    expect(
      whatChanged(row({ codes: ["binding-fallback-invalid"] }), "Posts")
    ).toBe("Its fallback isn’t a valid Text any more");
  });
});

describe("visitorsSee", () => {
  it("quotes the fallback, shortening a long one", () => {
    expect(
      visitorsSee(row({ shows: { kind: "fallback", value: "Hello" } }))
    ).toBe("“Hello”");
    const long = "x".repeat(50);
    expect(visitorsSee(row({ shows: { kind: "fallback", value: long } }))).toBe(
      `“${"x".repeat(39)}…”`
    );
    expect(visitorsSee(row({ shows: { kind: "fallback", value: "" } }))).toBe(
      "its fallback"
    );
  });

  it("names the block's own value, and nothing for a removed prop", () => {
    expect(visitorsSee(row({}))).toBe("the block’s own text, “Welcome”");
    expect(visitorsSee(row({ shows: { kind: "own", value: null } }))).toBe(
      "the block’s own text"
    );
    expect(visitorsSee(row({ shows: { kind: "nothing" } }))).toBe(
      "nothing: the binding fills no prop"
    );
  });
});

describe("whereBound and boundTo", () => {
  it("place the binding and spell what it reads", () => {
    expect(whereBound(row({}))).toBe("Heading · Text");
    expect(whereBound(row({ blockLabel: "", propLabel: "Title" }))).toBe(
      "Page metadata · Title"
    );
    expect(
      boundTo(
        row({ binding: { source: "entry", path: "author.name" } }),
        "Posts"
      )
    ).toBe("Posts › author › name");
    expect(
      boundTo(row({ binding: { source: "site", path: "name" } }), "Posts")
    ).toBe("Site › name");
  });
});
