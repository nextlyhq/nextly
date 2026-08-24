/**
 * The token round trip, driven the way the studio drives it.
 *
 * `dtcgToTokens` and `tokensToDtcg` are the engine's and are tested there. What
 * is only true HERE is the policy around them: that an import MERGES rather
 * than replacing, that it merges on identity rather than on name, that a file
 * this site can only partly use imports partly and names the rest, and that
 * what is exported is the same text a visitor's stylesheet contains.
 *
 * Every assertion runs the real engine functions, so a change to what the
 * format can carry shows up here rather than in a fixture that agrees with an
 * old belief.
 *
 * @module tokens-transfer.test
 */
import {
  dtcgToTokens,
  emitTokenBlocks,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { exportCss, exportDtcg, importDtcg } from "./tokens-transfer";

/** A site whose second token is RENAMED, so identity and name differ. */
const SITE: SiteTokenSet = {
  tokens: [
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
    {
      id: "color.primary",
      name: "brand.main",
      kind: "color",
      values: { light: "#3b82f6" },
    },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

/** The document this site would hand another tool. */
const exported = (set: SiteTokenSet): string => exportDtcg(set).text;

describe("what comes out", () => {
  it("round-trips a site's own tokens without losing identity", () => {
    // The property the whole pair exists for. A renamed token carries an
    // identity distinct from its label, and a format with nowhere to put it
    // would return it as a NEW token — colliding with the one it came from.
    const back = importDtcg(exported(SITE), { tokens: [] });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const brand = back.tokens.tokens.find(t => t.name === "brand.main");
    expect(brand?.id).toBe("color.primary");
    expect(brand?.values.light).toBe("#3b82f6");
  });

  it("exports the DECLARATIONS a visitor's stylesheet holds", () => {
    // Asserted against the emitter rather than by repeating the same
    // `compileSiteSheet` call: two identical calls compared to each other agree
    // by construction, whatever either is passed, so a wrong argument would
    // break neither side. `emitTokenBlocks` is the function that decides what a
    // token declaration IS, and it is reached by a different route.
    const css = exportCss(SITE);
    const declared = emitTokenBlocks(SITE, ":root").css;
    expect(declared).not.toBe("");
    for (const property of [
      "--site-color-ink",
      "--site-color-primary",
      "--site-space-4",
    ]) {
      expect(declared, "the emitter writes it").toContain(property);
      expect(css.text, "and the export carries it").toContain(property);
    }
  });

  it("offers a name and a type for each artefact", () => {
    // Part of the file rather than chrome: a download called "download" is one
    // the author has to rename before anything else will read it.
    expect(exportDtcg(SITE).filename).toBe("tokens.json");
    expect(exportDtcg(SITE).mime).toBe("application/json");
    expect(exportCss(SITE).filename).toBe("tokens.css");
    expect(exportCss(SITE).mime).toBe("text/css");
  });

  it("pretty-prints, so a diff is readable", () => {
    expect(exported(SITE)).toContain("\n  ");
  });
});

describe("what goes in", () => {
  it("MERGES: a token the file never mentions survives", () => {
    // Replacing would delete tokens blocks across the site still reference,
    // with the page rendering and no error anywhere.
    const file = exported({
      tokens: [{ name: "color.new", kind: "color", values: { light: "#0f0" } }],
    });
    const result = importDtcg(file, SITE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.tokens.map(t => t.name)).toEqual([
      "color.ink",
      "brand.main",
      "space.4",
      "color.new",
    ]);
  });

  it("merges on IDENTITY, not on the label", () => {
    // The separating case, and it needs the labels to DIFFER: a file whose
    // token carries the same identity under a NEW label — a rename made in the
    // design tool. Keyed on the name that finds no match and arrives as a
    // second entry beside the one it came from, and the two then collide on
    // the single custom property they both compose.
    //
    // Measured: with the labels equal, keying on either field passes, so a
    // fixture where they match cannot tell the two implementations apart.
    const file = exported({
      tokens: [
        {
          id: "color.primary",
          name: "brand.hero",
          kind: "color",
          values: { light: "#e11d48" },
        },
      ],
    });
    const result = importDtcg(file, SITE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Three, not four: the file replaced the entry rather than joining it.
    expect(result.tokens.tokens.length).toBe(3);
    expect(result.tokens.tokens.map(t => t.name)).toEqual([
      "color.ink",
      "brand.hero",
      "space.4",
    ]);
    expect(
      result.tokens.tokens.find(t => t.id === "color.primary")?.values.light
    ).toBe("#e11d48");
  });

  it("keeps a replaced token in its place, and appends what is new", () => {
    // An import must not reshuffle a table the author has been reading.
    const file = exported({
      tokens: [
        { name: "color.ink", kind: "color", values: { light: "#000000" } },
        { name: "color.zzz", kind: "color", values: { light: "#ffffff" } },
      ],
    });
    const result = importDtcg(file, SITE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.tokens.map(t => t.name)).toEqual([
      "color.ink",
      "brand.main",
      "space.4",
      "color.zzz",
    ]);
    expect(result.tokens.tokens[0]?.values.light).toBe("#000000");
  });

  it("imports what fits and NAMES what it could not", () => {
    // The engine maps seven `$type`s and the format defines more, so a file
    // from a design tool usually holds entries this site has no kind for.
    // Refusing the file for them would mean import almost never succeeds.
    const mixed = JSON.parse(exported(SITE)) as Record<string, unknown>;
    (mixed as Record<string, unknown>)["motion"] = {
      ease: { $type: "cubicBezier", $value: [0.4, 0, 0.2, 1] },
    };
    const result = importDtcg(JSON.stringify(mixed), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(3);
    expect(result.skipped.join(" ")).toContain("cubicBezier");
    expect(result.skipped.join(" ")).toContain("no token kind for");
  });

  it("counts what LANDED, and names a token the file said twice", () => {
    // Two DTCG paths carrying one identity are two entries to the format and
    // one token here, because they compose a single custom property. Only the
    // last can land. Counting the file's entries would claim an arrival that
    // did not happen — two tokens in, one out, and a report saying two.
    const twice = {
      brand: {
        one: {
          $type: "color",
          $value: "#111111",
          $extensions: {
            "com.nextlyhq.nextly": {
              css: { light: "#111111" },
              kind: "color",
              id: "color.shared",
            },
          },
        },
        two: {
          $type: "color",
          $value: "#222222",
          $extensions: {
            "com.nextlyhq.nextly": {
              css: { light: "#222222" },
              kind: "color",
              id: "color.shared",
            },
          },
        },
      },
    };
    const result = importDtcg(JSON.stringify(twice), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One token arrived, not two.
    expect(result.tokens.tokens.length).toBe(1);
    expect(result.imported).toBe(1);
    // And the loss is named rather than left for the author to notice.
    expect(result.skipped.join(" ")).toContain("one token in that file");
    expect(result.skipped.join(" ")).toContain("color.shared");
  });

  it("refuses a token whose NAME another token here already owns", () => {
    // The studio forbids a duplicate label outright, so admitting one would
    // import a state the editor cannot create and cannot repair — and the
    // export would then place both at one DTCG path and drop one, making the
    // round trip lossy with nothing announcing it.
    const file = exported({
      tokens: [
        {
          id: "other.id",
          name: "brand.main",
          kind: "color",
          values: { light: "#e11d48" },
        },
      ],
    });
    const result = importDtcg(file, SITE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The site is untouched, and the refusal is named.
    expect(result.tokens.tokens.map(t => t.name)).toEqual([
      "color.ink",
      "brand.main",
      "space.4",
    ]);
    expect(result.imported).toBe(0);
    expect(result.skipped.join(" ")).toContain(
      "already the name of a different token"
    );
  });

  it("still lets a file rename a token it OWNS", () => {
    // The control. Checking the name against every token including the one
    // being replaced would refuse every rename — a file is not clashing with
    // itself.
    const file = exported({
      tokens: [
        {
          id: "color.primary",
          name: "brand.hero",
          kind: "color",
          values: { light: "#e11d48" },
        },
      ],
    });
    const result = importDtcg(file, SITE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.tokens.tokens.map(t => t.name)).toEqual([
      "color.ink",
      "brand.hero",
      "space.4",
    ]);
  });

  it("refuses a token that would COLLIDE on a custom property", () => {
    // Not visible in the names: `color.primary-dark` and `color-primary.dark`
    // read as different tokens and compose the same property, so the emitter
    // writes the first and refuses the second. Accepted here, the import looks
    // successful and its value never reaches the page — discovered only on a
    // later export.
    const site: SiteTokenSet = {
      tokens: [
        {
          name: "color.primary-dark",
          kind: "color",
          values: { light: "#111111" },
        },
      ],
    };
    const file = exported({
      tokens: [
        {
          name: "color-primary.dark",
          kind: "color",
          values: { light: "#222222" },
        },
      ],
    });
    const result = importDtcg(file, site);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(0);
    expect(result.tokens.tokens.map(t => t.name)).toEqual([
      "color.primary-dark",
    ]);
    expect(result.skipped.join(" ")).toContain("both become");
    // And the engine agrees the result is clean.
    expect(emitTokenBlocks(result.tokens, ":root").issues).toEqual([]);
  });

  it("applies a COORDINATED rename whichever order the file lists it in", () => {
    // A design tool emits these whenever someone reorganises a palette. Judged
    // entry by entry against a mutating destination, the outcome depends on
    // file order — and half-applying a coordinated rename is worse than
    // refusing it, because the half that lands is a rename nobody asked for on
    // its own.
    const site: SiteTokenSet = {
      tokens: [
        {
          id: "id.a",
          name: "alpha",
          kind: "color",
          values: { light: "#111111" },
        },
        {
          id: "id.b",
          name: "beta",
          kind: "color",
          values: { light: "#222222" },
        },
      ],
    };
    const shuffle = (tokens: SiteTokenSet["tokens"]) =>
      importDtcg(exported({ tokens }), site);

    for (const order of [
      [
        {
          id: "id.a",
          name: "beta",
          kind: "color" as const,
          values: { light: "#333333" },
        },
        {
          id: "id.b",
          name: "gamma",
          kind: "color" as const,
          values: { light: "#444444" },
        },
      ],
      [
        {
          id: "id.b",
          name: "gamma",
          kind: "color" as const,
          values: { light: "#444444" },
        },
        {
          id: "id.a",
          name: "beta",
          kind: "color" as const,
          values: { light: "#333333" },
        },
      ],
    ]) {
      const result = shuffle(order);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.imported, JSON.stringify(order.map(t => t.name))).toBe(2);
      expect(result.tokens.tokens.map(t => t.name)).toEqual(["beta", "gamma"]);
    }
  });

  it("keeps a token whose only clash was with one that had to be refused", () => {
    // The dependent case. `foo.bar` must fail on its name against a token this
    // file does not touch; `foo-bar` shares a custom property only with
    // `foo.bar`, so it is importable the moment that one is gone. Judged in a
    // single pass it is discarded for a conflict that does not survive.
    const site: SiteTokenSet = {
      tokens: [{ name: "taken", kind: "color", values: { light: "#111111" } }],
    };
    const file = exported({
      tokens: [
        {
          id: "foo.bar",
          name: "taken",
          kind: "color",
          values: { light: "#222222" },
        },
        {
          id: "foo-bar",
          name: "usable",
          kind: "color",
          values: { light: "#333333" },
        },
      ],
    });
    const result = importDtcg(file, site);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.tokens.tokens.map(t => t.name)).toEqual(["taken", "usable"]);
    expect(result.skipped.join(" ")).toContain(
      "already the name of a different token"
    );
    // And the result the engine sees is clean.
    expect(emitTokenBlocks(result.tokens, ":root").issues).toEqual([]);
  });

  it("refuses BOTH when a file contradicts only itself", () => {
    // The control for the pass above. Two incoming tokens that are one token
    // here, neither clashing with the site — there is no ground to prefer
    // either, so both are refused and both are named.
    const file = exported({
      tokens: [
        { id: "a.b", name: "one", kind: "color", values: { light: "#111111" } },
        { id: "a-b", name: "two", kind: "color", values: { light: "#222222" } },
      ],
    });
    const result = importDtcg(file, { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(0);
    expect(result.skipped.join(" ")).toContain("both become");
  });

  it("names an export whose vendor data will not SURVIVE being written", () => {
    // The quiet case. `JSON.stringify` succeeds and drops things on the way —
    // a `toJSON` returning undefined, a function, a symbol — so "did it throw"
    // is not the question. What rides in `$extensions` includes this system's
    // record of a token's stable identity, and losing it makes the file
    // un-round-trippable: importing it back gives the token a new identity.
    const made = exportDtcg({
      tokens: [
        {
          name: "color.ink",
          kind: "color",
          values: { light: "#111111" },
          extensions: { vendor: { toJSON: () => undefined } } as never,
        },
      ],
    });
    // The file is still written — it is lossy, not impossible.
    expect(made.text).not.toBe("");
    expect(made.skipped.join(" ")).toContain(
      "vendor data that a file cannot hold"
    );
    expect(made.skipped.join(" ")).toContain("different identity");
  });

  it("judges every kind of value a file can and cannot hold", () => {
    // Each branch is a distinct way vendor data goes missing, and each is a
    // real shape a plugin config can produce. Walked here so the rule is
    // evidence rather than assertion.
    const holds = (vendor: unknown): boolean =>
      exportDtcg({
        tokens: [
          {
            name: "color.ink",
            kind: "color",
            values: { light: "#111111" },
            extensions: { vendor } as never,
          },
        ],
      }).skipped.length === 0;

    // A file can carry these as they stand.
    for (const good of [
      "s",
      true,
      false,
      0,
      -1.5,
      null,
      [],
      {},
      [1, "a"],
      { a: { b: [true] } },
    ]) {
      expect(holds(good), JSON.stringify(good)).toBe(true);
    }
    // And these become something else, or nothing, on the way.
    for (const bad of [
      () => 1,
      Symbol("s"),
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      { toJSON: () => 1 },
      [() => 1],
      { deep: { deeper: undefined } },
    ]) {
      expect(holds(bad), String(bad)).toBe(false);
    }
  });

  it("reports an export it could not WRITE rather than throwing", () => {
    // `extensions` carries vendor data untouched, as the format requires, and
    // a site's own config can put a value in there that JSON has no form for.
    // Thrown from a click handler, nothing downloads and nothing is said.
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const made = exportDtcg({
      tokens: [
        {
          name: "color.ink",
          kind: "color",
          values: { light: "#111111" },
          extensions: { vendor: cyclic },
        },
      ],
    });
    expect(made.text).toBe("");
    expect(made.skipped.join(" ")).toContain("cannot be written to a file");
  });

  it("names an entry that is neither a token nor a group", () => {
    // The engine's walk descends into every non-`$` child and simply continues
    // when it is not an object — nothing reported. Part of the source file is
    // gone, from a feature whose whole purpose is naming what was lost.
    const document = JSON.parse(exported(SITE)) as Record<string, unknown>;
    document["lost"] = 42;
    (document["nested"] as unknown) = { deeper: "also lost" };

    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(3);
    const said = result.skipped.join(" ");
    expect(said).toContain('"lost" is neither a token nor a group');
    expect(said).toContain('"nested.deeper" is neither a token nor a group');
  });

  it("names a group's own token, which the reader cannot yet take", () => {
    // `$root` is a TOKEN name in DTCG 2025.10, not a reserved field: a group
    // carries its own token there, so `color.$root` is a real token. The shared
    // reader skips every `$` key, so it is neither imported nor mentioned —
    // silent loss arriving through the one `$` key that is not metadata.
    const document = JSON.parse(exported(SITE)) as Record<string, unknown>;
    (document["color"] as Record<string, unknown>)["$root"] = {
      $type: "color",
      $value: "#abcdef",
    };

    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped.join(" ")).toContain("color.$root");
    expect(result.skipped.join(" ")).toContain("group's own token");
  });

  it("names a GROUP's metadata, which the reader keeps nothing of", () => {
    // On a token these are read and carried. On a group they are not: the
    // reader flattens a group's children and keeps nothing of the group, so a
    // group's description and vendor data are gone from the next export.
    const document = JSON.parse(exported(SITE)) as Record<string, unknown>;
    const group = document["color"] as Record<string, unknown>;
    group["$description"] = "The brand palette";
    group["$extensions"] = { "com.figma": { collection: "Brand" } };

    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const said = result.skipped.join(" ");
    expect(said).toContain("color.$description");
    expect(said).toContain("color.$extensions");
    expect(said).toContain("belongs to a group");
  });

  it("says NOTHING about a token's own description and extensions", () => {
    // The control, and the distinction the check turns on: a node holding
    // `$value` is a token, and its metadata is read rather than discarded.
    // Reporting it would name a loss that did not happen, on every file this
    // system itself writes.
    const result = importDtcg(exported(SITE), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([]);
  });

  it(
    "does not spread a wide document across the argument limit",
    /*
     * A deliberate stress case with an explicit budget. Two hundred thousand
     * entries take well under a second here and were measured at nearly seven
     * on slower hardware under a full package run — past Vitest's five-second
     * default, so the suite failed for the machine rather than for the code.
     *
     * Given time rather than shrunk: the argument limit is engine-dependent
     * (about 125,000 here), so a fixture sized to just cross it would stop
     * crossing it somewhere else and quietly test nothing.
     */
    { timeout: 60_000 },
    () => {
      // A shallow file with enough top-level entries: `push(...frontier)` passes
      // every entry as an ARGUMENT and exceeds the engine's limit. Making the
      // walk iterative to escape recursion depth and then spreading its frontier
      // trades one stack overflow for another.
      // Asserted as a SUCCESS rather than as "does not throw". The boundary now
      // catches a `RangeError` and answers with a refusal, so not-throwing holds
      // whether the walk works or blows up and is caught — measured: with the
      // spread restored, this file is refused and `not.toThrow()` still passes.
      // Only "the import succeeded and brought everything" separates them.
      const wide: Record<string, unknown> = {};
      for (let n = 0; n < 200_000; n += 1) {
        wide[`n${String(n)}`] = { $type: "number", $value: n };
      }
      const result = importDtcg(JSON.stringify(wide), { tokens: [] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.imported).toBe(200_000);
      expect(result.skipped).toEqual([]);
    }
  );

  it("says nothing about a well-formed document", () => {
    // The control: a detector that named everything would satisfy the test
    // above without distinguishing anything.
    const result = importDtcg(exported(SITE), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([]);
  });

  it("REFUSES a document nested past what the reader can walk", () => {
    // The conversion recurses, so a few thousand groups — tens of kilobytes of
    // file — exhausts the stack. A `RangeError` is not something a caller can
    // act on, and past this boundary the panel would let it escape into a
    // discarded promise: nothing shown, import silently stopped.
    /*
     * Built by STRING rather than by nesting objects, and parsed by a stub
     * rather than by `JSON.parse`.
     *
     * A depth constant makes the test depend on the runtime's stack: too few
     * levels and nothing overflows, so the import succeeds and this fails; too
     * many and `JSON.parse` overflows first, so the refusal is "not valid JSON"
     * and this fails differently. Both are intermittent CI failures about the
     * machine rather than about the code.
     *
     * The boundary is what matters — that a conversion which throws becomes a
     * refusal — so the throw is produced directly.
     */
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new RangeError("Maximum call stack size exceeded");
        },
      }
    );
    const parse = JSON.parse;
    JSON.parse = () => proxy;
    try {
      const result = importDtcg("{}", SITE);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("nested too deeply");
    } finally {
      JSON.parse = parse;
    }
  });

  it("tells a corrupt file from the wrong file", () => {
    // Different failures with different repairs: one is truncated, the other
    // is a file that was never a token document. One message covering both
    // sends the author to look in the wrong place.
    const notJson = importDtcg("{ this is not json", SITE);
    expect(notJson.ok).toBe(false);
    if (notJson.ok) return;
    expect(notJson.error).toContain("not valid JSON");

    const notTokens = importDtcg('{"hello":"world"}', SITE);
    expect(notTokens.ok).toBe(false);
    if (notTokens.ok) return;
    expect(notTokens.error).toContain("No tokens in that file");
  });

  it("changes NOTHING when it refuses", () => {
    // The property that makes a refusal safe to retry.
    const before = JSON.stringify(SITE);
    importDtcg("{ broken", SITE);
    importDtcg('{"hello":"world"}', SITE);
    expect(JSON.stringify(SITE)).toBe(before);
  });

  it("carries the engine's reasons through rather than restating them", () => {
    // The messages are written for a person and were tested where they live. A
    // second wording here would drift from them and be the one an author reads.
    //
    // Asserted against the engine's OWN output rather than against a shape:
    // `Array.isArray(skipped)` holds on every return path, so it passes whether
    // or not a reason survives — a test that cannot fail.
    const file = JSON.parse(exported(SITE)) as Record<string, unknown>;
    file["motion"] = {
      ease: { $type: "cubicBezier", $value: [0.4, 0, 0.2, 1] },
    };
    const document = JSON.stringify(file);

    const mine = importDtcg(document, { tokens: [] });
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    const theirs = dtcgToTokens(JSON.parse(document)).issues.map(
      issue => issue.message
    );
    expect(theirs.length).toBeGreaterThan(0);
    for (const said of theirs) expect(mine.skipped).toContain(said);
  });
});

describe("what a file can and cannot carry back out", () => {
  it("refuses a collection that LOOKS like a record", () => {
    // A `Map` has no own enumerable keys, so a walk over its values finds
    // nothing and calls it safe — and `JSON.stringify` writes it as `{}`,
    // erasing everything it held. Counting keys cannot see this; the prototype
    // can, which is what the engine's own guard reads.
    const made = exportDtcg({
      tokens: [
        {
          name: "color.ink",
          kind: "color",
          values: { light: "#111111" },
          extensions: { vendor: new Map([["lost", 1]]) } as never,
        },
      ],
    });
    expect(made.skipped.join(" ")).toContain(
      "vendor data that a file cannot hold"
    );
  });

  it("does not throw when reading vendor data throws", () => {
    // The preflight reads the same values the write does, so a throwing getter
    // reaches it one line before `JSON.stringify` — a check added to stop an
    // export throwing out of a click handler, throwing out of it first.
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "toJSON", {
      enumerable: true,
      get: () => {
        throw new Error("no");
      },
    });
    let made: ReturnType<typeof exportDtcg> | undefined;
    expect(() => {
      made = exportDtcg({
        tokens: [
          {
            name: "color.ink",
            kind: "color",
            values: { light: "#111111" },
            extensions: { vendor: hostile } as never,
          },
        ],
      });
    }).not.toThrow();
    expect(made?.text).toBe("");
    expect(made?.skipped.join(" ")).toContain("cannot be written to a file");
  });

  it("hands over NOTHING when there is no CSS to write", () => {
    // A newline downloads as `tokens.css` and reports as saved, telling an
    // author their tokens were written when nothing was.
    const made = exportCss({ tokens: [] });
    expect(made.text).toBe("");
  });
});

describe("metadata a token loses on the way in", () => {
  it("names a $description the reader will not keep", () => {
    // The reader keeps a string and takes nothing otherwise — no message, no
    // field. The token imports looking successful and comes back out without
    // its description.
    const document = {
      foo: { $type: "number", $value: 1, $description: 42 },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.skipped.join(" ")).toContain("foo.$description");
    expect(result.skipped.join(" ")).toContain("is not a string");
  });

  it("names $extensions that are not an object", () => {
    const document = {
      foo: { $type: "number", $value: 1, $extensions: "vendor" },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped.join(" ")).toContain("foo.$extensions");
    expect(result.skipped.join(" ")).toContain("is not an object");
  });

  it("says nothing about metadata the reader DOES keep", () => {
    // The control. Reporting a well-formed description would name a loss that
    // did not happen, on every file carrying one.
    const document = {
      foo: {
        $type: "number",
        $value: 1,
        $description: "fine",
        $extensions: { "com.figma": { id: 1 } },
      },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([]);
  });
});

describe("what the reader passes over", () => {
  it("names a token written INSIDE another token", () => {
    // `dtcgToTokens` reads an entry with a `$value` and moves to the next
    // SIBLING, so a token nested in one is never reached. It is the loss this
    // walk is least able to notice, because everything about the child looks
    // importable.
    const document = {
      parent: {
        $type: "number",
        $value: 1,
        child: { $type: "number", $value: 2 },
      },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The control: the PARENT did import, so the fixture reached the reader
    // and the child's absence is the reader's decision rather than a document
    // nothing could read.
    expect(result.tokens.tokens.map(token => token.name)).toEqual(["parent"]);
    expect(result.skipped.join(" ")).toContain("parent.child");
  });

  it("names a $type the reader cannot use, and the type it fell back to", () => {
    // The token still arrives — with the GROUP's type, not the one the file
    // states — so nothing about the import looks wrong.
    const document = {
      group: { $type: "number", foo: { $type: 42, $value: 1 } },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.tokens.map(token => token.kind)).toEqual(["number"]);
    expect(result.skipped.join(" ")).toContain("group.foo.$type");
  });

  it("names a reserved field it has never heard of", () => {
    // The property the allowlist buys: a field this file does not know is
    // REPORTED rather than passed over, so the walk erring costs a line of
    // noise instead of a token lost in silence.
    const document = { foo: { $type: "number", $value: 1, $deprecated: true } };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.tokens.map(token => token.name)).toEqual(["foo"]);
    expect(result.skipped.join(" ")).toContain("foo.$deprecated");
  });
});

describe("a name is also a PATH", () => {
  it("refuses a token that would make one name a token AND a group", () => {
    const into: SiteTokenSet = {
      tokens: [{ name: "brand.main", kind: "number", values: { light: "1" } }],
    };
    const document = { brand: { $type: "number", $value: 2 } };
    const result = importDtcg(JSON.stringify(document), into);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tokens.tokens.map(token => token.name)).toEqual([
      "brand.main",
    ]);
    expect(result.imported).toBe(0);
    expect(result.skipped.join(" ")).toContain("cannot be imported beside");

    /*
     * The harm, demonstrated rather than asserted: a table holding both cannot
     * be written back out. One of the two is dropped whichever order they are
     * placed in — the exporter says "already a token" or "exported more than
     * once" depending on which it reaches first — so the LOSS is what this
     * asserts rather than either wording.
     */
    const both = exportDtcg({
      tokens: [
        ...into.tokens,
        { name: "brand", kind: "number", values: { light: "2" } },
      ],
    });
    expect(both.skipped).toHaveLength(1);
    expect(
      dtcgToTokens(JSON.parse(both.text)).tokens.map(token => token.name)
    ).toEqual(["brand.main"]);
  });

  it("still imports a name that only SHARES a group with another", () => {
    // The control. `brand.main` and `brand.dark` pass through the same group
    // and neither IS that group, so a check reading the relation too widely
    // would refuse an ordinary file.
    const into: SiteTokenSet = {
      tokens: [{ name: "brand.main", kind: "number", values: { light: "1" } }],
    };
    const document = {
      brand: { dark: { $type: "number", $value: 2 } },
    };
    const result = importDtcg(JSON.stringify(document), into);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.tokens.map(token => token.name)).toEqual([
      "brand.main",
      "brand.dark",
    ]);
    expect(result.imported).toBe(1);
  });
});

describe("the export guard covers the CONVERSION too", () => {
  it("reports vendor data that throws while being COPIED", () => {
    // A getter on the extensions record itself is read by `tokensToDtcg` when
    // it spreads them — before the preflight walks them and before
    // `JSON.stringify` sees anything.
    const extensions: Record<string, unknown> = {};
    Object.defineProperty(extensions, "com.figma", {
      enumerable: true,
      get() {
        throw new Error("unreadable");
      },
    });
    const tokens: SiteTokenSet = {
      tokens: [
        { name: "foo", kind: "number", values: { light: "1" }, extensions },
      ],
    };

    const result = exportDtcg(tokens);
    expect(result.text).toBe("");
    expect(result.skipped.join(" ")).toContain("cannot be written to a file");
  });
});

describe("a refusal can create the next clash", () => {
  it("settles a cascade of THREE coordinated renames", () => {
    /*
     * The separating case for one round versus many. `id.a` is refused because
     * an untouched token already holds `taken`; that refusal reverts `id.a` to
     * `alpha`, which forces `id.c` out; and THAT refusal restores the stored
     * `gamma` beside the still-accepted `id.d`. Nothing in a single round looks
     * at the table the second refusal produced.
     */
    const into: SiteTokenSet = {
      tokens: [
        { id: "id.a", name: "alpha", kind: "number", values: { light: "1" } },
        { id: "id.c", name: "gamma", kind: "number", values: { light: "2" } },
        { name: "taken", kind: "number", values: { light: "3" } },
      ],
    };
    const carrying = (id: string, value: number) => ({
      $type: "number",
      $value: value,
      $extensions: { "com.nextlyhq.nextly": { id } },
    });
    const document = {
      taken: carrying("id.a", 9),
      alpha: carrying("id.c", 8),
      gamma: carrying("id.d", 7),
    };

    const result = importDtcg(JSON.stringify(document), into);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No name twice. Asserted as a SET comparison rather than a count, because
    // a table holding one name twice has the same length as a correct one.
    const names = result.tokens.tokens.map(token => token.name);
    expect([...new Set(names)]).toEqual(names);
    expect(result.imported).toBe(0);

    // The property all of that exists for: what survives can be written out.
    expect(exportDtcg(result.tokens).skipped).toEqual([]);
  });
});

describe("vendor data that is written back CHANGED", () => {
  it("refuses a sparse array, which JSON fills with nulls", () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = "here";
    const tokens: SiteTokenSet = {
      tokens: [
        {
          name: "foo",
          kind: "number",
          values: { light: "1" },
          extensions: { "com.figma": { order: sparse } },
        },
      ],
    };

    // The control on the fixture: `every` never VISITS the hole, which is
    // exactly why a walk over the values it can see could not notice this, and
    // `JSON.stringify` then invents a value that was never stored.
    let visited = 0;
    sparse.every(() => {
      visited += 1;
      return true;
    });
    expect(sparse.length).toBe(2);
    expect(visited).toBe(1);
    expect(JSON.stringify(sparse)).toBe('[null,"here"]');

    const result = exportDtcg(tokens);
    expect(result.skipped.join(" ")).toContain("foo");
  });

  it("still writes a DENSE array untouched", () => {
    // The control. An array is ordinary vendor data and refusing one would
    // report a loss on every file carrying a list.
    const tokens: SiteTokenSet = {
      tokens: [
        {
          name: "foo",
          kind: "number",
          values: { light: "1" },
          extensions: { "com.figma": { order: [1, "two", null] } },
        },
      ],
    };
    const result = exportDtcg(tokens);
    expect(result.skipped).toEqual([]);
    expect(result.text).toContain('"two"');
  });
});

describe("a cascade of refusals", () => {
  it("settles a chain thousands of renames long", { timeout: 10_000 }, () => {
    /*
     * Each refusal frees the name the NEXT rename wants, so the chain is as
     * deep as the file is long. Judging that by re-reading the whole table
     * once per refusal is quadratic: 1082ms for 2000 tokens on the main
     * thread, and roughly seventeen seconds for this input.
     *
     * The assertions below check the OUTCOME, which the slow form also got
     * right. The budget is a coarse second net, and its limits belong here
     * rather than left to read as a performance test:
     *
     * - it catches the shape this replaced, about seventeen seconds against
     *   160ms now, so a machine several times slower still separates them;
     * - it does NOT catch a merely slower one. Measured by breaking only the
     *   propagation and leaving the indexes: 1.56 seconds, a tenfold
     *   regression that passes this budget comfortably.
     *
     * A budget tight enough to catch that would be measuring the machine,
     * which is the worse trade — so the gap is named rather than closed.
     */
    const n = 8000;
    const into: SiteTokenSet = {
      tokens: [
        { name: "taken", kind: "number", values: { light: "0" } },
        ...Array.from({ length: n }, (_, index) => ({
          id: `id.${String(index)}`,
          name: `n${String(index)}`,
          kind: "number" as const,
          values: { light: "1" },
        })),
      ],
    };
    const carrying = (id: string): unknown => ({
      $type: "number",
      $value: 1,
      $extensions: { "com.nextlyhq.nextly": { id } },
    });
    const document: Record<string, unknown> = { taken: carrying("id.0") };
    for (let index = 1; index < n; index++) {
      document[`n${String(index - 1)}`] = carrying(`id.${String(index)}`);
    }

    const result = importDtcg(JSON.stringify(document), into);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Every rename in the chain is refused, and the table is left exactly as
    // it was — the correctness half, which the slow form also got right.
    expect(result.imported).toBe(0);
    expect(result.skipped).toHaveLength(n);
    const names = result.tokens.tokens.map(token => token.name);
    expect([...new Set(names)]).toEqual(names);
  });
});

describe("this system's own extension, read field by field", () => {
  it("names a dark value the reader will not take", () => {
    // The reader uses the extension's CSS only when every field it needs holds:
    // a `dark` that is not a string is dropped and the token imports with its
    // light value, looking entirely successful.
    const document = {
      brand: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0, 0, 0] },
        $extensions: {
          "com.nextlyhq.nextly": {
            css: { light: "#111111", dark: 42 },
            kind: "color",
          },
        },
      },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The control: the token DID import, so the loss is the reader's decision
    // about one field rather than a document it could not read.
    expect(result.tokens.tokens.map(token => token.name)).toEqual(["brand"]);
    expect(result.tokens.tokens[0]?.values.dark).toBeUndefined();
    expect(result.skipped.join(" ")).toContain("css.dark");
  });

  it("says nothing about an extension the reader takes whole", () => {
    /*
     * The control. Reporting a well-formed payload would name a loss that did
     * not happen, on every file this system exported itself.
     *
     * Built by EXPORTING rather than written out, because the fixture has to
     * hold a property to be a control at all: `$value` and the stored CSS must
     * agree, and hand-writing both is how they stop agreeing. The first version
     * of this test paired an srgb black `$value` with a `#111111` light value
     * and was a disagreement wearing a control's name.
     */
    const result = importDtcg(
      exportDtcg({
        tokens: [
          {
            name: "brand",
            kind: "color",
            values: { light: "#111111", dark: "#eeeeee" },
          },
        ],
      }).text,
      { tokens: [] }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.tokens[0]?.values.dark).toBe("#eeeeee");
    expect(result.skipped).toEqual([]);
  });
});

describe("what the report says about a token named twice", () => {
  it("does not claim the survivor landed when it did not", () => {
    /*
     * The choice between two entries carrying one identity is made BEFORE any
     * clash is judged, and the survivor can still be refused. A message saying
     * it "was taken" then sits in the same report as one saying it "was not
     * imported", about the same token, on an import that changed nothing.
     */
    const into: SiteTokenSet = {
      tokens: [{ name: "taken", kind: "number", values: { light: "0" } }],
    };
    const carrying = (id: string): unknown => ({
      $type: "number",
      $value: 1,
      $extensions: { "com.nextlyhq.nextly": { id } },
    });
    const document = { first: carrying("shared"), taken: carrying("shared") };

    const result = importDtcg(JSON.stringify(document), into);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.imported).toBe(0);
    const said = result.skipped.join(" ");
    // Both facts are still reported: which entry was dropped for the other,
    // and that the survivor could not be imported either.
    expect(said).toContain("dropped in favour of");
    expect(said).toContain("was not imported");
    // And nothing claims an arrival. This is the assertion that fails on the
    // wording it replaced.
    expect(said).not.toContain("was taken");
  });
});

describe("the reader's whole condition for stored CSS", () => {
  it("names a kind the format has no type for", () => {
    /*
     * `readToken` takes the stored CSS only when the block is an object, its
     * light value is a string AND the kind is one the format has a type for.
     * With a valid light value and an unusable kind it reads the native
     * `$value` instead — so the token imports looking successful and holds a
     * different value from the one the extension states.
     */
    const document = {
      thing: {
        $type: "number",
        $value: 1,
        $extensions: {
          "com.nextlyhq.nextly": { css: { light: "99" }, kind: "bogus" },
        },
      },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The separating observation: the value came from `$value`, not the CSS.
    expect(result.tokens.tokens[0]?.values.light).toBe("1");
    expect(result.skipped.join(" ")).toContain("com.nextlyhq.nextly");
  });

  it("says nothing about an extension carrying only an identity", () => {
    /*
     * The control, and the case that makes a blunter check unusable: a rename
     * travels as an extension holding an `id` and nothing else. It states no
     * values, so there is nothing to have lost, and reporting one would name a
     * loss on every coordinated rename a design tool emits.
     */
    const document = {
      renamed: {
        $type: "number",
        $value: 1,
        $extensions: { "com.nextlyhq.nextly": { id: "kept.identity" } },
      },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.tokens[0]?.id).toBe("kept.identity");
    expect(result.skipped).toEqual([]);
  });
});

describe("vendor data whose written form is not the value", () => {
  it("refuses an ARRAY that serialises itself", () => {
    // `toJSON` belongs to any object. Asked only of records, it was never
    // reached for an array, which returned as soon as its elements checked out.
    const listing: unknown[] = [1, 2];
    (listing as { toJSON?: () => unknown }).toJSON = () => [9];
    const tokens: SiteTokenSet = {
      tokens: [
        {
          name: "foo",
          kind: "number",
          values: { light: "1" },
          extensions: { "com.figma": { order: listing } },
        },
      ],
    };

    // The control on the fixture: every element is writable on its own, and
    // the written form is still something that was never stored.
    expect(JSON.stringify(listing)).toBe("[9]");

    const result = exportDtcg(tokens);
    expect(result.skipped.join(" ")).toContain("foo");
  });
});

describe("a vendor payload the reader throws away", () => {
  it("names this system's own key when it is not an object", () => {
    /*
     * The reader DELETES this key before carrying the rest of the block
     * through, so whatever it held is gone and the next export writes a
     * generated object in its place. Absent and discarded look identical from
     * the outside, which is why it has to be said.
     */
    const document = {
      thing: {
        $type: "number",
        $value: 1,
        $extensions: { "com.nextlyhq.nextly": "future" },
      },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The control: the token itself DID import, so this is the reader dropping
    // one field rather than a document it could not read.
    expect(result.tokens.tokens.map(token => token.name)).toEqual(["thing"]);
    expect(result.skipped.join(" ")).toContain("com.nextlyhq.nextly");
  });

  it("says nothing when the key is simply absent", () => {
    // The control that stops the check firing on every file from another tool.
    const document = {
      thing: {
        $type: "number",
        $value: 1,
        $extensions: { "com.figma": { id: 7 } },
      },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([]);
  });
});

describe("a value the file states and this site did not use", () => {
  it("carries the reader's own report through to the import", () => {
    /*
     * The engine decides this, at the point it chooses between the two forms —
     * it is the only code that knows both. What is asserted here is that the
     * verdict REACHES the author: an issue the reader raises and this layer
     * drops would be a loss reported to nobody.
     */
    const document = {
      brand: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0, 0, 0] },
        $extensions: {
          "com.nextlyhq.nextly": {
            css: { light: "#111111" },
            kind: "color",
          },
        },
      },
    };
    const result = importDtcg(JSON.stringify(document), { tokens: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.tokens[0]?.values.light).toBe("#111111");
    expect(result.skipped.join(" ")).toContain("was not used");
  });
});

describe("a document nested past what the reader can name", () => {
  /** A stack of groups `levels` deep with one unreadable entry at the bottom. */
  const deep = (levels: number): string => {
    let open = "";
    let close = "";
    for (let level = 0; level < levels; level += 1) {
      open += `{"g${String(level)}":`;
      close += "}";
    }
    return `${open}{"bad":42}${close}`;
  };

  it("says it once for the whole subtree, not once per entry", () => {
    /*
     * Past the segment limit the engine refuses the branch WHOLE and says so in
     * one line. This traversal used to walk on into it and add its own findings
     * about entries nothing was ever going to read — so the author got a second
     * account of a region already condemned, and paid a full traversal for it.
     *
     * Asserted on the OUTPUT rather than on a clock, because the clock cannot
     * separate this: the cost was carried by rebuilding the path per node, and
     * fixing that alone took a 15000-deep file from seconds to 16ms. The bound
     * takes it to 8ms, and what it really buys is this one message.
     */
    const result = importDtcg(deep(70), { tokens: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("groups deep");
  });

  it("still reports a shallow document fully", () => {
    /*
     * The control, and the one that matters most: a bound set too tight would
     * stop naming real losses while every assertion about a deep file kept
     * passing. An ordinary document must still be walked to the bottom.
     */
    const result = importDtcg(deep(5), { tokens: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.skipped.join(" ")).toContain("g0.g1.g2.g3.g4.bad");
  });
});
