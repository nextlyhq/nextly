/**
 * The columns a Builder save was to drop from a translations table and did not: told from the two
 * snapshots by name, and only where the database still has them. What tells a correct reading from a
 * plausible wrong one:
 *
 * - the column a repeater or group keeps its text in, recorded apart from the translated fields';
 * - a column the save did not drop, which a comparison of the whole table would name;
 * - a name the dialect compares without case;
 * - whose values a column still holds, since one renamed or moved is not one to throw away.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  NextlySchemaSnapshot,
  TableSpec,
} from "../../pipeline/diff/types";
import { translationsLeftOver } from "../translations-left-over";

const live = vi.hoisted(() => ({
  columns: [] as string[],
  asked: [] as string[],
}));
vi.mock("../../../i18n/runtime/companion-io", () => ({
  companionColumnNames: async (_adapter: unknown, table: string) => {
    live.asked.push(table);
    return live.columns;
  },
}));

const adapterOf = (dialect: string) =>
  ({ getCapabilities: () => ({ dialect }) }) as unknown as DrizzleAdapter;

/** A snapshot of one table, with the columns its main table and its translations table record. */
function snapshot(
  table: { main?: string[]; translated?: string[]; overlays?: string[] } | null
): NextlySchemaSnapshot {
  const tables: TableSpec[] =
    table === null
      ? []
      : [
          {
            name: "dc_posts",
            columns: (table.main ?? ["id"]).map(name => ({
              name,
              type: "text",
              nullable: true,
            })),
            ...(table.translated === undefined
              ? {}
              : { localized: true, localizedColumns: table.translated }),
            ...(table.overlays === undefined
              ? {}
              : { overlayColumns: table.overlays }),
          } as TableSpec,
        ];
  return { tables } as NextlySchemaSnapshot;
}

/** What is left over on `dialect`, from `before` to `target`. */
const left = (
  before: NextlySchemaSnapshot,
  target: NextlySchemaSnapshot,
  {
    dialect = "sqlite",
    renamed = [] as Array<{ from: string; to: string }>,
  } = {}
) => translationsLeftOver(adapterOf(dialect), before, target, renamed);

beforeEach(() => {
  live.columns = ["_parent", "_locale", "heading", "box"];
  live.asked = [];
});

describe("the columns a save was to drop from a translations table", () => {
  it("names a removed translated field's column still there", async () => {
    expect(
      await left(
        snapshot({ translated: ["heading", "note"] }),
        snapshot({ translated: ["note"] })
      )
    ).toEqual([
      {
        column: "dc_posts_locales.heading",
        holds: "the values of a field the save removed",
      },
    ]);
  });

  it("names the column a removed container kept its text in", async () => {
    expect(
      await left(
        snapshot({ translated: ["heading"], overlays: ["box"] }),
        snapshot({ translated: ["heading"] })
      )
    ).toEqual([
      {
        column: "dc_posts_locales.box",
        holds: "the values of a field the save removed",
      },
    ]);
  });

  it("names nothing where the column is gone, or the translations table is", async () => {
    const before = snapshot({ translated: ["heading"] });
    const target = snapshot({ translated: [] });
    live.columns = ["_parent", "_locale", "box"];
    expect(await left(before, target)).toEqual([]);
    live.columns = [];
    expect(await left(before, target)).toEqual([]);
  });

  // A column neither snapshot drops, whatever else the table holds, is not the save's to speak of.
  it("names nothing a save keeps, adds, or never recorded", async () => {
    live.columns = ["_parent", "_locale", "heading", "box", "by_hand"];
    expect(
      await left(
        snapshot({ translated: ["heading"], overlays: ["box"] }),
        snapshot({ translated: ["heading", "added"], overlays: ["box"] })
      )
    ).toEqual([]);
    expect(live.asked, "no table read where nothing is dropped").toEqual([]);
  });

  // A container translated whole that keeps its text in its own column since is one and the same.
  it("names nothing where a translated field's column becomes a container's", async () => {
    expect(
      await left(
        snapshot({ translated: ["box"] }),
        snapshot({ translated: [], overlays: ["box"] })
      )
    ).toEqual([]);
  });

  it("names nothing of an entity the save deleted", async () => {
    expect(
      await left(snapshot({ translated: ["heading"] }), snapshot(null))
    ).toEqual([]);
  });

  it("says whose values a renamed field's column holds, and a moved one's", async () => {
    expect(
      await left(
        snapshot({ translated: ["heading"], overlays: ["box"] }),
        snapshot({
          main: ["id", "heading"],
          translated: [],
          overlays: ["crate"],
        }),
        { renamed: [{ from: "box", to: "crate" }] }
      )
    ).toEqual([
      {
        column: "dc_posts_locales.heading",
        holds:
          "the values of a field that is no longer translated, not yet moved to dc_posts.heading",
      },
      {
        column: "dc_posts_locales.box",
        holds: 'the values of the field the save renamed to "crate"',
      },
    ]);
  });

  it("compares names as the dialect does", async () => {
    live.columns = ["Heading"];
    const before = snapshot({ translated: ["heading"] });
    const target = snapshot({ translated: [] });
    expect(await left(before, target, { dialect: "mysql" })).toHaveLength(1);
    expect(await left(before, target, { dialect: "postgresql" })).toEqual([]);
    // One renamed only by its case is the same column there.
    const recased = snapshot({ translated: ["Heading"] });
    expect(await left(before, recased, { dialect: "mysql" })).toEqual([]);
  });
});
