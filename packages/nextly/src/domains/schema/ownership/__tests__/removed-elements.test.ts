/**
 * The judgement `refuseRemovingOthersElements` makes from what it reads, with each source stubbed
 * as a database would answer it:
 *
 * - an index is judged by the columns the database's index stands on, not by what its owner now
 *   declares under the same name, and one the database no longer has stands on nothing;
 * - a foreign key pointing at several removed columns is its owner's own to remove only where every
 *   one of them is its owner's;
 * - names are compared as the databases compare them: ASCII letters folded, nothing else;
 * - a key on a table whose plugin no configuration names any more is that plugin's, by the table's
 *   recorded owner;
 * - a table a statement writes lower-cased is judged as the database's own spelling of it.
 *
 * The roads that run it, on SQLite, PostgreSQL and MySQL, are the integration tests beside this.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { Deletion } from "../../migrate/data-loss-consent";
import type {
  ElementOnTable,
  ExtensionSchemaRecord,
} from "../dependent-elements";
import {
  refuseRemovingOthersElements,
  type KeyInto,
  type RemovedElementsSources,
} from "../removed-elements";

const TABLE = "dc_posts";
const PLUGIN = { kind: "plugin", id: "@t/indexer" } as const;

/** Sources answering as a database holding exactly `live` answers. */
function sources(live: {
  recorded?: ElementOnTable[];
  indexColumns?: Record<string, string[]>;
  indexNames?: string[];
  keysInto?: KeyInto[];
  /** The table `keysInto` points at; the change's table unless given. */
  keysIntoTable?: string;
  /** Tables a plugin's owner row names, whether or not a configuration still names the plugin. */
  tableOwners?: Record<string, { kind: "plugin"; id: string }>;
  /** A table's live spellings, where the database spells it other than the change does. */
  liveNames?: Record<string, string[]>;
  schema?: ExtensionSchemaRecord | null;
}): RemovedElementsSources {
  return {
    extensionSchema: () => Promise.resolve(live.schema ?? null),
    // Matched by folded name, as the owner rows a push has read are (`removedElementsSourcesOn`).
    recordedElements: tables =>
      Promise.resolve(
        (live.recorded ?? []).filter(element =>
          tables.some(
            table => table.toLowerCase() === element.table.toLowerCase()
          )
        )
      ),
    indexColumns: () =>
      Promise.resolve(new Map(Object.entries(live.indexColumns ?? {}))),
    indexNames: () =>
      Promise.resolve(
        new Set([
          ...Object.keys(live.indexColumns ?? {}),
          ...(live.indexNames ?? []),
        ])
      ),
    foreignKeyColumns: () => Promise.resolve(new Map()),
    keysInto: table =>
      Promise.resolve(
        table === (live.keysIntoTable ?? TABLE)
          ? (live.keysInto ?? [])
          : ([] as KeyInto[])
      ),
    tableOwners: tables =>
      Promise.resolve(
        new Map(
          Object.entries(live.tableOwners ?? {}).filter(([table]) =>
            tables.some(each => each.toLowerCase() === table.toLowerCase())
          )
        )
      ),
    liveNames: table => Promise.resolve(live.liveNames?.[table] ?? [table]),
  };
}

const columns = (...names: string[]): Deletion[] =>
  names.map(column => ({ kind: "column", table: TABLE, column }));

/** What the check refused with, or undefined where it let the change through. */
async function judged(
  deletions: Deletion[],
  from: RemovedElementsSources,
  /** Names as the database has them, as a push gives them; a file's are read lower-cased. */
  exactNames = false
): Promise<NextlyError | undefined> {
  try {
    await refuseRemovingOthersElements({
      deletions,
      exactNames,
      sources: from,
      dialect: "postgresql",
      entity: "Collection 'posts'",
    });
    return undefined;
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
}

const recordedIndex: ElementOnTable = {
  owner: PLUGIN,
  kind: "index",
  name: "idx_code",
  table: TABLE,
};

describe("an index is judged by what the database's index stands on", () => {
  it("refuses removing the column the live index stands on, whatever its owner now declares", async () => {
    // The owner now declares an index of the same name on `note`; the database's is on `code`.
    const schema = {
      specs: [],
      owners: new Map(),
      entityColumns: new Map(),
      entityIndexes: new Map([
        [
          TABLE,
          [{ columns: ["note"], name: "idx_code", contributedBy: PLUGIN }],
        ],
      ]),
      elementOwners: new Map(),
    } as unknown as ExtensionSchemaRecord;

    const refused = await judged(
      columns("code"),
      sources({
        schema,
        recorded: [recordedIndex],
        indexColumns: { idx_code: ["code"] },
      })
    );

    expect(refused?.publicMessage).toContain('index "idx_code"');
  });

  it("lets a column go once the index on it is gone from the database, though its record stays", async () => {
    const refused = await judged(
      columns("code"),
      sources({ recorded: [recordedIndex] })
    );

    expect(refused).toBeUndefined();
  });

  it("refuses where the database has the index but cannot say which columns it stands on", async () => {
    const refused = await judged(
      columns("code"),
      sources({ recorded: [recordedIndex], indexNames: ["idx_code"] })
    );

    expect(refused?.publicMessage).toContain("cannot be told");
  });
});

describe("two indexes whose names differ only in letter case", () => {
  it("judges the recorded one by its own columns, not its sibling's", async () => {
    const refused = await judged(
      columns("code"),
      sources({
        recorded: [{ ...recordedIndex, name: "IDX_CODE" }],
        indexColumns: { idx_code: ["note"], IDX_CODE: ["code"] },
      })
    );

    expect(refused?.publicMessage).toContain('index "IDX_CODE"');
  });

  it("lets the column only its sibling stands on go", async () => {
    const refused = await judged(
      columns("note"),
      sources({
        recorded: [{ ...recordedIndex, name: "IDX_CODE" }],
        indexColumns: { idx_code: ["note"], IDX_CODE: ["code"] },
      })
    );

    expect(refused).toBeUndefined();
  });
});

describe("a key pointing at several removed columns", () => {
  /** The plugin's key into `code` and `extra`, with `extra` the plugin's own column. */
  const key: KeyInto = {
    table: "plugin_refs",
    name: "fk_refs",
    columns: ["code_ref", "extra_ref"],
    referencesColumns: ["extra", "code"],
  };
  const ownKey: ElementOnTable = {
    owner: PLUGIN,
    kind: "fk",
    name: "fk_refs",
    table: "plugin_refs",
  };
  const ownColumn: ElementOnTable = {
    owner: PLUGIN,
    kind: "column",
    name: "extra",
    table: TABLE,
  };

  it("is refused where one of them is another owner's, whichever comes first", async () => {
    for (const referencesColumns of [
      ["extra", "code"],
      ["code", "extra"],
    ]) {
      const refused = await judged(
        columns("extra", "code"),
        sources({
          recorded: [ownKey, ownColumn],
          keysInto: [{ ...key, referencesColumns }],
        })
      );

      expect(refused?.publicMessage, referencesColumns.join()).toContain(
        'fk "fk_refs"'
      );
    }
  });

  it("goes with them where every one is its owner's", async () => {
    const refused = await judged(
      columns("extra"),
      sources({
        recorded: [ownKey, ownColumn],
        keysInto: [{ ...key, referencesColumns: ["extra"] }],
      })
    );

    expect(refused).toBeUndefined();
  });
});

describe("names compared as the databases compare them", () => {
  const unrecorded = (referencesColumns: string[]): KeyInto => ({
    table: "elsewhere",
    name: "fk_elsewhere",
    columns: ["ref"],
    referencesColumns,
  });

  it("matches a key spelling the removed column in other ASCII letter cases", async () => {
    const refused = await judged(
      columns("code"),
      sources({ keysInto: [unrecorded(["CODE"])] })
    );

    expect(refused?.publicMessage).toContain('fk "fk_elsewhere"');
  });

  it("keeps two names apart that differ only in a letter outside ASCII", async () => {
    const refused = await judged(
      columns("ä"),
      sources({ keysInto: [unrecorded(["Ä"])] })
    );

    expect(refused).toBeUndefined();
  });
});

describe("a key on a table a plugin owns that no configuration names any more", () => {
  const key: KeyInto = {
    table: "plugin_notes",
    name: "fk_notes",
    columns: ["link_ref"],
    referencesColumns: ["id"],
  };
  const gone = { kind: "plugin", id: "@t/gone" } as const;
  const removingTheTable: Deletion[] = [
    { kind: "table", table: "dc_posts__tags" },
  ];

  it("is refused into a removed table, by the table's recorded owner", async () => {
    const refused = await judged(
      removingTheTable,
      sources({
        keysInto: [key],
        keysIntoTable: "dc_posts__tags",
        tableOwners: { plugin_notes: gone },
      })
    );

    expect(refused?.publicMessage).toContain('fk "fk_notes"');
    expect(refused?.publicMessage).toContain("@t/gone");
  });

  it("leaves a key no record names, a relationship of Nextly's own, to go with the table", async () => {
    const refused = await judged(
      removingTheTable,
      sources({ keysInto: [key], keysIntoTable: "dc_posts__tags" })
    );

    expect(refused).toBeUndefined();
  });
});

describe("a table the change spells otherwise than the database", () => {
  it("is judged by the database's own spelling of it, whatever case the statement wrote", async () => {
    const refused = await judged(
      columns("code"),
      sources({
        liveNames: { [TABLE]: ["Dc_Posts"] },
        recorded: [{ ...recordedIndex, table: "Dc_Posts" }],
        indexColumns: { idx_code: ["code"] },
      })
    );

    expect(refused?.publicMessage).toContain('index "idx_code"');
  });
});

describe("two tables whose names differ only in letter case", () => {
  const onTheOther: ElementOnTable = { ...recordedIndex, table: "Dc_Posts" };

  it("keeps an element on the one the change leaves, removing from the other", async () => {
    const refused = await judged(
      columns("code"),
      sources({
        liveNames: { [TABLE]: [TABLE, "Dc_Posts"] },
        recorded: [onTheOther],
        indexColumns: { idx_code: ["code"] },
      }),
      true
    );

    expect(refused).toBeUndefined();
  });

  it("refuses an element on the one the change removes from", async () => {
    const refused = await judged(
      columns("code"),
      sources({
        liveNames: { [TABLE]: [TABLE, "Dc_Posts"] },
        recorded: [recordedIndex, onTheOther],
        indexColumns: { idx_code: ["code"] },
      }),
      true
    );

    expect(refused?.publicMessage).toContain(`on ${TABLE}`);
    expect(refused?.publicMessage).not.toContain("on Dc_Posts");
  });

  it("refuses what stands on each, where the change removes both", async () => {
    const refused = await judged(
      [
        { kind: "table", table: TABLE },
        { kind: "table", table: "Dc_Posts" },
      ],
      sources({
        liveNames: {
          [TABLE]: [TABLE, "Dc_Posts"],
          Dc_Posts: [TABLE, "Dc_Posts"],
        },
        recorded: [recordedIndex, onTheOther],
        indexColumns: { idx_code: ["code"] },
      }),
      true
    );

    expect(refused?.publicMessage).toContain(`on ${TABLE}`);
    expect(refused?.publicMessage).toContain("on Dc_Posts");
  });

  it("refuses what stands on either, where a file names the table: its names are read lower-cased", async () => {
    const refused = await judged(
      columns("code"),
      sources({
        liveNames: { [TABLE]: [TABLE, "Dc_Posts"] },
        recorded: [onTheOther],
        indexColumns: { idx_code: ["code"] },
      })
    );

    expect(refused?.publicMessage).toContain("on Dc_Posts");
  });

  it("judges a table the change spells in a case of its own by the one the database has", async () => {
    const refused = await judged(
      columns("code"),
      sources({
        liveNames: { [TABLE]: ["Dc_Posts"] },
        recorded: [{ ...recordedIndex, table: "DC_POSTS" }],
        indexColumns: { idx_code: ["code"] },
      })
    );

    expect(refused?.publicMessage).toContain('index "idx_code"');
  });
});
