/**
 * What the add panel is offered, through the real layout read, on every
 * configured dialect.
 *
 * The read names each widget the reader may add, with the group core assigns
 * it. A widget the reader may not see is not named at all; a card core derives
 * from a collection is retired and never offered, whatever the collection; and
 * content the site keeps off the dashboard (internal, or hidden from the
 * admin) has no card to offer in the first place.
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { refreshCollectionWidgets } from "../collection-widgets";
import { clearSources } from "../sources";

// Each case makes real requests through the whole handler. Set
// NEXTLY_TEST_SLOW_DB=1 when the database is across a network; CI keeps the
// package default, so a slow query there still fails.
if (process.env.NEXTLY_TEST_SLOW_DB === "1") {
  vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
}

/** Shown content. */
const POSTS = "posts";
/** Internal, and hidden from the admin: kept off the dashboard. */
const INTERNAL = "nx_usage_index";
const HIDDEN = "patterns";

/** The one built-in with a permission: a reader without it may not see it. */
const GATED = "core/upcoming-releases";

interface LayoutRead {
  placements: { widgetId: string }[];
  available: string[];
  widgets: Record<string, { group?: string; subgroup?: string }>;
}

describeEachDialect("what the add panel is offered", dialect => {
  let handle: TestNextly | undefined;
  /** The first account, which core makes super-admin. */
  let admin: string;
  /** A second account with no role, so no grant. */
  let reader: string;

  async function account(email: string): Promise<string> {
    const nextly = handle!.nextly as unknown as {
      users: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    };
    const created = await nextly.users.create({
      data: { email, password: "Password123!", name: email, isActive: true },
    });
    return created.item.id;
  }

  async function read(userId: string): Promise<LayoutRead> {
    const token = await signAccessToken(
      buildClaims({
        userId,
        email: `${userId}@example.com`,
        name: userId,
        image: null,
        roleIds: [],
        sessionEpoch: 0,
      }),
      process.env.NEXTLY_SECRET!
    );
    const res = await createDynamicHandlers().GET(
      new Request("http://localhost/api/dashboard/layout", {
        headers: { cookie: `nextly_session=${token}` },
      }),
      { params: Promise.resolve({ params: ["dashboard", "layout"] }) }
    );
    expect(res.status).toBe(200);
    return (await res.json()) as LayoutRead;
  }

  /** Every widget the read names, placed or offered. */
  const named = (layout: LayoutRead) =>
    new Set([
      ...layout.placements.map(placement => placement.widgetId),
      ...layout.available,
    ]);

  beforeEach(async () => {
    handle = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: POSTS, fields: [text({ name: "title" })] }),
        defineCollection({
          slug: INTERNAL,
          internal: true,
          fields: [text({ name: "name" })],
        }),
        defineCollection({
          slug: HIDDEN,
          admin: { useAsTitle: "title", hidden: true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    admin = await account("admin@example.com");
    reader = await account("reader@example.com");
    // A cold process: the derived cards below are the refresh's own work.
    clearSources();
    await refreshCollectionWidgets();
  });

  afterEach(async () => {
    clearSources();
    await handle?.destroy();
    handle = undefined;
  });

  it("names a widget the reader may see, with the group core assigns it", async () => {
    const layout = await read(admin);
    expect(named(layout).has(GATED)).toBe(true);
    expect(layout.widgets[GATED]?.group).toBe("overview");
    expect(layout.widgets["core/team"]?.group).toBe("team");
    expect(layout.widgets["core/recent-activity"]?.group).toBe("team");
  });

  it("does not name a widget the reader may not see", async () => {
    const layout = await read(reader);
    expect(named(layout).has(GATED)).toBe(false);
    expect(layout.widgets).not.toHaveProperty(GATED);
    // The control: the same read names the ungated built-ins.
    expect(named(layout).has("core/team")).toBe(true);
  });

  it("offers no card derived from a collection, and has none for content kept off the dashboard", async () => {
    const layout = await read(admin);
    const derived = Object.keys(layout.widgets).filter(id =>
      id.startsWith("collection/")
    );
    // The control: the shown collection's derived cards exist and are still
    // drawable, so their absence from the offer is the rule, not an empty set.
    expect(derived.some(id => id.includes(POSTS))).toBe(true);
    for (const id of derived) {
      expect(layout.available, id).not.toContain(id);
      expect(layout.widgets[id]?.group, id).toBeUndefined();
    }
    for (const slug of [INTERNAL, HIDDEN]) {
      expect(
        derived.some(id => id.includes(slug)),
        slug
      ).toBe(false);
    }
    // Everything that IS offered has a group to be listed in.
    for (const id of layout.available) {
      expect(layout.widgets[id]?.group, id).toEqual(expect.any(String));
    }
  });
});
