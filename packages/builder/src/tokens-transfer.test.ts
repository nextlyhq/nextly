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
import { compileSiteSheet, type SiteTokenSet } from "@nextlyhq/blocks-engine";
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

  it("exports CSS that IS the sheet a visitor would get", () => {
    // Compiled rather than assembled, so the file cannot describe a site that
    // does not exist.
    const css = exportCss(SITE);
    expect(css.text.trimEnd()).toBe(
      compileSiteSheet({
        tokens: SITE,
        breakpoints: { base: { id: "base", label: "Base" } } as never,
      }).css
    );
    expect(css.text).toContain("--site-color-primary");
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

  it("REFUSES a document nested past what the reader can walk", () => {
    // The conversion recurses, so a few thousand groups — tens of kilobytes of
    // file — exhausts the stack. A `RangeError` is not something a caller can
    // act on, and past this boundary the panel would let it escape into a
    // discarded promise: nothing shown, import silently stopped.
    let node: Record<string, unknown> = { $type: "color", $value: "#111111" };
    for (let level = 0; level < 4000; level += 1) node = { group: node };

    const result = importDtcg(JSON.stringify(node), SITE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("nested too deeply");
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
    // The messages are written for a person and were tested where they live.
    // A second wording here would drift from them and be the one an author
    // reads.
    const result = importDtcg('{"hello":"world"}', SITE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Array.isArray(result.skipped)).toBe(true);
  });
});
