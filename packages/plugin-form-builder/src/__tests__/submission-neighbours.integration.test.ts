/**
 * A submission's place in the list it was opened from, on every dialect: the
 * submission page's newer and older queries, run through the same reads the
 * entries API makes, find the rows beside it in the list's own order, ties on
 * the time included, and count how many come before it.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  LIST_SORT,
  listWhere,
  listWithWhere,
  neighbourQueries,
} from "../admin/components/submissions/submission-list-scope";
import { formBuilder } from "../plugin";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const HOUR = 3_600_000;
const BASE = Date.parse("2026-11-10T14:15:00.000Z");

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [formBuilder().plugin],
  });
  const t = current;
  const formId = String(
    (
      await t.nextly.create({
        collection: "forms",
        data: {
          name: "Jobs",
          slug: "jobs",
          status: "published",
          fields: [{ type: "text", name: "name", label: "Full name" }],
        },
      })
    ).item.id
  );
  const submit = async (name: string, at: number) =>
    String(
      (
        await t.nextly.create({
          collection: "form-submissions",
          data: {
            form: formId,
            data: { name },
            submittedAt: new Date(at).toISOString(),
          },
        })
      ).item.id
    );
  const find = async (where: Record<string, unknown>, sort: string) =>
    (
      (await t.nextly.find({
        collection: "form-submissions",
        where,
        sort,
        limit: 100,
      })) as { items: Array<{ id: string; submittedAt: string }> }
    ).items;
  const markRead = (id: string) =>
    t.nextly.update({
      collection: "form-submissions",
      id,
      data: { status: "read", _overwrite: true },
    });
  return { formId, submit, find, markRead };
}

describe.each(getConfiguredTestDialects())(
  "a submission's neighbours (%s)",
  dialect => {
    it("are the rows beside it in the list, ties on the time included", async () => {
      const { formId, submit, find } = await boot(dialect);
      // An hour apart, and three sent at the same moment between them.
      await submit("Ana", BASE - 3 * HOUR);
      await submit("Bilal", BASE - 2 * HOUR);
      await submit("Tie one", BASE - HOUR);
      await submit("Tie two", BASE - HOUR);
      await submit("Tie three", BASE - HOUR);
      await submit("Chen", BASE);
      const scope = { status: "all" as const, form: formId };

      const list = await find(listWhere(scope), LIST_SORT);
      expect(list).toHaveLength(6);
      for (const [index, row] of list.entries()) {
        const around = neighbourQueries(scope, row.submittedAt, row.id);
        const newer = await find(around.newer.where, around.newer.sort);
        const older = await find(around.older.where, around.older.sort);
        expect(newer[0]?.id).toBe(list[index - 1]?.id);
        expect(older[0]?.id).toBe(list[index + 1]?.id);
        // Its place in the list: how many come before it.
        expect(newer).toHaveLength(index);
      }
    });

    it("counts a submission that has left its list in that list", async () => {
      const { formId, submit, find, markRead } = await boot(dialect);
      await submit("Ana", BASE - 2 * HOUR);
      const bilal = await submit("Bilal", BASE - HOUR);
      await submit("Chen", BASE);
      // Opened from the New tab, Bilal is read and leaves it.
      await markRead(bilal);
      const scope = { status: "new" as const, form: formId };
      const [row] = await find({ id: { equals: bilal } }, LIST_SORT);
      const around = neighbourQueries(scope, row!.submittedAt, bilal);
      const newer = await find(around.newer.where, around.newer.sort);
      const older = await find(around.older.where, around.older.sort);
      const all = await find(listWithWhere(scope, bilal), LIST_SORT);
      // Second of three, as it was when opened.
      expect(newer).toHaveLength(1);
      expect(all).toHaveLength(newer.length + 1 + older.length);
      expect(all.map(each => each.id)).toContain(bilal);
    });
  }
);
