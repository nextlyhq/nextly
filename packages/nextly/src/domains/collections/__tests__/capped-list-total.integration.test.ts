/**
 * A list asked for a capped count (`?count=capped`) counts its total no
 * further than 1,000 entries, on every dialect.
 *
 * - **At most 1,000 match:** the total is exact.
 * - **More match:** the total reads 1,000 with `totalCapped`, and paging past
 *   the cap still works, forward and back.
 * - **Without the param:** the same list's total is exact, so a caller that
 *   doesn't ask sees nothing change.
 *
 * Entries are written straight to the collection's table, copied from one
 * made through the Direct API, as making 1,200 through it would take minutes
 * on MySQL.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const NOTES = "capped_total_notes";
const READER = "capped-total-reader";
const ORIGIN = "http://localhost";
const LIMIT = 25;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A test instance on `dialect` whose collection holds `count` entries. */
async function bootWith(
  dialect: TestDialect,
  count: number
): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
    ],
  });
  current = t;
  await userWhoMay(t, READER, "read", [NOTES]);
  await t.nextly.create({ collection: NOTES, data: { title: "note 0" } });
  const [template] = await t.adapter.select<Record<string, unknown>>(
    `dc_${NOTES}`
  );
  const rows = Array.from({ length: count - 1 }, (_, i) => ({
    ...template,
    id: randomUUID(),
    title: `note ${i + 1}`,
    // Each entry's slug is unique, so each copy takes its own.
    slug: `note-${i + 1}`,
  }));
  // In batches, so no dialect meets its limit on one statement's values.
  for (let start = 0; start < rows.length; start += 200) {
    await t.adapter.insertMany(`dc_${NOTES}`, rows.slice(start, start + 200));
  }
  return t;
}

interface ListMeta {
  total: number;
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  totalCapped?: true;
}

/** The reader's REST list of the collection with `query`: items and meta. */
async function list(
  query: string
): Promise<{ status: number; items: unknown[]; meta: ListMeta }> {
  const token = await signAccessToken(
    buildClaims({
      userId: READER,
      email: `${READER}@example.test`,
      name: READER,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  const segments = ["collections", NOTES, "entries"];
  const res = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/api/${segments.join("/")}${query}`, {
      headers: { origin: ORIGIN, cookie: `nextly_session=${token}` },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  const body = (await res.json()) as { items?: unknown[]; meta?: ListMeta };
  return {
    status: res.status,
    items: body.items ?? [],
    meta: body.meta as ListMeta,
  };
}

describe.each(getConfiguredTestDialects())(
  "a list's capped count (%s)",
  dialect => {
    it.each([999, 1000])(
      "gives the exact total when %i entries match",
      async count => {
        await bootWith(dialect, count);

        const { status, meta } = await list(`?count=capped&limit=${LIMIT}`);

        expect(status).toBe(200);
        expect(meta.total).toBe(count);
        expect(meta.totalCapped).toBeUndefined();
        expect(meta.totalPages).toBe(Math.ceil(count / LIMIT));
      },
      300_000
    );

    it("caps the total at 1,000 when 1,200 match, and still pages past it", async () => {
      await bootWith(dialect, 1200);

      const first = await list(`?count=capped&limit=${LIMIT}`);
      expect(first.status).toBe(200);
      expect(first.meta).toMatchObject({
        total: 1000,
        totalCapped: true,
        hasNext: true,
        hasPrev: false,
      });

      // Page 45 holds entries 1,101 to 1,125, past the cap; its rows are read,
      // and a next page is still offered.
      const beyond = await list(`?count=capped&limit=${LIMIT}&page=45`);
      expect(beyond.meta).toMatchObject({
        page: 45,
        total: 1000,
        totalCapped: true,
        hasNext: true,
        hasPrev: true,
      });
      expect(beyond.items).toHaveLength(LIMIT);

      // The last page: 1,176 to 1,200, with nothing after it.
      const last = await list(`?count=capped&limit=${LIMIT}&page=48`);
      expect(last.meta).toMatchObject({ page: 48, hasNext: false });
      expect(last.items).toHaveLength(LIMIT);

      // Back again from beyond the cap.
      const back = await list(`?count=capped&limit=${LIMIT}&page=44`);
      expect(back.meta).toMatchObject({ page: 44, hasPrev: true });
      expect(back.items).toHaveLength(LIMIT);
    }, 300_000);

    it("counts every entry when the list does not ask for a capped count", async () => {
      // The control: the capped total above comes from the param, not from a
      // count that stopped at 1,000 for everyone.
      await bootWith(dialect, 1200);

      const { meta } = await list(`?limit=${LIMIT}`);

      expect(meta.total).toBe(1200);
      expect(meta.totalCapped).toBeUndefined();
    }, 300_000);

    it("refuses a count it does not know", async () => {
      await bootWith(dialect, 1);

      const { status } = await list("?count=some");

      expect(status).toBe(400);
    }, 300_000);
  }
);
