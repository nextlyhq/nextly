/**
 * `runWidgetLoad` against a real instance on each configured dialect: a card
 * answered for a person with read access, for one without, and for nobody, as
 * the dashboard answers each, through the dashboard's own route.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { ServiceContainer } from "../../services";
import { definePlugin } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../test-nextly";
import { runWidgetLoad } from "../test-widget-load";

const orders = defineCollection({
  slug: "orders",
  fields: [text({ name: "state" })],
});

// How many orders are open, read as the person asking.
const openOrders = defineWidget({
  id: "acme/open-orders",
  title: "Open orders",
  description: "Orders waiting to be sent",
  size: { default: { w: 6, h: 3 } },
  access: "read-orders",
  load: async ({ services }) => ({
    total: await services.count("orders", {
      where: { state: { equals: "open" } },
    }),
  }),
  view: "figure",
  isEmpty: data => data.total === 0,
});

const shop = definePlugin({
  name: "@test/shop",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: { collections: [orders], dashboard: { widgets: [openOrders] } },
});

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  let t: TestNextly | undefined;
  let ownerId = "";
  let otherId = "";

  beforeEach(async () => {
    t = await createTestNextly({ dialect, plugins: [shop] });
    ownerId = await userNamed("owner");
    otherId = await userNamed("other");
  });

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  });

  async function userNamed(name: string): Promise<string> {
    const created = await t!.nextly.users.create({
      email: `${name}@example.com`,
      password: "Password123!",
      data: { name, isActive: true },
    });
    return created.item.id;
  }

  async function grant(userId: string, slugs: string[]): Promise<void> {
    const nextly = t!.nextly as unknown as {
      permissions: {
        find: (a: { limit: number }) => Promise<{
          items: { id: string; slug: string }[];
        }>;
      };
      roles: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    };
    const permissions = await nextly.permissions.find({ limit: 300 });
    const role = await nextly.roles.create({
      data: {
        name: "Reader",
        slug: "reader",
        permissionIds: slugs.map(
          slug => permissions.items.find(p => p.slug === slug)!.id
        ),
      },
    });
    expect(
      (
        await new ServiceContainer(t!.adapter).userRoles.assignRoleToUser(
          userId,
          role.item.id
        )
      ).success
    ).toBe(true);
  }

  it("answers the data for a person who may read it, as the dashboard does", async () => {
    for (const state of ["open", "open", "sent"]) {
      await t!.nextly.create({ collection: "orders", data: { state } });
    }
    await grant(otherId, ["read-orders"]);
    expect(
      await runWidgetLoad(t!, openOrders, { as: { id: ownerId } })
    ).toEqual({ state: "ready", data: { total: 2 } });
    expect(
      await runWidgetLoad(t!, openOrders, { as: { id: otherId } })
    ).toEqual({ state: "ready", data: { total: 2 } });
  });

  it("answers 'empty', with the data, when the widget's empty test holds", async () => {
    expect(
      await runWidgetLoad(t!, openOrders, { as: { id: ownerId } })
    ).toEqual({ state: "empty", data: { total: 0 } });
  });

  it("answers 'unavailable' to a person without read access, and to nobody", async () => {
    await t!.nextly.create({ collection: "orders", data: { state: "open" } });
    expect(
      await runWidgetLoad(t!, openOrders, { as: { id: otherId } })
    ).toEqual({ state: "unavailable" });
    expect(await runWidgetLoad(t!, openOrders, { as: null })).toEqual({
      state: "unavailable",
    });
  });
});
