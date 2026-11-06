/**
 * A plugin's entry-list filter narrows the list through the list's own
 * request: the admin adds the chosen option's `where` to the `where` it sends,
 * and the list read applies it with the caller's access. So a filter changes
 * which rows come back, and never returns a row the caller couldn't already
 * list, even an option written to reach other people's rows.
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import { createDynamicHandlers } from "../../routeHandler";
import type { PluginListFilterDeclaration } from "../admin-contributions";
import { contributedListFilters } from "../admin-filters";
import type { PluginDefinition } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const TICKETS = "pfl_tickets";
const READER = "user-pfl-reader";
const OTHER = "user-pfl-other";

const STATE: PluginListFilterDeclaration = {
  name: "acme-support.state",
  label: "Ticket state",
  options: [
    { value: "open", label: "Open", where: { state: { equals: "open" } } },
    {
      value: "closed",
      label: "Closed",
      where: { state: { equals: "closed" } },
    },
    // Written to reach someone else's tickets: the caller's read rule still
    // decides what comes back.
    { value: "theirs", label: "Theirs", where: { owner: { equals: OTHER } } },
  ],
};

const SUPPORT: PluginDefinition = {
  name: "@acme/support",
  version: "1.0.0",
  nextly: "*",
  contributes: { admin: { filters: [STATE] } },
};

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [SUPPORT],
    collections: [
      defineCollection({
        slug: TICKETS,
        // Each caller lists only their own tickets.
        access: { read: ({ user }) => ({ owner: { equals: user?.id ?? "" } }) },
        fields: [
          text({ name: "title" }),
          text({ name: "state" }),
          text({ name: "owner" }),
        ],
      }),
    ],
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  await userWhoMay(current, READER, "read", [TICKETS]);
  for (const [title, state, owner] of [
    ["mine open", "open", READER],
    ["mine closed", "closed", READER],
    ["their open", "open", OTHER],
    ["their closed", "closed", OTHER],
  ]) {
    await current.nextly.create({
      collection: TICKETS as never,
      data: { title, state, owner } as never,
      overrideAccess: true,
    } as never);
  }
  return current;
}

/** The option's `where`, as the admin is given it: from the same reduction. */
function fragment(value: string): Record<string, unknown> {
  const [filter] = contributedListFilters([SUPPORT]);
  const option = filter?.options.find(o => o.value === value);
  if (!option) throw new Error(`no option ${value}`);
  return option.where as Record<string, unknown>;
}

/** The titles the entry list returns to the reader, for an optional `where`. */
async function listedTitles(
  where?: Record<string, unknown>
): Promise<string[]> {
  const token = await signAccessToken(
    buildClaims({
      userId: READER,
      email: `${READER}@example.test`,
      name: READER,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const path = ["collections", TICKETS, "entries"];
  // The query the admin sends: its `where` as JSON.
  const query = where
    ? `?where=${encodeURIComponent(JSON.stringify(where))}`
    : "";
  const res = await createDynamicHandlers().GET(
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      headers: { cookie: `nextly_session=${token}` },
    }),
    { params: Promise.resolve({ params: path }) }
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Array<{ title: string }> };
  return body.items.map(item => item.title).sort();
}

describe.each(getConfiguredTestDialects())(
  "a plugin's entry-list filter (%s)",
  dialect => {
    it("narrows the rows the list returns", async () => {
      await boot(dialect);
      expect(await listedTitles()).toEqual(["mine closed", "mine open"]);
      expect(await listedTitles(fragment("open"))).toEqual(["mine open"]);
      expect(await listedTitles(fragment("closed"))).toEqual(["mine closed"]);
    });

    it("never returns a row the caller couldn't already list", async () => {
      await boot(dialect);
      const unfiltered = await listedTitles();
      for (const value of ["open", "closed", "theirs"]) {
        const filtered = await listedTitles(fragment(value));
        expect(
          filtered.every(title => unfiltered.includes(title)),
          value
        ).toBe(true);
      }
      // The option written to reach someone else's tickets reaches none.
      expect(await listedTitles(fragment("theirs"))).toEqual([]);
    });
  }
);
