/**
 * A plugin's switch for the fields its `extend` added, through the admin's
 * workspace metadata, on each dialect: switched off on one type, the
 * plugin's tab that follows the field is not offered there and the field is
 * named as kept off that type's pages; the column and the stored value stay;
 * switched on again, everything is back.
 *
 * @module plugins/__tests__/extension-switch.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import { createDynamicHandlers } from "../../routeHandler";
import { sanitizeConfig } from "../../shared/types/config";
import type { AdminContribution } from "../admin-contributions";
import { EXTENSION_SWITCH_SERVICE } from "../extension-switch";
import type { PluginDefinition } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const POSTS = "esw_posts";
const LOGS = "esw_logs";
const READER = "user-esw-reader";

/** The types the plugin's switch has `notes` off on, as the test sets them. */
const off = new Set<string>();
/** How many times the switch was asked. */
const asked = { count: 0 };

/** Adds `notes` to every content type, with a tab following it, and a switch. */
const NOTES: PluginDefinition = {
  name: "@acme/notes",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    extend: [
      {
        target: { every: ["collection", "single"] },
        fields: [text({ name: "notes" })],
      },
    ],
    services: {
      [EXTENSION_SWITCH_SERVICE]: () => ({
        switchedOff: (field: string) => {
          asked.count += 1;
          return field === "notes"
            ? [...off].map(slug => ({ kind: "collection" as const, slug }))
            : [];
        },
      }),
    },
    admin: {
      contributions: [
        {
          id: "acme-notes.tab",
          kind: "tab",
          place: "collection.edit",
          label: "Notes",
          component: "x#Notes",
          fields: ["notes"],
          extendedWith: ["notes"],
        },
      ] as AdminContribution[],
    },
  },
};

const collections = () => [
  defineCollection({
    slug: POSTS,
    access: { read: () => true },
    fields: [text({ name: "title" })],
  }),
  defineCollection({
    slug: LOGS,
    access: { read: () => true },
    fields: [text({ name: "title" })],
  }),
];

let current: TestNextly | undefined;
afterEach(async () => {
  off.clear();
  asked.count = 0;
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [NOTES],
    collections: collections(),
  });
  await userWhoMay(current, READER, "read", [POSTS, LOGS]);
  return current;
}

/** The workspace metadata as the reader receives it. */
async function workspace(): Promise<Record<string, unknown>> {
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
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({ collections: [], plugins: [NOTES] }),
  });
  const path = ["admin-meta", "workspace"];
  const res = await handlers.GET(
    new Request(`http://localhost/api/${path.join("/")}`, {
      headers: { cookie: `nextly_session=${token}` },
    }),
    { params: Promise.resolve({ params: path }) }
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  return (body.data ?? body) as Record<string, unknown>;
}

/** The collections the tab is offered on. */
function tabCollections(meta: Record<string, unknown>): unknown {
  const places = meta.contributions as
    | Record<string, { tab?: { id: string; collections?: string[] }[] }>
    | undefined;
  return places?.["collection.edit"]?.tab?.find(
    tab => tab.id === "acme-notes.tab"
  )?.collections;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's switch for its extension fields (%s)",
  dialect => {
    it("withholds the field and its tab on a type switched off, keeping the value, until it is on again", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: LOGS,
        data: { title: "Kept", notes: "Written while on" } as never,
      });
      const id = (created.item as { id: string }).id;

      const on = await workspace();
      expect(tabCollections(on)).toEqual([POSTS, LOGS]);
      expect(on.withheldFields).toBeUndefined();

      off.add(LOGS);
      const switchedOff = await workspace();
      expect(tabCollections(switchedOff)).toEqual([POSTS]);
      expect(switchedOff.withheldFields).toEqual({
        [`collection:${LOGS}`]: ["notes"],
      });
      // Nothing about the schema or the value changed.
      const kept = (await t.nextly.findByID({
        collection: LOGS,
        id,
      } as never)) as { notes?: string } | null;
      expect(kept?.notes).toBe("Written while on");

      off.delete(LOGS);
      const back = await workspace();
      expect(tabCollections(back)).toEqual([POSTS, LOGS]);
      expect(back.withheldFields).toBeUndefined();
    });

    it("never asks the switch for the public branding, which a visitor reads", async () => {
      await boot(dialect);
      const handlers = createDynamicHandlers({
        config: sanitizeConfig({ collections: [], plugins: [NOTES] }),
      });
      const res = await handlers.GET(
        new Request("http://localhost/api/admin-meta"),
        { params: Promise.resolve({ params: ["admin-meta"] }) }
      );
      expect(res.status).toBe(200);
      expect(asked.count).toBe(0);
      // The workspace, for a signed-in reader, does ask it.
      await workspace();
      expect(asked.count).toBeGreaterThan(0);
    });
  }
);
