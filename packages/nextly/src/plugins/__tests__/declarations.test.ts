import { describe, expect, it } from "vitest";

import { collectDeclarations } from "../declarations";
import type { PluginDefinition } from "../plugin-context";

/** A plugin definition carrying only what this reader looks at. */
function plugin(
  name: string,
  declarations?: Record<string, unknown>,
  enabled?: boolean
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    enabled,
    contributes: declarations ? { declarations } : undefined,
  } as PluginDefinition;
}

describe("collectDeclarations", () => {
  it("returns only the declarations addressed to the consumer", () => {
    const found = collectDeclarations(
      [
        plugin("@acme/a", { "@nextlyhq/page-builder": { blocks: [1] } }),
        plugin("@acme/b", { "@nextlyhq/other": { blocks: [2] } }),
      ],
      "@nextlyhq/page-builder"
    );

    expect(found).toEqual([{ source: "@acme/a", value: { blocks: [1] } }]);
  });

  it("names the plugin that made each declaration", () => {
    // A collision has to name both culprits, which needs the value paired with
    // its author rather than merged into one list.
    const found = collectDeclarations(
      [
        plugin("@acme/a", { pb: { blocks: ["x"] } }),
        plugin("@acme/b", { pb: { blocks: ["x"] } }),
      ],
      "pb"
    );

    expect(found.map(d => d.source)).toEqual(["@acme/a", "@acme/b"]);
  });

  it("skips a disabled plugin", () => {
    // `enabled: false` withholds behaviour, and a declaration is behaviour the
    // consumer would otherwise act on.
    const found = collectDeclarations(
      [plugin("@acme/a", { pb: { blocks: [1] } }, false)],
      "pb"
    );

    expect(found).toEqual([]);
  });

  it("keeps a declaration whose value is falsy", () => {
    // Only the consumer knows whether a falsy value means anything, so presence
    // is tested rather than truthiness.
    const found = collectDeclarations([plugin("@acme/a", { pb: null })], "pb");

    expect(found).toEqual([{ source: "@acme/a", value: null }]);
  });

  it("ignores a declarations block that is an array", () => {
    // An array would be indexed by the consumer name and yield undefined for
    // every consumer, which reads as a valid but empty declaration.
    const found = collectDeclarations(
      [
        plugin("@acme/a", ["not-a-record"] as unknown as Record<
          string,
          unknown
        >),
      ],
      "pb"
    );

    expect(found).toEqual([]);
  });

  it("returns nothing when no plugin declares for the consumer", () => {
    expect(collectDeclarations([plugin("@acme/a")], "pb")).toEqual([]);
  });
});
