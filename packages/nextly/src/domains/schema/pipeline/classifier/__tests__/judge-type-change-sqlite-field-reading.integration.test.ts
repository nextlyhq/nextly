/**
 * On SQLite, `db:sync` and the development push judge a column's type change by what the new field
 * reads from each value, beside the column rule, which there finds every value kept.
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

const fieldsOf = (value: Record<string, unknown>) => [
  { name: "title", type: "text" },
  { name: "value", ...value },
];

/** The collection as code declares it: never the Schema Builder's. */
const desiredOf = (
  fields: Record<string, unknown>,
  recorded?: Record<string, unknown>
): DesiredSchema => ({
  collections: {
    [TABLE]: {
      slug: TABLE,
      tableName: TABLE,
      fields: fieldsOf(fields) as never,
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
    recorded?: Record<string, unknown>
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
      desiredOf(to, recorded)
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

    // The rebuild, as the apply makes it: the table made anew for the checkbox by a code-first
    // apply, every value copied into it.
    sqlite.exec(`ALTER TABLE "${TABLE}" RENAME TO "${TABLE}_old"`);
    clearCachedSnapshot();
    const rebuilt = await applyCodeFirst(
      noopClassifier,
      desiredOf({ type: "checkbox" })
    );
    expect(rebuilt.error).toBeUndefined();
    sqlite.exec(
      `INSERT INTO "${TABLE}" (id, title, slug, value) SELECT id, title, slug, value FROM "${TABLE}_old"`
    );
    sqlite.exec(`DROP TABLE "${TABLE}_old"`);
    // A value written since the consent was given, which it never named.
    sqlite
      .prepare(`UPDATE "${TABLE}" SET value = 'perhaps' WHERE id = 'r3'`)
      .run();

    const event: TypeChangeEvent = {
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
    };
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
});
