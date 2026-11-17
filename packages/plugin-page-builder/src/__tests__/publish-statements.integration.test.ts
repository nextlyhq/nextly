/**
 * What publishing one text change of a page costs the database: the
 * statements a publish sends, with the components the page places read once
 * per kind rather than once per use.
 *
 * The fixture is a page placing two published components, one twenty times
 * and one ten, around a heading; the publish changes the heading's text. Each
 * statement is logged at the driver (`statement-log`).
 *
 * @module __tests__/publish-statements.integration.test
 */
import { writeFileSync } from "node:fs";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pageBuilder } from "../plugin";

import { startupSettled } from "./entry-page-claims-harness";
import { openStatementLog } from "./statement-log";

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

    function pageDocument(text: string, many: string, few: string) {
      return {
        formatVersion: 1,
        kind: "page",
        nodes: [
          heading("title", text),
          ...Array.from({ length: 20 }, (_, at) => placing(`m${at}`, many)),
          ...Array.from({ length: 10 }, (_, at) => placing(`f${at}`, few)),
        ],
      };
    }

    it("reads what the page places once per kind", async () => {
      const t = await boot();
      const many = await component(t, "card");
      const few = await component(t, "banner");
      const pageId = idOf(
        await t.nextly.create({
          collection: "pages",
          data: {
            title: "Long page",
            slug: "long-page",
            content: pageDocument("Before", many, few),
            status: "published",
          },
          overrideAccess: true,
        })
      );
      await t.events.settle();
      const log = await openStatementLog(t.adapter, dialect);
      let from = 0;
      try {
        await log.quiet();
        from = log.statements.length;
        await t.nextly.update({
          collection: "pages",
          id: pageId,
          data: {
            content: pageDocument("After", many, few),
            status: "published",
            _overwrite: true,
          },
          overrideAccess: true,
        });
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
      writeFileSync(
        `/tmp/publish-statements-${dialect}.json`,
        JSON.stringify({ total: statements.length, byTable, statements }, null, 1)
      );
      expect(statements.length).toBeGreaterThan(0);
    });
  }
);
