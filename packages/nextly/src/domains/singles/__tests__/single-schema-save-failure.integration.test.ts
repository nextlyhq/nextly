/**
 * A Single's schema save (`updateSingleSchema`) that fails answers that it failed, with the reason,
 * and records nothing of the shape it asked for: the registry row keeps the fields and the status it
 * had. It used to record the requested fields with the status "failed" and answer that the
 * migration was pending, which neither was.
 *
 * - Where nothing landed, it fails with nothing kept.
 * - Where the change landed but its migration could not be recorded applied, it fails naming the
 *   kept file and the steps that finish it: `nextly migrate:resolve --applied`, then
 *   `nextly migrate`, which brings the registry in step with the recorded file.
 *
 * The change adds a required field stating a default to a Single holding its row, which fills that
 * row and so carries values: the save runs the service's own statements rather than its migration
 * file. Outside development the save writes its files, then runs those statements
 * (`appliedAfter`). The statement adding the column fails, so nothing has committed on any
 * dialect. (In development the same failure is already thrown, with the files withdrawn.)
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "ssf_home";
const TABLE = `single_${SLUG}`;

describeEachDialect("a Single schema save whose statements fail", dialect => {
  let t: TestNextly;
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "nextly-single-save-failure-"));
    vi.stubEnv("NODE_ENV", "development");
    t = await createTestNextly({
      dialect: dialect as TestDialect,
      basePath,
      db: DB,
    });
    await dispatchSingles(
      "createSingle",
      {},
      {
        slug: SLUG,
        label: "Home",
        // `score` holds no value, so a change of its type loses none.
        fields: [
          { name: "count", type: "text" },
          { name: "score", type: "text" },
        ],
      }
    );
    // The row the Single holds, which a required field added to it fills.
    await t.nextly.updateSingle({
      slug: SLUG,
      data: { count: "one", _overwrite: true },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await t?.destroy();
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  });

  /** The migration files in the project's folder, sorted. */
  async function migrationFiles(): Promise<string[]> {
    try {
      return (await readdir(join(basePath, "migrations")))
        .filter(name => name.endsWith(".sql"))
        .sort();
    } catch {
      return [];
    }
  }

  /** The save of `fields`, as what it threw or what it answered. */
  async function attempt(
    fields: unknown[]
  ): Promise<{ thrown?: unknown; said: string }> {
    try {
      const answer = await dispatchSingles(
        "updateSingleSchema",
        { slug: SLUG },
        { fields }
      );
      return {
        said:
          answer instanceof Response
            ? JSON.stringify(await answer.json())
            : JSON.stringify(answer),
      };
    } catch (error) {
      return { thrown: error, said: "" };
    }
  }

  /** The registry row's fields and status, as stored. */
  async function recorded() {
    clearRegistryRowCache();
    const [row] = await t.adapter.select<Record<string, unknown>>(
      "dynamic_singles",
      {
        columns: ["fields", "migrationStatus"],
        where: { and: [{ column: "slug", op: "=", value: SLUG }] },
      }
    );
    const fields =
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields;
    return { fields, migrationStatus: row?.migrationStatus };
  }

  /**
   * Fail the first statement adding the new field's column to the Single's table, on the adapter
   * or on a transaction, before it runs. Returns how many it failed.
   */
  function failTableStatement(): () => number {
    let failed = 0;
    const pattern = new RegExp(`ALTER\\s+TABLE[^;]*${TABLE}[^;]*tagline`, "i");
    const refuse = (statement: string) => {
      if (failed > 0 || !pattern.test(statement)) return;
      failed += 1;
      throw new Error(`injected failure: ${statement}`);
    };
    const adapter = t.adapter;
    const executeQuery = adapter.executeQuery.bind(adapter);
    vi.spyOn(adapter, "executeQuery").mockImplementation(
      async (...args: Parameters<typeof executeQuery>) => {
        refuse(args[0]);
        return executeQuery(...args);
      }
    );
    const transaction = adapter.transaction.bind(adapter);
    vi.spyOn(adapter, "transaction").mockImplementation((work, options) =>
      transaction(
        tx =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key === "execute") {
                  return async (...args: Parameters<typeof target.execute>) => {
                    refuse(args[0]);
                    return target.execute(...args);
                  };
                }
                const value: unknown = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            })
          ),
        options
      )
    );
    return () => failed;
  }

  it("answers that it failed, with the reason, and records nothing of the shape it asked for", async () => {
    const before = await recorded();
    const folderBefore = await migrationFiles();
    const failed = failTableStatement();
    // Outside development: the save writes its files, then runs its own statements.
    vi.stubEnv("NODE_ENV", "test");

    let answer: unknown;
    let thrown: unknown;
    try {
      answer = await dispatchSingles(
        "updateSingleSchema",
        { slug: SLUG },
        {
          fields: [
            { name: "count", type: "text" },
            { name: "score", type: "text" },
            {
              name: "tagline",
              type: "text",
              required: true,
              defaultValue: "Draft",
            },
          ],
        }
      );
    } catch (error) {
      thrown = error;
    }
    vi.restoreAllMocks();

    const said =
      answer instanceof Response
        ? JSON.stringify(await answer.json())
        : JSON.stringify(answer);
    // Positive control: the save reached its table statement.
    expect(
      failed(),
      `no statement changing the Single's table was met; the save answered ${said}, threw ${String(thrown)}`
    ).toBe(1);
    expect(
      thrown,
      `the save answered instead of failing: ${said}`
    ).toBeDefined();
    // Nothing landed, so nothing is kept and there is nothing to finish. The driver's text, which
    // can hold identifiers and values, is not told.
    expect(String((thrown as Error).message)).toBe(
      "The database refused this schema change, so nothing was changed."
    );
    expect(await migrationFiles(), "the migrations folder").toEqual(
      folderBefore
    );
    expect(await recorded(), "the registry row").toEqual(before);
  });

  // A migration that fails past its main change keeps the row it wrote, so a retry has one
  // describing the table, and is answered as a failure with its reason and what to do, never as
  // pending. The Single's last migration recorded as failed is such a failure: a change to some
  // of its fields does not clear it.
  it("answers a migration that failed past its change as failed, naming its reason and the kept file", async () => {
    await t.adapter.update(
      "dynamic_singles",
      { migrationStatus: "failed" },
      { and: [{ column: "slug", op: "=", value: SLUG }] }
    );
    clearRegistryRowCache();
    const folderBefore = await migrationFiles();

    const { thrown, said } = await attempt([
      { name: "count", type: "text" },
      { name: "score", type: "text" },
      { name: "tagline", type: "text", required: true, defaultValue: "Draft" },
    ]);

    expect(
      thrown,
      `the save answered instead of failing: ${said}`
    ).toBeDefined();
    const kept = (await migrationFiles()).filter(
      name => !folderBefore.includes(name)
    );
    expect(kept, "the change's one file is kept").toHaveLength(1);
    const [file] = kept;
    expect(String((thrown as Error).message)).toBe(
      `Single "${SLUG}" was saved, but its migration failed: an earlier change to it did not finish, and a change to some of its fields does not clear that. ` +
        `Its migration file ${file} was kept and not recorded applied. ` +
        `Finish the change by hand, run \`nextly migrate:resolve --applied ${file}\`; then run \`nextly migrate\`, which brings the registry in step with the recorded file. ` +
        "Or reverse what of it ran and run `nextly migrate`, which runs it from the start."
    );
    expect((await recorded()).migrationStatus, "the row's status").toBe(
      "failed"
    );
  });

  // On SQLite the service's statements leave a field's type as it was, so the change lands without
  // its file's shape and the writer will not record the file applied. PostgreSQL and MySQL change
  // the type, so the case does not arise there.
  it.skipIf(dialect !== "sqlite")(
    "answers that it failed, naming the kept file and the steps that finish it, when the change landed but could not be recorded applied",
    async () => {
      const before = await recorded();
      const folderBefore = await migrationFiles();

      const { thrown, said } = await attempt([
        { name: "count", type: "text" },
        { name: "score", type: "number" },
      ]);

      expect(
        thrown,
        `the save answered instead of failing: ${said}`
      ).toBeDefined();
      const kept = (await migrationFiles()).filter(
        name => !folderBefore.includes(name)
      );
      expect(kept, "the change's one file is kept").toHaveLength(1);
      const [file] = kept;
      expect(String((thrown as Error).message)).toBe(
        `The database does not stand as ${file} says after the save's change was applied, so the save's file ${file} was kept and not recorded applied. Compare the table with ${file}. ` +
          `Finish the change by hand, run \`nextly migrate:resolve --applied ${file}\`; then run \`nextly migrate\`, which brings the registry in step with the recorded file. ` +
          "Or reverse what of it ran and run `nextly migrate`, which runs it from the start."
      );
      expect(await recorded(), "the registry row").toEqual(before);
    }
  );
});
