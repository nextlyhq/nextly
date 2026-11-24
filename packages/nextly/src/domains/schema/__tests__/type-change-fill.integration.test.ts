/**
 * A field type change that would leave a required field's rows with no value: refused naming how many,
 * unless the save is given a value for them, its fill. A value that cannot convert, a stored empty the
 * new type keeps as none, and a row that held none are each written as the fill, before the column
 * takes its NOT NULL. The migration file carries the fill, so `nextly migrate` writes it into another
 * database's own rows, only under its consent to lose data. Proved on SQLite and PostgreSQL, values
 * read back through the Direct API; on MySQL, where no road rewrites values, the change is refused.
 *
 * What separates the right answer from plausible wrong ones:
 * - a fill written after the column's NOT NULL comes too late for it, and one written only into the
 *   lost values leaves the empty ones to stop it;
 * - a file that carries the rows of the database it was written on, and not the fill, leaves a
 *   deploy's own lost values with nothing;
 * - a fill taken as it comes writes a value the field would refuse from a person.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore, previewMigrate } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  type DataLossConsent,
  NO_CONSENT,
  resolveDataLossConsent,
} from "../migrate/data-loss-consent";
import { rewritesValuesOn } from "../value-conversion/type-change/field-type-changes";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "tcl_posts";
const TABLE = `dc_${SLUG}`;

/** A field of the collection, as a save sends it. */
type Field = { name: string; type: string } & Record<string, unknown>;

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-fill-"));
  // The schema dialog applies its change, and writes its migration, in development only.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  }
});

/** A database whose collection has `fields`, or one `nextly migrate` is yet to bring to the folder. */
async function boot(
  dialect: TestDialect,
  fields?: Field[]
): Promise<TestNextly> {
  instance = await createTestNextly({ dialect, basePath, db: DB });
  if (fields !== undefined) {
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name: SLUG, label: "Post", fields }
    );
  }
  return instance;
}

/** The instance ended, its project folder kept for another database. */
async function end(): Promise<void> {
  await instance?.destroy();
  instance = undefined;
}

async function exec<R>(t: TestNextly, statement: string): Promise<R[]> {
  return (
    t.adapter as unknown as { executeQuery<T>(s: string): Promise<T[]> }
  ).executeQuery<R>(statement);
}

/** The dialog's save of `fields`, answering its refusal where it has one. */
async function save(
  t: TestNextly,
  fields: Field[],
  confirmed?: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Promise<unknown> {
  const [row] = await exec<{ v: number | string | null }>(
    t,
    `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${SLUG}'`
  );
  const outcome = await dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: SLUG },
    {
      fields,
      confirmed: true,
      schemaVersion: Number(row?.v ?? 1),
      ...(confirmed === undefined
        ? {}
        : { confirmedTypeChanges: [{ field: "v", ...confirmed }] }),
      ...extra,
    }
  ).then(
    () => undefined,
    (error: unknown) => error
  );
  clearRegistryRowCache();
  return outcome;
}

/** What the save's preview says of `v`'s change. */
async function reviewed(fields: Field[]): Promise<unknown> {
  const answer = (await dispatchCollections(
    {} as ServiceContainer,
    "previewSchemaChanges",
    { collectionName: SLUG },
    { fields }
  )) as Response | Record<string, unknown>;
  const json = (
    answer instanceof Response ? await answer.json() : answer
  ) as Record<string, unknown>;
  return ((json.data ?? json) as { typeChanges?: unknown[] }).typeChanges?.[0];
}

async function write(
  t: TestNextly,
  title: string,
  data: Record<string, unknown>
): Promise<void> {
  await t.nextly.create({
    collection: SLUG,
    data: { title, ...data },
  } as never);
}

/** `v` of each entry, by title, read through the Direct API. */
async function read(t: TestNextly): Promise<Record<string, unknown>> {
  const found = (await t.nextly.find({
    collection: SLUG,
    limit: 100,
  } as never)) as { items: Array<Record<string, unknown>> };
  return Object.fromEntries(
    found.items.map(item => [String(item.title), item.v ?? null])
  );
}

/** Whether `v` takes a null, as the database defines it. */
async function takesNull(t: TestNextly): Promise<boolean> {
  const postgres =
    (t.adapter as unknown as DrizzleAdapter).getCapabilities().dialect ===
    "postgresql";
  const [row] = await exec<{ n: unknown }>(
    t,
    postgres
      ? `SELECT is_nullable AS n FROM information_schema.columns WHERE table_name = '${TABLE}' AND column_name = 'v'`
      : `SELECT "notnull" AS n FROM pragma_table_info('${TABLE}') WHERE name = 'v'`
  );
  expect(row).toBeDefined();
  return postgres ? row?.n === "YES" : Number(row?.n) === 0;
}

/** The files the folder holds, in the order they run. */
async function files(): Promise<string[]> {
  return (await readdir(join(basePath, "migrations")))
    .filter(file => file.endsWith(".sql"))
    .sort();
}

/** The text of the folder's newest file. */
async function newestFile(): Promise<string> {
  const newest = (await files()).at(-1) ?? "";
  return readFile(join(basePath, "migrations", newest), "utf8");
}

/** `nextly migrate` on `t`'s database over the folder. */
async function migrate(
  t: TestNextly,
  step?: number,
  consent: DataLossConsent = NO_CONSENT
): Promise<void> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  await migrateCore({
    ...(step === undefined ? {} : { step }),
    extensionSchema: undefined,
    dialect: adapter.getCapabilities().dialect,
    db: adapter.getDrizzle(),
    adapter: adapter as never,
    migrationsDir: join(basePath, "migrations"),
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast",
    consent,
    interactive: false,
    throwOnFailure: true,
  } as never);
  clearRegistryRowCache();
}

/** What `nextly migrate --dry-run` prints on `t`'s database over the folder. */
async function dryRun(t: TestNextly): Promise<string> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const printed: string[] = [];
  const capture = new Proxy(
    {},
    {
      get:
        () =>
        (...parts: unknown[]) => {
          printed.push(parts.map(String).join(" "));
        },
    }
  ) as Parameters<typeof previewMigrate>[0]["logger"];
  await previewMigrate({
    adapter: adapter as never,
    db: adapter.getDrizzle(),
    dialect: adapter.getCapabilities().dialect,
    migrationsDir: join(basePath, "migrations"),
    plugins: [],
    logger: capture,
  });
  return printed.join("\n");
}

/** The run's consent to lose any data, and to lose `v`'s. */
const ANY_LOSS = () => resolveDataLossConsent({ flag: true, env: {} });
const LOSS_OF_V = () => resolveDataLossConsent({ flag: `${TABLE}.v`, env: {} });

/** A refusal one of whose issues says `why`. */
function refusedSaying(why: string | RegExp) {
  return {
    code: "VALIDATION_ERROR",
    publicData: {
      errors: expect.arrayContaining([
        expect.objectContaining({
          path: "fields.v",
          message:
            typeof why === "string"
              ? expect.stringContaining(why)
              : expect.stringMatching(why),
        }),
      ]),
    },
  };
}

const text = (more: Record<string, unknown> = {}): Field => ({
  name: "v",
  type: "text",
  ...more,
});
const to = (type: string, more: Record<string, unknown> = {}): Field => ({
  name: "v",
  type,
  required: true,
  ...more,
});

describe.each(getConfiguredTestDialects())(
  "a type change of a required field writes a chosen fill into the rows it would leave with none (%s)",
  dialect => {
    const fills = it.skipIf(!rewritesValuesOn(dialect));

    fills(
      "writes the fill into a value that cannot convert, converts the rest, and keeps the column required",
      async () => {
        const t = await boot(dialect, [text({ required: true })]);
        await write(t, "kept", { v: "12" });
        await write(t, "lost", { v: "abc" });

        expect(
          await save(t, [to("number")], {
            kept: 0,
            changed: 1,
            lost: 1,
            fill: 0,
          })
        ).toBeUndefined();

        expect(await read(t)).toEqual({ kept: 12, lost: 0 });
        expect(await takesNull(t)).toBe(false);
      }
    );

    // An empty list becomes no text, and a row that held none holds none after: neither is lost, and
    // each would meet the column's NOT NULL.
    fills(
      "writes the fill into a stored empty list and into a row that held none, as an optional list becomes a required text",
      async () => {
        const t = await boot(dialect, [{ name: "v", type: "chips" }]);
        await write(t, "one", { v: ["x"] });
        await write(t, "empty", { v: [] });
        await write(t, "none", {});
        // The fixture's control: one row stores an empty list and one nothing.
        const stored = await exec<{ title: string; v: unknown }>(
          t,
          `SELECT title, v FROM ${TABLE}`
        );
        expect(stored.filter(row => row.v === null).map(r => r.title)).toEqual([
          "none",
        ]);

        expect(await save(t, [to("text")])).toMatchObject(
          refusedSaying("2 rows would be left with no value")
        );
        expect(await read(t)).toEqual({ one: ["x"], empty: [], none: null });

        expect(
          await save(t, [to("text")], {
            kept: 2,
            changed: 1,
            lost: 0,
            fill: "none",
          })
        ).toBeUndefined();

        expect(await read(t)).toEqual({
          one: "x",
          empty: "none",
          none: "none",
        });
        expect(await takesNull(t)).toBe(false);
      }
    );

    // Nothing is made required here, so the empty list and the null are kept as no value, with no
    // consent.
    fills(
      "keeps a stored empty list and a row that held none as no value of an optional text",
      async () => {
        const t = await boot(dialect, [{ name: "v", type: "chips" }]);
        await write(t, "empty", { v: [] });
        await write(t, "none", {});

        expect(await save(t, [text()])).toBeUndefined();

        expect(await read(t)).toEqual({ empty: null, none: null });
      }
    );

    // The review says how many rows are in the way, so whoever saves knows a fill is needed.
    fills(
      "reviews how many rows a required field's change would leave with no value",
      async () => {
        const t = await boot(dialect, [{ name: "v", type: "chips" }]);
        await write(t, "one", { v: ["x"] });
        await write(t, "empty", { v: [] });
        await write(t, "none", {});

        expect(await reviewed([to("text")])).toMatchObject({
          field: "v",
          kept: 2,
          changed: 1,
          lost: 0,
          leavesEmpty: 2,
        });
        expect(await reviewed([text()])).not.toHaveProperty("leavesEmpty");
      }
    );

    fills.each([
      { type: "number", fill: 0, reads: 0 },
      { type: "number", fill: 1.5, reads: 1.5, options: { format: "float" } },
      { type: "checkbox", fill: false, reads: false },
      { type: "checkbox", fill: true, reads: true },
      {
        type: "date",
        fill: "2024-01-02T03:04:05Z",
        reads: "2024-01-02T03:04:05.000Z",
      },
      { type: "email", fill: "a@b.co", reads: "a@b.co" },
      {
        type: "select",
        fill: "low",
        reads: "low",
        options: [
          { label: "Low", value: "low" },
          { label: "High", value: "high" },
        ],
      },
    ])(
      "writes a fill of the new type ($type, $fill)",
      async ({ type, fill, reads, options }) => {
        const t = await boot(dialect, [text({ required: true })]);
        await write(t, "lost", { v: "nothing of it" });

        expect(
          await save(t, [to(type, options === undefined ? {} : { options })], {
            kept: 0,
            changed: 0,
            lost: 1,
            fill,
          })
        ).toBeUndefined();

        const value = (await read(t)).lost;
        expect(value instanceof Date ? value.toISOString() : value).toEqual(
          reads
        );
      }
    );

    // A JSON becoming a list, and a list of another kind: a fill of several items is one value.
    fills("writes a list as a fill", async () => {
      const t = await boot(dialect, [
        { name: "v", type: "json", required: true },
      ]);
      await write(t, "lost", { v: { a: 1 } });

      expect(
        await save(t, [to("chips")], {
          kept: 0,
          changed: 0,
          lost: 1,
          fill: ["a", "b"],
        })
      ).toBeUndefined();

      expect(await read(t)).toEqual({ lost: ["a", "b"] });
    });

    // A fill is a value a person would be allowed to write: of the new type as it stands, and one the
    // field's own rules accept. Refused before anything is written.
    fills.each([
      { why: "another kind", type: "number", fill: "x" },
      {
        why: "a writing of the type, not a value of it",
        type: "number",
        fill: "12",
      },
      { why: "no value", type: "number", fill: null },
      { why: "outside the column", type: "number", fill: 1e30 },
      { why: "no address", type: "email", fill: "not an address" },
      {
        why: "a rule of the field's own",
        type: "number",
        fill: 20,
        field: { validation: { max: 10 } },
      },
      { why: "an empty text", type: "email", fill: "" },
      { why: "a date with no offset", type: "date", fill: "2024-01-02" },
      {
        why: "no option of it",
        type: "select",
        fill: "none",
        options: [{ label: "Low", value: "low" }],
      },
    ])(
      "refuses a fill the field does not take ($why), and changes nothing",
      async ({ type, fill, options, field = {} }) => {
        const t = await boot(dialect, [text({ required: true })]);
        await write(t, "lost", { v: "nothing of it" });
        const written = await files();
        const next = options === undefined ? field : { options };

        expect(
          await save(t, [to(type, next)], {
            kept: 0,
            changed: 0,
            lost: 1,
            fill,
          })
        ).toMatchObject(refusedSaying("fill value"));

        expect(await read(t)).toEqual({ lost: "nothing of it" });
        expect(await files()).toEqual(written);
      }
    );

    // PostgreSQL reads a JSON column's string back as JSON where it is JSON by itself, so such a fill
    // would read back as something else, as such a text would.
    fills(
      "refuses a JSON fill that is a text reading back as something else, where it would",
      async () => {
        const t = await boot(dialect, [text()]);
        await write(t, "none", {});

        const outcome = await save(t, [to("json")], {
          kept: 1,
          changed: 0,
          lost: 0,
          fill: "12",
        });

        if (dialect === "postgresql") {
          expect(outcome).toMatchObject(refusedSaying("fill value"));
        } else {
          expect(outcome).toBeUndefined();
          expect(await read(t)).toEqual({ none: "12" });
        }
      }
    );

    fills(
      "refuses a fill for an optional field, whose values that cannot convert are cleared",
      async () => {
        const t = await boot(dialect, [text()]);
        await write(t, "lost", { v: "abc" });

        expect(
          await save(t, [{ name: "v", type: "number" }], {
            kept: 0,
            changed: 0,
            lost: 1,
            fill: 0,
          })
        ).toMatchObject(refusedSaying("for a required field"));

        expect(await read(t)).toEqual({ lost: "abc" });
      }
    );

    fills(
      "refuses a change that loses a required field's values when no fill is chosen, naming how many, and changes nothing",
      async () => {
        const t = await boot(dialect, [text({ required: true })]);
        await write(t, "kept", { v: "12" });
        await write(t, "lost", { v: "abc" });

        for (const confirmed of [undefined, { kept: 0, changed: 1, lost: 1 }]) {
          expect(await save(t, [to("number")], confirmed)).toMatchObject(
            refusedSaying(/1 row would be left with no value.*fill value/)
          );
        }

        expect(await read(t)).toEqual({ kept: "12", lost: "abc" });
      }
    );

    // The fill covers what the person was shown: another value lost since is another count.
    fills(
      "refuses a fill whose counts no longer hold, with the new ones, and changes nothing",
      async () => {
        const t = await boot(dialect, [text({ required: true })]);
        await write(t, "lost", { v: "abc" });
        await write(t, "since", { v: "def" });

        expect(
          await save(t, [to("number")], {
            kept: 0,
            changed: 0,
            lost: 1,
            fill: 0,
          })
        ).toMatchObject({
          publicData: {
            reviewAgain: true,
            counts: { typeChanges: [expect.objectContaining({ lost: 2 })] },
          },
        });

        expect(await read(t)).toEqual({ lost: "abc", since: "def" });
      }
    );

    // A unique field holds each value once: the fill of two rows is a repeat, as two values that read
    // as one are.
    fills(
      "refuses a fill a unique field would hold twice, and writes it where it holds it once",
      async () => {
        const t = await boot(dialect, [text({ required: true, unique: true })]);
        await write(t, "a", { v: "abc" });
        await write(t, "b", { v: "def" });
        const unique = to("number", { unique: true });

        expect(
          await save(t, [unique], { kept: 0, changed: 0, lost: 2, fill: 0 })
        ).toMatchObject(refusedSaying("which a unique field holds once"));
        expect(await read(t)).toEqual({ a: "abc", b: "def" });

        await exec(t, `DELETE FROM ${TABLE} WHERE title = 'b'`);
        expect(
          await save(t, [unique], { kept: 0, changed: 0, lost: 1, fill: 0 })
        ).toBeUndefined();
        expect(await read(t)).toEqual({ a: 0 });
      }
    );

    /** A save of `fields` with a fill on a first database, its folder kept for another. */
    async function savedWithFill(
      fields: Field[],
      value: Record<string, unknown>,
      next: Field,
      confirmed: Record<string, unknown>
    ): Promise<number> {
      const first = await boot(dialect, fields);
      const created = (await files()).length;
      await write(first, "here", value);
      expect(await save(first, [next], confirmed)).toBeUndefined();
      await end();
      return created;
    }

    fills(
      "carries the fill in the file's mark, and names it among what the file deletes",
      async () => {
        await savedWithFill(
          [text({ required: true })],
          { v: "abc" },
          to("number"),
          {
            kept: 0,
            changed: 0,
            lost: 1,
            fill: 0,
          }
        );

        const file = await newestFile();
        expect(file).toMatch(
          new RegExp(`^-- Converts values: rules 1; ${TABLE}\\.v fill 0$`, "m")
        );
        expect(file).toMatch(
          new RegExp(`^-- Deletes: column ${TABLE}\\.v.*replaced with 0$`, "m")
        );
        expect(file).toMatch(
          new RegExp(`^-- Destructive: .*--accept-data-loss=${TABLE}\\.v`, "m")
        );
      }
    );

    fills(
      "writes the fill into a deploy's own lost value under its consent alone, naming it in a dry run",
      async () => {
        const created = await savedWithFill(
          [text({ required: true })],
          { v: "abc" },
          to("number"),
          { kept: 0, changed: 0, lost: 1, fill: 0 }
        );
        const second = await boot(dialect);
        await migrate(second, created);
        await write(second, "whole", { v: "34" });
        await write(second, "word", { v: "zzz" });

        const said = await dryRun(second);
        expect(said).toMatch(
          /converts dc_tcl_posts\.v .*1 that cannot convert; 1 row left with no value, replaced with 0/
        );
        await expect(
          migrate(
            second,
            undefined,
            resolveDataLossConsent({ flag: "dc_other.v", env: {} })
          )
        ).rejects.toThrow();
        expect(await read(second)).toEqual({ whole: "34", word: "zzz" });

        await migrate(second, undefined, LOSS_OF_V());
        expect(await read(second)).toEqual({ whole: 34, word: 0 });
        expect(await takesNull(second)).toBe(false);
      }
    );

    // A deploy that loses nothing still takes the fill only under consent: it writes a value nobody
    // put there.
    fills(
      "writes the fill into a deploy's own empty rows, before the file makes the column required, under its consent alone",
      async () => {
        const created = await savedWithFill(
          [{ name: "v", type: "chips" }],
          { v: [] },
          to("text"),
          { kept: 1, changed: 0, lost: 0, fill: 'a, b\'s "c"' }
        );
        const second = await boot(dialect);
        await migrate(second, created);
        await write(second, "one", { v: ["x"] });
        await write(second, "empty", { v: [] });
        await write(second, "none", {});

        // The rows the file would make required over are the ones it fills: a dry run says so, and not
        // that a real run would refuse them.
        const said = await dryRun(second);
        expect(said).toContain(
          '2 rows left with no value, replaced with "a, b\'s \\"c\\""'
        );
        expect(said).not.toContain("cannot become required");

        const refusal = await migrate(
          second,
          undefined,
          resolveDataLossConsent({ flag: "dc_other.v", env: {} })
        ).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(refusal).toBeDefined();
        expect(await read(second)).toEqual({
          one: ["x"],
          empty: [],
          none: null,
        });

        await migrate(second, undefined, ANY_LOSS());
        expect(await read(second)).toEqual({
          one: "x",
          empty: 'a, b\'s "c"',
          none: 'a, b\'s "c"',
        });
        expect(await takesNull(second)).toBe(false);
      }
    );

    // A file that carries no fill has none to write: a deploy's own lost value of a required field
    // refuses it, whatever the consent, and nothing changes.
    fills(
      "refuses a deploy's own lost value of a required field where the file carries no fill",
      async () => {
        const created = await savedWithFill(
          [text({ required: true })],
          { v: "12" },
          to("number"),
          { kept: 0, changed: 1, lost: 0 }
        );
        const second = await boot(dialect);
        await migrate(second, created);
        await write(second, "word", { v: "zzz" });

        await expect(
          migrate(second, undefined, ANY_LOSS())
        ).rejects.toMatchObject(
          refusedSaying("1 row would be left with no value")
        );
        expect(await read(second)).toEqual({ word: "zzz" });
      }
    );

    // Where no road rewrites values, none is written as a fill either: the change is the cast's.
    it.runIf(!rewritesValuesOn(dialect))(
      "refuses a lost value of a required field, a fill given or not, where no road rewrites values",
      async () => {
        const t = await boot(dialect, [text({ required: true })]);
        await write(t, "lost", { v: "abc" });

        for (const fill of [{}, { fill: 0 }]) {
          expect(
            await save(t, [to("number")], {
              kept: 0,
              changed: 0,
              lost: 1,
              ...fill,
            })
          ).toMatchObject(refusedSaying("can't be deployed yet"));
        }

        expect(await read(t)).toEqual({ lost: "abc" });
      }
    );
  }
);
