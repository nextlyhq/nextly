/**
 * Declared widgets through a real instance, on each database: what the admin
 * receives, what a saved card's settings become when a starting value changes
 * in code, and startup refusing a declaration that cannot work.
 *
 * Booted with `createTestNextly`, so startup is the real boot path: the
 * plugin's `contributes.dashboard` is read by the same reset production runs.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { NextlyError } from "../../../../errors/nextly-error";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";
import { WidgetLayoutService } from "../../../../services/widgets/widget-layout-service";
import { sanitizeConfig } from "../../../../shared/types/config";
import type { WidgetPlacement } from "../../layout";
import { resolveCardSettings } from "../card-query";
import { declaredWidget } from "../declared-widgets";
import { defineWidget } from "../define-widget";
import { settings } from "../setting-builders";

const ORDERS = "orders";

const orders = defineCollection({
  slug: ORDERS,
  fields: [text({ name: "state" })],
});

/** The same widget, with its starting number of items set in code. */
function recentOrders(startingItems: number) {
  return defineWidget({
    id: "acme/recent-orders",
    title: "Recent orders",
    description: "The newest orders",
    category: "Shop",
    widths: ["1/2", "full"],
    width: "full",
    permission: `read-${ORDERS}`,
    settings: {
      collection: settings.collection(),
      items: settings.items({ default: startingItems }),
    },
    data: {
      query: ({ settings }) => ({
        collection: settings.collection,
        op: "list",
        limit: settings.items,
      }),
    },
    display: "list",
  });
}

function shop(startingItems: number) {
  return definePlugin({
    name: "@test/shop",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      collections: [orders],
      dashboard: { widgets: [recentOrders(startingItems)] },
    },
  });
}

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A key holding exactly `read-orders`, minted by the instance's first user. */
async function readOrdersKey(handle: TestNextly): Promise<string> {
  const nextly = handle.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
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
  const owner = await nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  const permissions = await nextly.permissions.find({ limit: 300 });
  const read = permissions.items.find(p => p.slug === `read-${ORDERS}`);
  expect(
    read,
    "the plugin's collection seeds its read permission"
  ).toBeDefined();
  const role = await nextly.roles.create({
    data: {
      name: "Order readers",
      slug: "order-readers",
      permissionIds: [read!.id],
    },
  });
  const apiKeys = handle.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId?: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(owner.item.id, {
    name: "order reader",
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "never",
  });
  return key;
}

interface WorkspaceWidget {
  id: string;
  [field: string]: unknown;
}

async function workspaceWidgets(key: string): Promise<WorkspaceWidget[]> {
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({ collections: [], plugins: [shop(5)] }),
  });
  const res = await handlers.GET(
    new Request("http://localhost/api/admin-meta/workspace", {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: ["admin-meta", "workspace"] }) }
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { widgets?: WorkspaceWidget[] };
  return body.widgets ?? [];
}

function card(id: string, config: Record<string, unknown>): WidgetPlacement {
  return {
    id,
    widgetId: "acme/recent-orders",
    column: 0,
    order: id === "untouched" ? 0 : 10,
    hidden: false,
    config,
  };
}

/** The values a stored card's readers are handed, by the declaration as it now stands. */
function valuesOf(placement: WidgetPlacement | undefined) {
  const declared = declaredWidget("acme/recent-orders");
  expect(declared).toBeDefined();
  return resolveCardSettings(declared!.declaration.settings, placement?.config);
}

function declaredWidgetSuite(
  label: string,
  boot: (startingItems: number) => Promise<TestNextly>
) {
  describe(`declared widgets (${label})`, () => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
    });

    it("reach the admin through the plugin door as data, behind their permission", async () => {
      handle = await boot(5);
      const widgets = await workspaceWidgets(await readOrdersKey(handle));
      const published = widgets.find(
        widget => widget.id === "acme/recent-orders"
      );
      expect(published).toMatchObject({
        title: "Recent orders",
        description: "The newest orders",
        archetype: "list",
        serverData: true,
        requiredPermission: `read-${ORDERS}`,
        defaultSize: "full",
      });
      // The query function never left the server: what the admin received
      // holds no query and no data, only what JSON carries.
      expect(published).not.toHaveProperty("query");
      expect(published).not.toHaveProperty("data");
    });

    it("hand a saved card a new starting value, and leave a value its person chose", async () => {
      handle = await boot(5);
      const layouts = new WidgetLayoutService(handle.adapter, silentLogger);
      const scope = `starting-values-${label}`;
      await layouts.saveLayout(
        "user",
        scope,
        [
          card("untouched", { collection: ORDERS }),
          card("chosen", { collection: ORDERS, items: 9 }),
        ],
        0
      );

      const before = (await layouts.getLayout("user", scope)).layout
        ?.placements;
      expect(valuesOf(before?.find(p => p.id === "untouched")).items).toBe(5);
      expect(valuesOf(before?.find(p => p.id === "chosen")).items).toBe(9);

      // The code changes its starting value; the database does not change.
      // The boot reset is what a redeploy or a development reload runs.
      const { resetWidgetRegistries } = await import(
        "../../../../di/registrations/register-widgets"
      );
      resetWidgetRegistries([shop(7)]);

      const after = (await layouts.getLayout("user", scope)).layout?.placements;
      // The stored rows are as they were: nothing was rewritten.
      expect(after).toEqual(before);
      expect(valuesOf(after?.find(p => p.id === "untouched")).items).toBe(7);
      expect(valuesOf(after?.find(p => p.id === "chosen")).items).toBe(9);
    });
  });
}

declaredWidgetSuite("sqlite", startingItems =>
  createTestNextly({ plugins: [shop(startingItems)] })
);

describe("startup with a declaration that cannot work (sqlite)", () => {
  it("is refused, naming the plugin, the widget and what to change", async () => {
    const broken = definePlugin({
      name: "@test/broken",
      version: "1.0.0",
      nextly: ">=0.0.1",
      contributes: {
        dashboard: {
          widgets: [
            { ...recentOrders(5), id: "core/orders", width: "1/4" },
          ] as unknown as NonNullable<
            NonNullable<
              Parameters<typeof definePlugin>[0]["contributes"]
            >["dashboard"]
          >["widgets"],
        },
      },
    });
    let refused: unknown;
    try {
      const handle = await createTestNextly({ plugins: [broken] });
      await handle.destroy();
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(NextlyError);
    const message = (refused as NextlyError).logMessage ?? "";
    expect(message).toContain("2 widget declarations cannot work");
    expect(message).toContain(
      'plugin "@test/broken", widget "core/orders": id "core/orders" is in the reserved "core/" namespace'
    );
    expect(message).toContain(
      'plugin "@test/broken", widget "core/orders": width "1/4" is not one of the widths it allows'
    );
  });
});

// PostgreSQL and MySQL: self-skipping without their URLs, run by CI's matrix.
const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
const MY_URL = process.env.TEST_MYSQL_URL ?? "";

describe.skipIf(!PG_URL)("postgres", () => {
  declaredWidgetSuite("postgres", async startingItems => {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = PG_URL;
    const adapter = await createAdapter({
      type: "postgresql",
      url: PG_URL,
    } as Parameters<typeof createAdapter>[0]);
    return createTestNextly({ adapter, plugins: [shop(startingItems)] });
  });
});

describe.skipIf(!MY_URL)("mysql", () => {
  declaredWidgetSuite("mysql", async startingItems => {
    process.env.DB_DIALECT = "mysql";
    process.env.DATABASE_URL = MY_URL;
    const adapter = await createAdapter({
      type: "mysql",
      url: MY_URL,
    } as Parameters<typeof createAdapter>[0]);
    return createTestNextly({ adapter, plugins: [shop(startingItems)] });
  });
});
