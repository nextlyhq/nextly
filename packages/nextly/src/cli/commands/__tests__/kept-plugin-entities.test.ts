/**
 * What `db:sync` says of the entities a plugin contributed that the configuration no longer holds:
 * each named with its plugin, and the way to remove them: a migration on a site that keeps
 * migration files, and `nextly prune` on one that does not, where it takes the kind.
 */
import { describe, expect, it, vi } from "vitest";

import { reportKeptPluginEntities } from "../kept-plugin-entities";

async function said(
  kind: Parameters<typeof reportKeptPluginEntities>[0],
  rows: Parameters<typeof reportKeptPluginEntities>[1],
  declared: string[] = [],
  keepsMigrationFiles: () => Promise<boolean> = () => Promise.resolve(false)
): Promise<string[]> {
  const lines: string[] = [];
  const say = (line: string) => {
    lines.push(line);
  };
  await reportKeptPluginEntities(
    kind,
    rows,
    declared.map(slug => ({ slug })),
    {
      logger: { newline: () => {}, info: say, item: say },
      keepsMigrationFiles,
    }
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

const KINDS = ["collection", "single", "component"] as const;

describe("the entities a departed plugin leaves", () => {
  it("are named with their plugin, and no other entity with them", async () => {
    expect(await said("single", ROWS, ["kept"])).toEqual([
      "1 single(s) kept, contributed by a plugin and no longer in your config:",
      "shop (@acme/shop)",
      "--remove-orphaned leaves them as they are.",
    ]);
  });

  it("say nothing, and read nothing, where none is left", async () => {
    const keepsMigrationFiles = vi.fn(() => Promise.resolve(true));

    expect(
      await said("single", ROWS, ["shop", "kept"], keepsMigrationFiles)
    ).toEqual([]);
    expect(keepsMigrationFiles).not.toHaveBeenCalled();
  });

  it("name nextly prune for collections, which it takes, and for no other kind", async () => {
    for (const kind of KINDS) {
      const lines = (await said(kind, ROWS, ["kept"])).join(" ");
      expect(lines.includes("nextly prune"), kind).toBe(kind === "collection");
      expect(lines, kind).not.toContain("migrate:create");
    }
  });

  it("name nextly migrate:create for every kind where the site keeps migration files, and never prune", async () => {
    for (const kind of KINDS) {
      const lines = (
        await said(kind, ROWS, ["kept"], () => Promise.resolve(true))
      ).join(" ");
      expect(lines, kind).toContain("nextly migrate:create");
      expect(lines, kind).not.toContain("prune");
    }
  });
});
