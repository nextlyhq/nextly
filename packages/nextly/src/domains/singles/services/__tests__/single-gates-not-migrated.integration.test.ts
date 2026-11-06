/**
 * The checks that stand in front of a Single's version, preview and event
 * routes say the database has not been migrated, on every dialect, rather than
 * failing with an internal error.
 *
 * They read the Single's row themselves (its id, whether a document exists)
 * or ask its read path and judge the answer; until now a missing table or
 * column reached the caller as a 500. Each case boots a Single holding a
 * document, then takes away its table or a declared column, as a skipped
 * `nextly migrate` leaves them. None of these callers is trusted server code,
 * so the answer names the Single and the reason and never the table or field.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { runWithRequestCaller } from "../../../../auth/caller-scope";
import { defineSingle, text } from "../../../../config";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import {
  resolveSingleDocumentId,
  singleDocumentEditable,
  singleDocumentReadable,
  singleStoredDocumentReadable,
} from "../single-document-access";

const BANNER = "sg_banner";
const TABLE = `single_${BANNER}`;
const OWNER = "sg-owner";
/** Past the route's own gate, so each check reaches the read it makes. */
const SUBJECT = {
  user: { id: OWNER, roles: ["super-admin"] },
  routeAuthorized: true,
};

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<void> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: BANNER,
        versions: true,
        fields: [text({ name: "title" }), text({ name: "subtitle" })],
      }),
    ],
  });
  await (
    current.nextly as unknown as {
      updateSingle(args: Record<string, unknown>): Promise<unknown>;
    }
  ).updateSingle({
    slug: BANNER,
    data: { title: "First", subtitle: "One", _overwrite: true },
  });
}

async function execute(dialect: TestDialect, sql: string): Promise<void> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  await (
    current!.adapter as unknown as { executeQuery(s: string): Promise<unknown> }
  ).executeQuery(sql.replace(/\{(\w+)\}/g, (_, name: string) => q(name)));
}

/** The error `work` rejects with, or undefined when it resolves. */
async function refusal(work: () => Promise<unknown>): Promise<unknown> {
  return work().then(
    () => undefined,
    (error: unknown) => error
  );
}

/** The answer a Single's not-migrated check gives a caller not trusted with names. */
function expectNotMigrated(
  error: unknown,
  reason: "table" | "column",
  what: string
): void {
  expect.soft(NextlyError.is(error), `${what} is a NextlyError`).toBe(true);
  expect.soft(error, what).toMatchObject({
    code: "ENTITY_NOT_MIGRATED",
    statusCode: 409,
    publicData: { reason, kind: "single", slug: BANNER },
  });
  const data = (error as { publicData?: object }).publicData;
  expect.soft(data, `${what} withholds the table`).not.toHaveProperty("table");
  expect.soft(data, `${what} withholds the field`).not.toHaveProperty("field");
}

describe.each(getConfiguredTestDialects())(
  "a Single's version, preview and event checks when it is not migrated (%s)",
  dialect => {
    it("answer as before while the Single is migrated", async () => {
      await boot(dialect);
      expect(typeof (await resolveSingleDocumentId(BANNER))).toBe("string");
      expect(await singleDocumentReadable(BANNER, SUBJECT)).toBe(true);
      expect(await singleDocumentEditable(BANNER, SUBJECT)).toBe(true);
      expect(await singleStoredDocumentReadable(BANNER, SUBJECT)).toBe(true);
    }, 120_000);

    it("say the Single's table is missing", async () => {
      await boot(dialect);
      await execute(dialect, `DROP TABLE {${TABLE}}`);

      // Through the route's own handler, which resolves the document id first.
      const listed = await refusal(() =>
        runWithRequestCaller(
          {
            userId: OWNER,
            actor: { type: "user", id: OWNER },
            roles: ["super-admin"],
          },
          () =>
            dispatchSingles(
              "listSingleVersions",
              { slug: BANNER } as never,
              undefined
            )
        )
      );
      expectNotMigrated(listed, "table", "version list");
      expectNotMigrated(
        await refusal(() => resolveSingleDocumentId(BANNER)),
        "table",
        "document id"
      );
      expectNotMigrated(
        await refusal(() => singleDocumentEditable(BANNER, SUBJECT)),
        "table",
        "stored-row update check"
      );
      expectNotMigrated(
        await refusal(() => singleStoredDocumentReadable(BANNER, SUBJECT)),
        "table",
        "stored-row read check"
      );
    }, 120_000);

    it("say a declared field's column is missing", async () => {
      await boot(dialect);
      await execute(dialect, `ALTER TABLE {${TABLE}} DROP COLUMN {subtitle}`);
      // The read the check asks for answers not-migrated; the check keeps it.
      expectNotMigrated(
        await refusal(() => singleDocumentReadable(BANNER, SUBJECT)),
        "column",
        "read check"
      );
    }, 120_000);
  }
);
