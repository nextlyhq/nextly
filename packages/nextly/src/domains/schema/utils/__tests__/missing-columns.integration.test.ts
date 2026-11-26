/**
 * `addMissingColumnsForFields` adds only the columns a table does not have, on each database.
 *
 * Read on the real driver, because how it names a catalogue row's column is the driver's: MySQL 8
 * answers `COLUMN_NAME` however the query spells it. A read that missed the name took every column
 * for missing, and the database refused each one as a duplicate.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { Logger } from "../../../../shared/types/index";
import { addMissingColumnsForFields } from "../missing-columns";

const TABLE = "dc_mc_articles";

describeEachDialect("adding the columns a table misses", dialect => {
  let handle: TestNextly;
  let adapter: DrizzleAdapter;
  let warned: string[];

  const logger: Logger = {
    debug: () => {},
    info: () => {},
    error: () => {},
    warn: (message: string) => {
      warned.push(message);
    },
  };

  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  beforeEach(async () => {
    handle = await createTestNextly({ dialect });
    adapter = handle.adapter as unknown as DrizzleAdapter;
    warned = [];
    // Made by the generator the Schema Builder uses, holding two of the fields.
    await seedBuilderCollection(adapter, {
      slug: "mc_articles",
      fields: [
        { name: "grade", type: "number" },
        { name: "score", type: "number" },
      ],
    });
    await adapter.executeQuery(
      `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("grade")}, ${q("score")}) VALUES ('a', 'Kept', 'kept', 3, 7)`
    );
  }, 60_000);

  afterEach(async () => {
    await handle?.destroy();
  }, 60_000);

  const add = (names: string[]) =>
    addMissingColumnsForFields(
      adapter,
      logger,
      TABLE,
      names.map(name => ({ name, type: "number" }) as FieldConfig),
      { timestamps: true, builtBy: "codeFirst" }
    );

  it("adds the missing one, leaves the rest and the row, and says nothing", async () => {
    expect(await add(["grade", "score", "rank"])).toEqual(["rank"]);
    expect(warned).toEqual([]);
    expect(
      await adapter.executeQuery(
        `SELECT ${q("id")}, ${q("grade")}, ${q("score")}, ${q("rank")} FROM ${q(TABLE)}`
      )
    ).toEqual([{ id: "a", grade: 3, score: 7, rank: null }]);
  });

  it("adds nothing and says nothing when none is missing", async () => {
    await add(["rank"]);
    expect(await add(["grade", "score", "rank"])).toEqual([]);
    expect(warned).toEqual([]);
  });

  it("still reports a column the database refuses, by name, and only that one", async () => {
    const refusing = new Proxy(adapter, {
      get(target, key, receiver) {
        if (key !== "executeQuery") return Reflect.get(target, key, receiver);
        return async (sql: string, params?: never[]) => {
          if (sql.startsWith("ALTER TABLE") && sql.includes("rank")) {
            throw new Error("refused by the database");
          }
          return target.executeQuery(sql, params);
        };
      },
    });
    const added = await addMissingColumnsForFields(
      refusing,
      logger,
      TABLE,
      ["grade", "rank", "depth"].map(
        name => ({ name, type: "number" }) as FieldConfig
      ),
      { timestamps: true, builtBy: "codeFirst" }
    );
    expect(added).toEqual(["depth"]);
    expect(warned).toEqual([
      `Failed to add column rank to ${TABLE}: refused by the database`,
    ]);
  });
});
