/**
 * On SQLite, `db:sync` judges a column's type change by what the new field reads from each value,
 * beside the column rule, which there finds every value kept.
 *
 * Each case is a code-first collection: its table is made by a code-first apply of the real
 * pipeline, then a second apply changes its field, with the fields the registry recorded before
 * it where the case has them, and the judgement the classifier is handed is read. The clearing is
 * then run as the apply runs it on SQLite: after the table's rebuild.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../../../database/index";
import { clearCachedSnapshot } from "../../../../../init/schema-snapshot-cache";
import { DrizzleStatementExecutor } from "../../../services/drizzle-statement-executor";
import type { Operation } from "../../diff/types";
import { freshPushSchema } from "../../fresh-push";
import { clearConsentedValues } from "../../pre-cleanup/executor";
import { PushSchemaPipeline } from "../../pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../../pushschema-pipeline-stubs";
import type { Classifier } from "../../pushschema-pipeline-interfaces";
import type { TypeChangeEvent } from "../../resolution/types";
import type { DesiredSchema } from "../../types";
import type { JudgedTypeChange, TypeChangeJudge } from "../judge-type-change";

const TABLE = "dc_jts_items";

/**
 * Whether the cases' `value` field sits inside a group with no name, which only lays fields out:
 * the field's column is on the entry's row either way.
 */
let inNamelessGroup = false;

const fieldsOf = (value: Record<string, unknown>) => [
  { name: "title", type: "text" },
  inNamelessGroup
    ? { type: "group", fields: [{ name: "value", ...value }] }
    : { name: "value", ...value },
];

/** The collection as code declares it: never the Schema Builder's. */
const desiredOf = (
  fields: Record<string, unknown>,
  recorded?: Record<string, unknown>,
  indexes?: { fields: string[]; unique?: boolean }[]
): DesiredSchema => ({
  collections: {
    [TABLE]: {
      slug: TABLE,
      tableName: TABLE,
      fields: fieldsOf(fields) as never,
      ...(indexes !== undefined ? { indexes } : {}),
      ...(recorded !== undefined
        ? { recordedFields: fieldsOf(recorded) as never }
        : {}),
    },
  },
  singles: {},
  components: {},
});

/** Stops the apply once the classifier has been handed what it judges. */
class Captured extends Error {}

describe("db:sync's judgement of a column type change on SQLite", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    inNamelessGroup = false;
    clearCachedSnapshot();
    sqlite?.close();
    sqlite = new Database(":memory:");
    db = drizzle({ client: sqlite });
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  });
  afterAll(() => {
    clearCachedSnapshot();
    sqlite?.close();
  });

  const pipelineWith = (classifier: Classifier) =>
    new PushSchemaPipeline({
      executor: new DrizzleStatementExecutor("sqlite", db),
      renameDetector: noopRenameDetector,
      classifier,
      promptDispatcher: noopPromptDispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: noopPreCleanupExecutor,
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
    });

  const applyCodeFirst = (classifier: Classifier, desired: DesiredSchema) =>
    pipelineWith(classifier).apply({
      desired,
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

  /**
   * The table as a code-first apply makes it for `from`, holding `values` by row id (null for no
   * value).
   */
  async function create(
    from: Record<string, unknown>,
    values: Record<string, string | null>
  ) {
    const made = await applyCodeFirst(noopClassifier, desiredOf(from));
    expect(made.error).toBeUndefined();
    clearCachedSnapshot();
    const insert = sqlite.prepare(
      `INSERT INTO "${TABLE}" (id, title, slug, value) VALUES (?, 'T', ?, ?)`
    );
    for (const [id, value] of Object.entries(values)) insert.run(id, id, value);
  }

  /** What the classifier is handed for the `value` column's type change, by a code-first apply. */
  async function judged(
    to: Record<string, unknown>,
    recorded?: Record<string, unknown>,
    indexes?: { fields: string[]; unique?: boolean }[]
  ): Promise<JudgedTypeChange> {
    let handed: JudgedTypeChange | null | undefined;
    const result = await applyCodeFirst(
      {
        classify: async (args: { operations: Operation[] }) => {
          const judge = (args as { judgeConversion?: TypeChangeJudge })
            .judgeConversion;
          for (const op of args.operations) {
            if (op.type !== "change_column_type" || judge === undefined) {
              continue;
            }
            if (op.columnName === "value") handed = await judge(op);
          }
          throw new Captured("captured");
        },
      },
      desiredOf(to, recorded, indexes)
    );
    expect(result.error?.message).toBe("captured");
    if (handed === undefined || handed === null) {
      throw new Error("the apply planned no type change of the column");
    }
    return handed;
  }

  const rowsOf = (change: JudgedTypeChange) =>
    change.judgement.reasons.map(reason => [
      reason.kind,
      reason.class,
      (reason.rows?.first ?? []).map(key => ("id" in key ? key.id : key)),
    ]);

  const stored = () =>
    sqlite.prepare(`SELECT id, value FROM "${TABLE}" ORDER BY id`).all() as {
      id: string;
      value: unknown;
    }[];

  /**
   * The rebuild, as the apply makes it: the table made anew for `to` by a code-first apply, every
   * value copied into it.
   */
  async function rebuildAs(to: Record<string, unknown>) {
    sqlite.exec(`ALTER TABLE "${TABLE}" RENAME TO "${TABLE}_old"`);
    clearCachedSnapshot();
    const rebuilt = await applyCodeFirst(noopClassifier, desiredOf(to));
    expect(rebuilt.error).toBeUndefined();
    sqlite.exec(
      `INSERT INTO "${TABLE}" (id, title, slug, value) SELECT id, title, slug, value FROM "${TABLE}_old"`
    );
    sqlite.exec(`DROP TABLE "${TABLE}_old"`);
  }

  /** The lossy event the classifier makes of `change`, which a consent then answers. */
  const lossyEventOf = (change: JudgedTypeChange): TypeChangeEvent => ({
    id: `type_change:${TABLE}.value`,
    kind: "type_change",
    tableName: TABLE,
    columnName: "value",
    fromType: "text",
    toType: "integer",
    isWidening: false,
    perDialectWarning: { pg: "", mysql: "", sqlite: "" },
    dialect: "sqlite",
    lossy: {
      judgement: change.judgement,
      keyedBy: change.keyedBy,
      cleared: change.cleared,
      conversion: change.conversion,
      ...(change.fieldReadings !== undefined
        ? { fieldReadings: change.fieldReadings }
        : {}),
    },
  });

  it("blocks a fraction held where the field becomes a whole number, naming its row", async () => {
    await create(
      { type: "number", options: { format: "float" } },
      { r1: "2", r2: "1.5" }
    );
    const change = await judged(
      { type: "number" },
      { type: "number", options: { format: "float" } }
    );
    expect(change.judgement.class).toBe("blocked");
    expect(rowsOf(change)).toEqual([["rounded", "blocked", ["r2"]]]);
    expect(change.cleared).toEqual([]);
  });

  it("reads a field inside a group with no name as it reads one beside it", async () => {
    // The group holds no value: the field's column is on the row, and is judged like any other.
    inNamelessGroup = true;
    await create({ type: "text" }, { r1: null, r2: "maybe" });
    const change = await judged({ type: "checkbox" }, { type: "text" });
    expect(change.judgement.class).toBe("lossy");
    expect(rowsOf(change)).toEqual([["not-a-boolean", "lossy", ["r2"]]]);
  });

  it("judges by the column rule alone where the registry recorded no field before the apply", async () => {
    // Nothing says what the values were written as, so nothing is refused on a guess.
    await create(
      { type: "number", options: { format: "float" } },
      { r1: "2", r2: "1.5" }
    );
    const change = await judged({ type: "number" });
    expect(change.judgement).toEqual({ class: "safe", reasons: [] });
    expect(change.fieldReadings).toBeUndefined();
  });

  it("lets a text whose every value is a number become a number", async () => {
    await create({ type: "text" }, { r1: "5", r2: "12" });
    const change = await judged({ type: "number" }, { type: "text" });
    expect(change.judgement.class).toBe("safe");
    expect(change.cleared).toEqual([]);
  });

  it("blocks a unique field where two values to be cleared repeat: the rebuild would copy both first", async () => {
    // SQLite clears a consented value only after its rebuild, which copies every value into the
    // new column, a unique one here: two equal values end it part-way, before either is cleared.
    await create({ type: "text" }, { r1: "maybe", r2: "maybe", r3: "later" });
    const change = await judged(
      { type: "checkbox", unique: true },
      { type: "text" }
    );
    expect(change.judgement.class).toBe("blocked");
    expect(rowsOf(change)).toEqual([
      ["not-a-boolean", "lossy", ["r1", "r2", "r3"]],
      ["repeated", "blocked", ["r1", "r2"]],
    ]);
  });

  it("blocks the same repeat where the column is unique by the collection's index, not by its field", async () => {
    // One answer says which columns the schema makes unique, and an index of one column is one.
    await create({ type: "text" }, { r1: "maybe", r2: "maybe", r3: "later" });
    const change = await judged({ type: "checkbox" }, { type: "text" }, [
      { fields: ["value"], unique: true },
    ]);
    expect(change.judgement.class).toBe("blocked");
    expect(rowsOf(change)).toEqual([
      ["not-a-boolean", "lossy", ["r1", "r2", "r3"]],
      ["repeated", "blocked", ["r1", "r2"]],
    ]);
  });

  it("blocks two values the new type reads as one where the column is unique by the collection's index", async () => {
    // Nothing is cleared here: both texts are numbers. The index would hold the number 1 twice.
    await create({ type: "text" }, { r1: "1", r2: "1", r3: "2" });
    const change = await judged({ type: "number" }, { type: "text" }, [
      { fields: ["value"], unique: true },
    ]);
    expect(change.judgement.class).toBe("blocked");
    expect(rowsOf(change)).toContainEqual([
      "repeated",
      "blocked",
      ["r1", "r2"],
    ]);
  });

  it("asks only for consent where a unique field's values to be cleared all differ", async () => {
    await create({ type: "text" }, { r1: "maybe", r2: "later" });
    const change = await judged(
      { type: "checkbox", unique: true },
      { type: "text" }
    );
    expect(change.judgement.class).toBe("lossy");
    expect(rowsOf(change)).toEqual([["not-a-boolean", "lossy", ["r1", "r2"]]]);
  });

  it("clears, under consent, only the value the new field cannot read, after the rebuild, then fails naming a value written since", async () => {
    // "maybe" is no checkbox, and the column rule finds it kept: only the field's reading names it.
    await create({ type: "text" }, { r1: null, r2: "maybe", r3: null });
    const change = await judged({ type: "checkbox" }, { type: "text" });
    expect(change.judgement.class).toBe("lossy");
    expect(rowsOf(change)).toEqual([["not-a-boolean", "lossy", ["r2"]]]);
    expect(change.cleared).toEqual([{ id: "r2" }]);

    await rebuildAs({ type: "checkbox" });
    // A value written since the consent was given, which it never named.
    sqlite
      .prepare(`UPDATE "${TABLE}" SET value = 'perhaps' WHERE id = 'r3'`)
      .run();

    const event = lossyEventOf(change);
    // The apply cannot undo the rebuild, so it clears what was consented to and then fails,
    // saying what landed and naming the row written since.
    await expect(
      clearConsentedValues({
        tx: db,
        dialect: "sqlite",
        events: [event],
        clearing: [event.id],
      })
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          {
            path: `schema.${TABLE}.value`,
            code: "CONVERSION_LEFT_A_LATER_VALUE",
            message: expect.stringMatching(
              /was made, and the values consented to were cleared\. One row holds a value written after the column was checked.*r3/
            ) as unknown,
          },
        ],
      },
    });
    expect(stored()).toEqual([
      { id: "r1", value: null },
      { id: "r2", value: null },
      { id: "r3", value: "perhaps" },
    ]);
  });

  it("fails naming a consented row whose value, written since, is one the new field would need rewritten", async () => {
    // The consent named r2 for a value to clear. It now holds the text "true", which a checkbox
    // reads only once rewritten: nothing clears it, nothing rewrites it, so the run cannot succeed.
    await create({ type: "text" }, { r1: null, r2: "maybe" });
    const change = await judged({ type: "checkbox" }, { type: "text" });
    expect(change.cleared).toEqual([{ id: "r2" }]);
    await rebuildAs({ type: "checkbox" });
    sqlite
      .prepare(`UPDATE "${TABLE}" SET value = 'true' WHERE id = 'r2'`)
      .run();

    const event = lossyEventOf(change);
    await expect(
      clearConsentedValues({
        tx: db,
        dialect: "sqlite",
        events: [event],
        clearing: [event.id],
      })
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          {
            code: "CONVERSION_LEFT_A_LATER_VALUE",
            message: expect.stringMatching(/cannot read: r2\./) as unknown,
          },
        ],
      },
    });
    expect(stored()).toEqual([
      { id: "r1", value: null },
      { id: "r2", value: "true" },
    ]);
  });

  it("does not ask a field's own validate, which reads its entry, of a value judged alone", async () => {
    // The function is right about a whole entry. Asked with this one value as the entry, it
    // would refuse every row, and a consent would then clear values the field accepts.
    await create({ type: "text" }, { r1: "5", r2: "12" });
    const change = await judged(
      {
        type: "number",
        validate: (_value: unknown, { data }: { data: { title?: unknown } }) =>
          data.title === "T" ? true : "Needs its title.",
      },
      { type: "text" }
    );
    expect(change.judgement.class).toBe("safe");
    expect(change.cleared).toEqual([]);
  });

  it("blocks values a unique index of several columns would hold twice once the new type reads them", async () => {
    // "1" and " 1" differ as text and are one number. With the same title they are one pair to
    // the index of (value, title); r3 reads as 1 too, under another title, and is no repeat.
    await create({ type: "text" }, { r1: "1", r2: " 1", r3: "1", r4: "2" });
    sqlite.prepare(`UPDATE "${TABLE}" SET title = 'U' WHERE id = 'r3'`).run();
    const change = await judged({ type: "number" }, { type: "text" }, [
      { fields: ["value", "title"], unique: true },
    ]);
    expect(change.judgement.class).toBe("blocked");
    expect(rowsOf(change)).toContainEqual([
      "repeated",
      "blocked",
      ["r1", "r2"],
    ]);
  });

  it("blocks two values to be cleared that a unique index of several columns would hold twice", async () => {
    // The rebuild copies both "maybe" values into the new column, and builds the index, before
    // the consent clears either.
    await create({ type: "text" }, { r1: "maybe", r2: "maybe" });
    const change = await judged({ type: "checkbox" }, { type: "text" }, [
      { fields: ["value", "title"], unique: true },
    ]);
    expect(change.judgement.class).toBe("blocked");
    expect(rowsOf(change)).toContainEqual([
      "repeated",
      "blocked",
      ["r1", "r2"],
    ]);
  });

  it("blocks values to be cleared that the rebuild keeps as one number under a unique index of several columns", async () => {
    // Both are refused by the field's maximum and consented to be cleared, but the rebuild keeps
    // "100" and " 100" as the integer 100 and makes the index before the consent clears either.
    await create({ type: "text" }, { r1: "100", r2: " 100" });
    const change = await judged({ type: "number", max: 50 }, { type: "text" }, [
      { fields: ["value", "title"], unique: true },
    ]);
    expect(change.judgement.class).toBe("blocked");
    expect(rowsOf(change)).toContainEqual([
      "repeated",
      "blocked",
      ["r1", "r2"],
    ]);
  });

  it("lets values one number under different titles through a unique index of both columns", async () => {
    await create({ type: "text" }, { r1: "1", r2: " 1" });
    sqlite.prepare(`UPDATE "${TABLE}" SET title = 'U' WHERE id = 'r2'`).run();
    const change = await judged({ type: "number" }, { type: "text" }, [
      { fields: ["value", "title"], unique: true },
    ]);
    expect(change.judgement.class).toBe("safe");
  });

  it("clears every consented column before it fails, naming each column's rows written since", async () => {
    // Two columns converted by one rebuild, each consented to. A late value in the first must not
    // leave the second's consented values where they were: no later run offers to clear them.
    await create({ type: "text" }, { r1: null, r2: "maybe", r3: null });
    sqlite.prepare(`UPDATE "${TABLE}" SET title = NULL WHERE id = 'r3'`).run();
    const change = await judged({ type: "checkbox" }, { type: "text" });
    await rebuildAs({ type: "checkbox" });
    sqlite
      .prepare(
        `UPDATE "${TABLE}" SET value = 'perhaps', title = 'Late' WHERE id = 'r3'`
      )
      .run();

    const first = lossyEventOf(change);
    if (first.lossy?.fieldReadings === undefined) {
      throw new Error("the change was judged without its fields");
    }
    // The same rebuild's other column: `title`, a text that became a checkbox too, its consent
    // naming the two rows that held "T".
    const second: TypeChangeEvent = {
      ...first,
      id: `type_change:${TABLE}.title`,
      columnName: "title",
      lossy: {
        ...first.lossy,
        cleared: [{ id: "r1" }, { id: "r2" }],
        fieldReadings: {
          ...first.lossy.fieldReadings,
          previous: [
            { name: "title", type: "text" },
            { name: "value", type: "text" },
          ] as never,
          next: [
            { name: "title", type: "checkbox" },
            { name: "value", type: "checkbox" },
          ] as never,
          field: "title",
        },
      },
    };
    await expect(
      clearConsentedValues({
        tx: db,
        dialect: "sqlite",
        events: [first, second],
        clearing: [first.id, second.id],
      })
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          {
            path: `schema.${TABLE}.value`,
            code: "CONVERSION_LEFT_A_LATER_VALUE",
            message: expect.stringMatching(/cannot read: r3\./) as unknown,
          },
          {
            path: `schema.${TABLE}.title`,
            code: "CONVERSION_LEFT_A_LATER_VALUE",
            message: expect.stringMatching(/cannot read: r3\./) as unknown,
          },
        ],
      },
    });
    expect(
      sqlite
        .prepare(`SELECT id, title, value FROM "${TABLE}" ORDER BY id`)
        .all()
    ).toEqual([
      { id: "r1", title: null, value: null },
      { id: "r2", title: null, value: null },
      { id: "r3", title: "Late", value: "perhaps" },
    ]);
  });
});
