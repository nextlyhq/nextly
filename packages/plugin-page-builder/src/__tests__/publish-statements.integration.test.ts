/**
 * What publishing one text change of a page costs the database: the
 * statements a publish sends, with the components the page places read once
 * per kind rather than once per use.
 *
 * Each fixture is a page placing published components around a heading; the
 * publish changes the heading's text, once through the Direct API and twice
 * through the REST route the admin saves by (the first pays for whatever the
 * setup left for a jobs pass). Each statement is logged at the driver
 * (`statement-log`). A measuring run sets `PUBLISH_STATEMENTS_OUT` to a folder
 * the statements of each dialect and fixture are written to.
 *
 * @module __tests__/publish-statements.integration.test
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pageBuilder } from "../plugin";

import { startupSettled } from "./entry-page-claims-harness";
import { openStatementLog } from "./statement-log";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

const placing = (id: string, componentId: string) => ({
  id,
  type: "nextly/component-instance",
  version: 1,
  props: { componentId },
});

const idOf = (created: unknown): string =>
  String((created as { item: { id: string | number } }).item.id);

/** The table each statement names first, for a count by table. */
function tableOf(statement: string): string {
  const named = /(?:from|into|update|join)\s+["`]?([\w.]+)["`]?/i.exec(
    statement
  );
  return named?.[1] ?? statement.slice(0, 30);
}

/** A page's components: how many distinct ones, each placed how often. */
interface Fixture {
  readonly distinct: number;
  readonly uses: (at: number) => number;
}

const FIXTURES: Record<string, Fixture> = {
  "two components placed 20 and 10 times": {
    distinct: 2,
    uses: at => (at === 0 ? 20 : 10),
  },
  "ten components placed 3 times each": { distinct: 10, uses: () => 3 },
};

describe.each(getConfiguredTestDialects())(
  "publishing one text change of a page (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      vi.unstubAllEnvs();
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      await startupSettled(current);
      return current;
    }

    async function component(t: TestNextly, slug: string): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: "components",
          data: {
            title: slug,
            slug,
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [heading(`${slug}-h`, slug)],
            },
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    function pageDocument(text: string, placed: readonly string[][]) {
      return {
        formatVersion: 1,
        kind: "page",
        nodes: [
          heading("title", text),
          ...placed.flatMap((ids, at) =>
            ids.map((id, use) => placing(`c${at}-${use}`, id))
          ),
        ],
      };
    }

    /** The owner's session cookie, as a signed-in browser sends it. */
    async function ownerCookie(t: TestNextly): Promise<string> {
      const owner = await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const token = await signAccessToken(
        buildClaims({
          userId: owner.item.id,
          email: "owner@example.com",
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}; nextly_csrf=${CSRF}`;
    }

    async function send(
      cookie: string,
      method: "GET" | "PATCH",
      params: string[],
      body?: unknown
    ): Promise<{ status: number; json: Record<string, unknown> }> {
      const handlers = createDynamicHandlers();
      const response = await handlers[method](
        new Request(`${ORIGIN}/api/${params.join("/")}`, {
          method,
          headers: {
            cookie,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ params }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        json: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    it.each(Object.entries(FIXTURES))(
      "measures %s",
      async (name, fixture) => {
        const t = await boot();
        const placed: string[][] = [];
        for (let at = 0; at < fixture.distinct; at += 1) {
          const id = await component(t, `part-${at}`);
          placed.push(Array.from({ length: fixture.uses(at) }, () => id));
        }
        const pageId = idOf(
          await t.nextly.create({
            collection: "pages",
            data: {
              title: "Long page",
              slug: "long-page",
              content: pageDocument("Before", placed),
              status: "published",
            },
            overrideAccess: true,
          })
        );
        const cookie = await ownerCookie(t);
        await t.events.settle();
        const results: Record<string, unknown> = {};
        for (const route of ["direct", "rest", "rest"] as const) {
          const text = `After ${route} ${Object.keys(results).length}`;
          const read =
            route === "rest"
              ? await send(cookie, "GET", [
                  "collections",
                  "pages",
                  "entries",
                  pageId,
                ])
              : undefined;
          const log = await openStatementLog(t.adapter, dialect);
          let from = 0;
          let status = 0;
          let said: unknown;
          try {
            await log.quiet();
            from = log.statements.length;
            if (route === "direct") {
              await t.nextly.update({
                collection: "pages",
                id: pageId,
                data: {
                  content: pageDocument(text, placed),
                  status: "published",
                  _overwrite: true,
                },
                overrideAccess: true,
              });
              status = 200;
            } else {
              const entry = (read?.json.item ?? read?.json) as Record<
                string,
                unknown
              >;
              const answer = await send(
                cookie,
                "PATCH",
                ["collections", "pages", "entries", pageId],
                {
                  title: entry.title,
                  slug: entry.slug,
                  content: pageDocument(text, placed),
                  status: "published",
                  _rev: entry._rev,
                }
              );
              status = answer.status;
              said = answer.status === 200 ? undefined : answer.json;
            }
            await t.events.settle();
            await log.quiet();
          } finally {
            log.close();
          }
          const statements = log.statements.slice(from);
          const byTable: Record<string, number> = {};
          for (const sql of statements) {
            const table = tableOf(sql);
            byTable[table] = (byTable[table] ?? 0) + 1;
          }
          results[`${route}${Object.keys(results).length}`] = {
            status,
            said,
            total: statements.length,
            byTable,
            statements,
          };
        }
        // A measuring run names a folder to keep each dialect's statements in.
        const out = process.env.PUBLISH_STATEMENTS_OUT;
        if (out !== undefined && out !== "") {
          writeFileSync(
            join(out, `publish-${dialect}-${String(fixture.distinct)}.json`),
            JSON.stringify({ name, ...results }, null, 1)
          );
        }
        for (const run of Object.values(results)) {
          expect((run as { status: number }).status).toBe(200);
        }
      },
      120_000
    );
  }
);
