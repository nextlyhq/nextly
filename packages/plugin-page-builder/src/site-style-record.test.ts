import { describe, expect, it } from "vitest";

import {
  checkStoredBreakpoints,
  checkStoredClasses,
  checkStoredFonts,
  checkStoredTokens,
  readSiteStyleRecord,
} from "./site-style-record";

/** One shape-valid stored token. */
function token(name: string, light: string, dark?: string) {
  return {
    name,
    kind: "color",
    values: { light, ...(dark === undefined ? {} : { dark }) },
  };
}

/** A host no site in these tests allows. */
const TRACKER = "https://tracker.example/p.png";

describe("checkStoredTokens", () => {
  it("reports nothing for an absent section", () => {
    expect(checkStoredTokens(undefined)).toEqual({ issues: [] });
    expect(checkStoredTokens(null)).toEqual({ issues: [] });
  });

  it("refuses a section that is not a token set at all", () => {
    const result = checkStoredTokens([token("color.primary", "#111111")]);
    expect(result.value).toBeUndefined();
    expect(result.issues).toHaveLength(1);
  });

  it("accepts a well-formed set, dark values included", () => {
    const result = checkStoredTokens({
      tokens: [token("color.primary", "#111111", "#eeeeee")],
      darkMode: "media",
    });
    expect(result.issues).toEqual([]);
    expect(result.value?.tokens[0]?.values.dark).toBe("#eeeeee");
    expect(result.value?.darkMode).toBe("media");
  });

  it("reports a shape-broken entry AND excludes it from the narrowed value", () => {
    const result = checkStoredTokens({
      tokens: [token("color.primary", "#111111"), { name: "color.broken" }],
    });
    expect(result.issues).toHaveLength(1);
    expect(result.value?.tokens.map(t => t.name)).toEqual(["color.primary"]);
  });

  it("reports what the engine's emitter refuses: a value that would fetch", () => {
    const result = checkStoredTokens({
      tokens: [token("color.primary", "url(https://evil.example/a.png)")],
    });
    // The message is the engine's own — the emitter is the validator.
    expect(result.issues.join(" ")).toContain("would load a file");
  });

  it("reports a name that cannot become a custom property", () => {
    const result = checkStoredTokens({
      tokens: [token("color}body{", "#111111")],
    });
    expect(result.issues.join(" ")).toContain("is not a token name");
  });
});

describe("checkStoredFonts", () => {
  it("accepts a self-hosted face", () => {
    const result = checkStoredFonts([
      {
        family: "Geist",
        src: [{ url: "/fonts/geist.woff2", format: "woff2" }],
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.value).toHaveLength(1);
  });

  it("carries the engine's refusal of a remote source to the writer", () => {
    const result = checkStoredFonts([
      { family: "Sneaky", src: [{ url: "https://cdn.example/f.woff2" }] },
    ]);
    expect(result.issues.join(" ")).toContain("another server");
  });

  it("refuses an entry that is not a face shape", () => {
    const result = checkStoredFonts([{ family: "NoSrc" }]);
    expect(result.issues).toHaveLength(1);
    expect(result.value).toEqual([]);
  });
});

describe("checkStoredClasses", () => {
  const usable = {
    id: "c1",
    slug: "card",
    orderIndex: 0,
    styles: { base: { base: { color: "#111111" } } },
  };

  it("accepts a usable class", () => {
    const result = checkStoredClasses([usable]);
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual([usable]);
  });

  it("refuses a slug CSS cannot carry, with the engine's own predicate", () => {
    const result = checkStoredClasses([{ ...usable, slug: "Card Title" }]);
    expect(result.issues).toHaveLength(1);
    expect(result.value).toEqual([]);
  });

  it("refuses a repeated slug: two rule sets on one selector", () => {
    const result = checkStoredClasses([
      usable,
      { ...usable, id: "c2", orderIndex: 1 },
    ]);
    expect(result.issues.join(" ")).toContain('repeats the slug "card"');
  });

  it("refuses a repeated id: a node's reference would be ambiguous", () => {
    const result = checkStoredClasses([
      usable,
      { ...usable, slug: "card-b", orderIndex: 1 },
    ]);
    expect(result.issues.join(" ")).toContain('repeats the id "c1"');
  });

  it("refuses a class with no numeric orderIndex", () => {
    const result = checkStoredClasses([{ ...usable, orderIndex: "first" }]);
    expect(result.issues).toHaveLength(1);
  });

  // A named class is emitted VERBATIM into the sheet of every public page, so
  // a url() stored in one is a request every visitor makes. Unlike a token,
  // which reaches the page as a var() substitution, there is no later
  // substitution step where a policy could still see it.
  const REFUSING = { mayFetchUrl: () => false };
  const ALLOWING = { mayFetchUrl: () => true };
  const tracker = (styles: unknown) => [{ ...usable, styles }];
  const AT_BASE = { base: { base: { background: { url: TRACKER } } } };

  it("refuses a url() the site's host policy does not allow", () => {
    const result = checkStoredClasses(tracker(AT_BASE), REFUSING);
    expect(result.issues.join(" ")).toContain("does not allow");
  });

  it("accepts the same url() when the policy allows the host", () => {
    // The control that separates "the policy refused it" from "the walk
    // refuses every url()". Without this the test above passes on a gate that
    // rejects the shape and never consults the predicate at all.
    expect(checkStoredClasses(tracker(AT_BASE), ALLOWING).issues).toEqual([]);
  });

  it("accepts it when NO policy is configured, which the engine calls unasked", () => {
    // Deliberate and worth pinning: absent is not the same as an empty
    // allowlist. A site that configured no remotePatterns keeps exactly the
    // behaviour it has, and the engine's scheme allowlist stays the only
    // limit. Closing that is the renderer's half, not this gate's.
    expect(checkStoredClasses(tracker(AT_BASE)).issues).toEqual([]);
  });

  it("reaches a state and a breakpoint the compiler would emit nothing for", () => {
    // The property a compiler-as-validator gate could not have. A breakpoint
    // this site has not defined compiles to no rule TODAY and to a real rule
    // the moment someone defines it, so a gate that only judged what compiles
    // now would let the value through and serve it later.
    const result = checkStoredClasses(
      tracker({
        hover: { "not-a-defined-breakpoint": { background: { url: TRACKER } } },
      }),
      REFUSING
    );
    expect(result.issues.join(" ")).toContain("does not allow");
  });

  it("does not refuse a value the engine only WARNS about", () => {
    // Forgiving, errors only. A property this engine has not learned is a
    // warning rather than an error, because a document written by a newer
    // engine is not something the author can fix here — and a warning is a
    // value the engine accepts and emits, so refusing on one would refuse a
    // write whose result the sheet would render.
    const result = checkStoredClasses(
      tracker({ base: { base: { notAProperty: "x" } } }),
      REFUSING
    );
    expect(result.issues).toEqual([]);
  });

  it("still returns the entry it reported on, so a READ narrows rather than drops", () => {
    // The module's two postures: the write refuses the section on any issue,
    // the read keeps what the compiler can narrow for itself.
    const result = checkStoredClasses(tracker(AT_BASE), REFUSING);
    expect(result.issues).not.toEqual([]);
    expect(result.value).toHaveLength(1);
  });
});

describe("checkStoredBreakpoints", () => {
  it("accepts a set, reading an absent axis as empty", () => {
    const result = checkStoredBreakpoints({
      viewport: [
        { id: "base", label: "Base" },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
      ],
    });
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual({
      viewport: [
        { id: "base", label: "Base" },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    });
  });

  it("refuses an id repeated ACROSS axes: a style key carries no axis", () => {
    const result = checkStoredBreakpoints({
      viewport: [{ id: "base", label: "Base" }],
      container: [{ id: "base", label: "Base" }],
    });
    expect(result.issues.join(" ")).toContain('repeats the id "base"');
  });

  it("refuses a non-positive maxWidth", () => {
    const result = checkStoredBreakpoints({
      viewport: [{ id: "mobile", label: "Mobile", maxWidth: 0 }],
    });
    expect(result.issues).toHaveLength(1);
    expect(result.value?.viewport).toEqual([]);
  });
});

describe("readSiteStyleRecord", () => {
  it("reads the empty style from anything that is not a document", () => {
    expect(readSiteStyleRecord(null)).toEqual({});
    expect(readSiteStyleRecord("nonsense")).toEqual({});
  });

  it("keeps what it can type and drops what it cannot, silently", () => {
    // The read posture: a legacy or hand-corrupted row must cost the broken
    // entry, not every page on the site. The engine re-reports value-level
    // problems at compile, so nothing is lost by not refusing here.
    const style = readSiteStyleRecord({
      tokens: {
        tokens: [token("color.primary", "#123456"), { broken: true }],
      },
      classes: "not-an-array",
      breakpoints: { viewport: [{ id: "base", label: "Base" }] },
    });
    expect(style.tokens?.tokens.map(t => t.name)).toEqual(["color.primary"]);
    expect(style.classes).toBeUndefined();
    expect(style.breakpoints?.viewport).toHaveLength(1);
  });
});
