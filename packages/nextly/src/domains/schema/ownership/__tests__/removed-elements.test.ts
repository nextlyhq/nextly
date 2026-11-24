/**
 * The judgement `refuseRemovingOthersElements` makes from what it reads, with each source stubbed
 * as a database would answer it:
 *
 * - an index is judged by the columns the database's index stands on, not by what its owner now
 *   declares under the same name, and one the database no longer has stands on nothing;
 * - a foreign key pointing at several removed columns is its owner's own to remove only where every
 *   one of them is its owner's;
 * - names are compared as the databases compare them: ASCII letters folded, nothing else.
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
  schema?: ExtensionSchemaRecord | null;
}): RemovedElementsSources {
  return {
    extensionSchema: () => Promise.resolve(live.schema ?? null),
    recordedElements: tables =>
      Promise.resolve(
        (live.recorded ?? []).filter(element => tables.includes(element.table))
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
        table === TABLE ? (live.keysInto ?? []) : ([] as KeyInto[])
      ),
  };
}

const columns = (...names: string[]): Deletion[] =>
  names.map(column => ({ kind: "column", table: TABLE, column }));

/** What the check refused with, or undefined where it let the change through. */
async function judged(
  deletions: Deletion[],
  from: RemovedElementsSources
): Promise<NextlyError | undefined> {
  try {
    await refuseRemovingOthersElements({
      deletions,
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
