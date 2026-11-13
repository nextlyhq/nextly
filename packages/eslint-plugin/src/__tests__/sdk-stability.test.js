import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MANIFEST_PATH,
  docMarksExperimental,
  readStabilityTables,
  releaseParagraphs,
  renderManifest,
} from "../../scripts/sdk-stability.mjs";

describe("the committed manifest", () => {
  it("matches what the SDK's stability record generates", () => {
    // Failing here means a surface was tagged, graduated or added in the SDK
    // without regenerating: `pnpm --filter @nextlyhq/eslint-plugin generate`.
    expect(readFileSync(MANIFEST_PATH, "utf8")).toBe(renderManifest());
  });
});

describe("releaseParagraphs", () => {
  it("reads a tag only at the start of a doc-comment line", () => {
    const doc = "*\n * A `@public` or `@experimental` tag, named in prose.\n ";
    expect(releaseParagraphs(doc)).toEqual([]);
  });

  it("ends a paragraph at the next tag of any kind", () => {
    const doc =
      "*\n * @experimental `a` is new.\n * @module x\n * `b` here.\n ";
    const [paragraph] = releaseParagraphs(doc);
    expect(paragraph.tag).toBe("experimental");
    expect(paragraph.text).not.toContain("`b`");
  });
});

describe("docMarksExperimental", () => {
  const mixed = [
    "*",
    " * @public `Stable`, `AlsoStable`.",
    " * @experimental `Hooks` — not yet exercised. Phase-2 types — `Role`,",
    " *   `Schedule` — are experimental too.",
    " ",
  ].join("\n");

  it("covers every name of the statement under a lone experimental tag", () => {
    expect(docMarksExperimental("* @experimental New. ", "anything")).toBe(
      true
    );
  });

  it("covers nothing under a lone public tag, or none", () => {
    expect(docMarksExperimental("* @public Stable. ", "anything")).toBe(false);
    expect(docMarksExperimental("* No tag. ", "anything")).toBe(false);
  });

  it("splits a mixed comment by the names each paragraph gives", () => {
    expect(docMarksExperimental(mixed, "Hooks")).toBe(true);
    expect(docMarksExperimental(mixed, "Schedule")).toBe(true);
    expect(docMarksExperimental(mixed, "Stable")).toBe(false);
    expect(docMarksExperimental(mixed, "Unnamed")).toBe(false);
  });
});

describe("readStabilityTables", () => {
  const markdown = [
    "## Stable surface (`@public`)",
    "| Surface | Exports | Exerciser |",
    "| ------- | ------- | --------- |",
    "| Routes | `PluginRoute`, `RateLimit` (experimental) | x |",
    "| Plugin | `definePlugin`, `Carrier` | x |",
    "## Experimental surface (`@experimental`)",
    "| Surface | Exports | Why |",
    "| ------- | ------- | --- |",
    "| Manifest | `capabilities` on `Carrier`; `getThing`, `ctx.db.raw` | new |",
  ].join("\n");
  const tables = readStabilityTables(markdown);

  it("takes the experimental table's names, and stable ones marked so in place", () => {
    expect([...tables.experimental].sort()).toEqual(
      ["RateLimit", "capabilities", "getThing"].sort()
    );
  });

  it("lets the stable table win over an experimental row naming its type", () => {
    expect(tables.stable.has("Carrier")).toBe(true);
    expect(tables.experimental.has("Carrier")).toBe(false);
  });

  it("ignores context paths, which are not import names", () => {
    expect(tables.experimental.has("ctx.db.raw")).toBe(false);
  });
});
