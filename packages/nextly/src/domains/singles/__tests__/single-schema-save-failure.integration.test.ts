/**
 * A Single's schema save (`updateSingleSchema`) whose table statements fail answers that it failed,
 * with the reason, and records nothing of the shape it asked for: the registry row keeps the fields
 * and the status it had. It used to record the requested fields with the status "failed" and answer
 * that the migration was pending, which neither was.
 *
 * The change adds a required field stating a default to a Single holding its row, which fills that
 * row and so carries values: the save runs the service's own statements rather than its migration
 * file. The statement adding the column fails, so nothing has committed on any dialect.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle";
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
      { slug: SLUG, label: "Home", fields: [{ name: "count", type: "text" }] }
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
      async (statement, params) => {
        refuse(statement);
        return executeQuery(statement, params);
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
                  return async (
                    statement: string,
                    params?: Parameters<TransactionContext["execute"]>[1]
                  ) => {
                    refuse(statement);
                    return target.execute(statement, params);
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
    const failed = failTableStatement();

    let answer: unknown;
    let thrown: unknown;
    try {
      answer = await dispatchSingles(
        "updateSingleSchema",
        { slug: SLUG },
        {
          fields: [
            { name: "count", type: "text" },
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
    expect(
      String((thrown as Error).message),
      "the failure says why"
    ).not.toMatch(/pending/i);
    expect(await recorded(), "the registry row").toEqual(before);
  });
});
