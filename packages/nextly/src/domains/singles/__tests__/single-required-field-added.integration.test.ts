/**
 * A required field added to a Single that already holds its row fills that row and leaves its
 * column with no default, on every dialect; a field's own default is no column default either.
 *
 * A Single's field defaults are the application's, applied when its document is written, so the
 * column carries none: the table then reads as the schema a migration is written from describes
 * it. The row added before the field existed still has to get a value for a NOT NULL column, so
 * the add fills it first.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { readTableDefinition } from "../../schema/__tests__/helpers/table-definition";
import type { SingleEntryService } from "../services/single-entry-service";

const TITLE = { name: "title", type: "text" };

describeEachDialect("a field added to a Single that holds its row", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
  });

  afterEach(async () => {
    await current.destroy();
    vi.unstubAllEnvs();
  });

  const exec = <T>(statement: string): Promise<T[]> =>
    (
      current.adapter as unknown as {
        executeQuery<R>(sql: string): Promise<R[]>;
      }
    ).executeQuery<T>(statement);
  const column = async (name: string) =>
    (
      await readTableDefinition(
        statement => exec(statement),
        dialect,
        "single_hero"
      )
    ).columns.find(c => c.name === name);

  async function heroWithItsRow(): Promise<void> {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "hero", label: "Hero", fields: [TITLE] }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    const written = await singles.update(
      "hero",
      { title: "Kept", _overwrite: true },
      { overrideAccess: true }
    );
    expect(written.success, JSON.stringify(written)).toBe(true);
  }

  const save = (fields: unknown[]) =>
    dispatchSingles("updateSingleSchema", { slug: "hero" }, { fields });

  it("fills the row for a required field, which is then NOT NULL with no default", async () => {
    await heroWithItsRow();

    await save([TITLE, { name: "rank", type: "number", required: true }]);

    const rank = await column("rank");
    expect(rank?.nullable).toBe(false);
    expect(rank?.default ?? null).toBeNull();
    // `rank` is reserved on MySQL, so the value is read under an alias of its own.
    const [row] = await exec<{ filled: number | string }>(
      `SELECT ${dialect === "mysql" ? "`rank`" : '"rank"'} AS filled FROM ${dialect === "mysql" ? "`single_hero`" : '"single_hero"'}`
    );
    expect(Number(row?.filled)).toBe(0);
    expect((await column("title"))?.name).toBe("title");
  });

  it("fills the row with the default a required field states as the Builder spells it", async () => {
    await heroWithItsRow();

    await save([
      TITLE,
      { name: "motto", type: "text", required: true, defaultValue: "hello" },
    ]);

    const motto = await column("motto");
    expect(motto?.name).toBe("motto");
    expect(motto?.nullable).toBe(false);
    expect(motto?.default ?? null).toBeNull();
    const [row] = await exec<{ filled: unknown }>(
      `SELECT ${dialect === "mysql" ? "`motto`" : '"motto"'} AS filled FROM ${dialect === "mysql" ? "`single_hero`" : '"single_hero"'}`
    );
    expect(row?.filled).toBe("hello");
  });

  it("fills the row with a stated default holding an apostrophe", async () => {
    await heroWithItsRow();

    await save([
      TITLE,
      {
        name: "motto",
        type: "text",
        required: true,
        defaultValue: "Editor's pick",
      },
    ]);

    const [row] = await exec<{ filled: unknown }>(
      `SELECT ${dialect === "mysql" ? "`motto`" : '"motto"'} AS filled FROM ${dialect === "mysql" ? "`single_hero`" : '"single_hero"'}`
    );
    expect(row?.filled).toBe("Editor's pick");
  });

  it("refuses, before any statement, a required field whose stated default fails its own rules", async () => {
    await heroWithItsRow();

    // The row would hold 0, which every later write of this Single refuses.
    const refused = await save([
      TITLE,
      {
        name: "rank",
        type: "number",
        required: true,
        defaultValue: 0,
        validation: { min: 1 },
      },
    ]).then(
      () => null,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.rank",
            code: "DEFAULT_FAILS_FIELD_RULES",
          }),
        ],
      },
    });
    expect(await column("rank")).toBeUndefined();
  });

  it("gives a field's own default to no column", async () => {
    await heroWithItsRow();

    await save([TITLE, { name: "tagline", type: "text", default: "hello" }]);

    expect((await column("tagline"))?.default ?? null).toBeNull();
  });

  it("gives a new Single's first document the default a field states, with no column default to supply it", async () => {
    await dispatchSingles(
      "createSingle",
      {},
      {
        slug: "hero",
        label: "Hero",
        fields: [TITLE, { name: "tagline", type: "text", default: "hello" }],
      }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");

    const read = await singles.get("hero", { overrideAccess: true });

    expect((read.data as { tagline?: unknown } | undefined)?.tagline).toBe(
      "hello"
    );
    expect((await column("tagline"))?.default ?? null).toBeNull();
  });
});
