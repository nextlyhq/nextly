/**
 * The checks a release and the version routes run before a write say the
 * database has not been migrated, on every dialect, rather than failing with
 * an internal error.
 *
 * The update check (`canUpdateEntry`, root-exported, in front of version
 * writes and preview links) and the release readiness reads load the stored
 * rows themselves, outside the entry read that already answers this. Each
 * case boots a collection and a Single with a lifecycle, each holding a
 * document, then takes away a declared column or the table, as a skipped
 * `nextly migrate` leaves them, or takes the collection out of the running
 * instance's registry. None of these callers is trusted server code, so the
 * answer names the entity and the reason, never the table or field.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import type { SchemaRegistry } from "../../../database/schema-registry";
import { releaseDocumentChecks } from "../../../di/registrations/release-document-checks";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { releaseLinkReads } from "../release-links";

const POSTS = "rc_posts";
const POSTS_TABLE = `dc_${POSTS}`;
const BANNER = "rc_banner";
const BANNER_TABLE = `single_${BANNER}`;
const USER = { id: "rc-owner", roles: ["super-admin"] };

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function t(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

async function boot(dialect: TestDialect): Promise<string> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        fields: [text({ name: "title" }), text({ name: "subtitle" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        status: true,
        fields: [text({ name: "title" }), text({ name: "subtitle" })],
      }),
    ],
  });
  const api = current.nextly as unknown as {
    create(args: Record<string, unknown>): Promise<{ item: { id: string } }>;
    updateSingle(args: Record<string, unknown>): Promise<unknown>;
  };
  await api.updateSingle({
    slug: BANNER,
    data: { title: "First", subtitle: "One", _overwrite: true },
  });
  const created = await api.create({
    collection: POSTS,
    data: { title: "First", subtitle: "One" },
  });
  return created.item.id;
}

async function execute(dialect: TestDialect, sql: string): Promise<void> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  await (
    t().adapter as unknown as { executeQuery(s: string): Promise<unknown> }
  ).executeQuery(sql.replace(/\{(\w+)\}/g, (_, name: string) => q(name)));
}

async function refusal(work: () => Promise<unknown>): Promise<unknown> {
  return work().then(
    () => undefined,
    (error: unknown) => error
  );
}

function expectNotMigrated(
  error: unknown,
  expected: { reason: string; kind: string; slug: string },
  what: string
): void {
  expect.soft(NextlyError.is(error), `${what} is a NextlyError`).toBe(true);
  expect.soft(error, what).toMatchObject({
    code: "ENTITY_NOT_MIGRATED",
    statusCode: 409,
    publicData: expected,
  });
  const data = (error as { publicData?: object }).publicData;
  expect.soft(data, `${what} withholds the table`).not.toHaveProperty("table");
  expect.soft(data, `${what} withholds the field`).not.toHaveProperty("field");
}

/** The checks each road reaches, as their callers hold them. */
function roads(id: string) {
  const checks = releaseDocumentChecks(
    t().adapter as never,
    t().getService("logger" as never)
  );
  const handler = t().getService("collectionsHandler") as unknown as {
    canUpdateEntry(p: Record<string, unknown>): Promise<boolean>;
    releaseGoingLiveDocuments(
      p: Record<string, unknown>
    ): Promise<Map<string, unknown>>;
  };
  const singles = t().getService("singleEntryService") as unknown as {
    releaseGoingLiveDocument(p: Record<string, unknown>): Promise<unknown>;
  };
  const posts = { scopeKind: "collection", scopeSlug: POSTS } as never;
  const banner = { scopeKind: "single", scopeSlug: BANNER } as never;
  return {
    collection: [
      [
        "update check",
        () =>
          handler.canUpdateEntry({
            collectionName: POSTS,
            entryId: id,
            user: USER,
            routeAuthorized: true,
          }),
      ],
      [
        "release publish check",
        () => checks.publishProblems(posts, [id], USER as never, "publish"),
      ],
      [
        "release going-live read",
        () =>
          handler.releaseGoingLiveDocuments({
            collectionName: POSTS,
            entryIds: [id],
          }),
      ],
    ] as Array<[string, () => Promise<unknown>]>,
    single: [
      [
        "release publish check",
        () => checks.publishProblems(banner, [id], USER as never, "publish"),
      ],
      ["release held-drafts read", () => checks.heldDraftLocales(banner, [id])],
      [
        "release going-live read",
        () => singles.releaseGoingLiveDocument({ slug: BANNER }),
      ],
    ] as Array<[string, () => Promise<unknown>]>,
  };
}

describe.each(getConfiguredTestDialects())(
  "the update and release checks when the database is not migrated (%s)",
  dialect => {
    it("answer as before while it is migrated", async () => {
      const id = await boot(dialect);
      const { collection, single } = roads(id);
      for (const [name, run] of [...collection, ...single]) {
        expect(await refusal(run), name).toBeUndefined();
      }
    }, 120_000);

    it.each([
      ["a declared field's column", "column"],
      ["the entity's table", "table"],
    ] as const)(
      "say so when %s is missing",
      async (_what, reason) => {
        const id = await boot(dialect);
        for (const table of [POSTS_TABLE, BANNER_TABLE]) {
          await execute(
            dialect,
            reason === "column"
              ? `ALTER TABLE {${table}} DROP COLUMN {subtitle}`
              : `DROP TABLE {${table}}`
          );
        }
        const { collection, single } = roads(id);
        for (const [name, run] of collection) {
          expectNotMigrated(
            await refusal(run),
            { reason, kind: "collection", slug: POSTS },
            `collection ${name}`
          );
        }
        for (const [name, run] of single) {
          expectNotMigrated(
            await refusal(run),
            { reason, kind: "single", slug: BANNER },
            `Single ${name}`
          );
        }
      },
      120_000
    );

    it("says so when the link check reads a collection this instance has not registered", async () => {
      const id = await boot(dialect);
      (
        t().getService("schemaRegistry" as never) as SchemaRegistry
      ).retractDynamicSchema(POSTS_TABLE);
      expectNotMigrated(
        await refusal(() =>
          releaseLinkReads(t().adapter as never).publishedOf(POSTS, [id])
        ),
        { reason: "unregistered", kind: "collection", slug: POSTS },
        "published-state read"
      );
    }, 120_000);
  }
);
