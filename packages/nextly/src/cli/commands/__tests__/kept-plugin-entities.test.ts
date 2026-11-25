/**
 * What `db:sync` says of the entities a plugin contributed that the configuration no longer holds:
 * each named with its plugin, and the way to remove them only where there is one.
 */
import { describe, expect, it } from "vitest";

import { reportKeptPluginEntities } from "../kept-plugin-entities";

function said(
  kind: Parameters<typeof reportKeptPluginEntities>[0],
  rows: Parameters<typeof reportKeptPluginEntities>[1],
  declared: string[] = []
): string[] {
  const lines: string[] = [];
  const say = (line: string) => {
    lines.push(line);
  };
  reportKeptPluginEntities(
    kind,
    rows,
    declared.map(slug => ({ slug })),
    { newline: () => {}, info: say, item: say }
  );
  return lines;
}

const ROWS = [
  { slug: "shop", source: "plugin:@acme/shop" },
  { slug: "kept", source: "plugin:@acme/kept" },
  { slug: "app", source: "code" },
  { slug: "built", source: "ui" },
  { slug: "unknown" },
];

describe("the entities a departed plugin leaves", () => {
  it("are named with their plugin, and no other entity with them", () => {
    expect(said("single", ROWS, ["kept"])).toEqual([
      "1 single(s) kept, contributed by a plugin and no longer in your config:",
      "shop (@acme/shop)",
      "--remove-orphaned leaves them as they are.",
    ]);
  });

  it("say nothing where none is left", () => {
    expect(said("single", ROWS, ["shop", "kept"])).toEqual([]);
  });

  it("name nextly prune for collections, which it takes, and for no other kind", () => {
    expect(said("collection", ROWS, ["kept"]).join(" ")).toContain(
      "nextly prune"
    );
    for (const kind of ["single", "component"] as const) {
      expect(said(kind, ROWS, ["kept"]).join(" ")).not.toContain("prune");
    }
  });
});
