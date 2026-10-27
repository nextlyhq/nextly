/**
 * Declared widgets through a real instance, on each database: what a saved
 * card's settings become when a starting value changes in code, and startup
 * refusing a declaration that cannot work.
 *
 * Booted with `createTestNextly`, so startup is the real boot path: the
 * plugin's `contributes.dashboard` is read by the same reset production runs.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { NextlyError } from "../../../../errors/nextly-error";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import {
  countLayoutRows,
  deleteRunRows,
} from "../../../../services/widgets/__tests__/layout-rows";
import { WidgetLayoutService } from "../../../../services/widgets/widget-layout-service";
import type { WidgetPlacement } from "../../layout";
import { resolveCardSettings } from "../card-settings";
import { declaredWidget } from "../declared-widgets";
import { defineWidget } from "../define-widget";
import { settings } from "../setting-builders";

const ORDERS = "orders";

/**
 * This run's own suffix for the layouts it saves.
 *
 * PostgreSQL and MySQL keep a slot's test database between runs, and the case saves at version 0,
 * which a row an earlier run left under the same scope refuses: a second run on one database failed
 * with a conflict while CI's fresh databases never saw it. A suffix fresh for each run gives every
 * run rows of its own. The whole UUID, because the teardown deletes by it on shared databases.
 */
const RUN = randomUUID();

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
    size: { default: { w: 12, h: 4 }, min: { w: 6, h: 4 } },
    access: `read-${ORDERS}`,
    settings: {
      collection: settings.collection(),
      items: settings.items({ default: startingItems }),
    },
    load: async ({ settings, services, signal }) => ({
      items: (
        await services.find(settings.collection, {
          select: ["state"],
          limit: settings.items,
          signal,
        })
      ).items,
    }),
    view: "list",
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

function card(id: string, config: Record<string, unknown>): WidgetPlacement {
  return {
    id,
    widgetId: "acme/recent-orders",
    w: 12,
    h: 4,
    removed: false,
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
    // The layouts the case saved through, and how many rows the table held before it wrote any:
    // a server database keeps whatever an earlier run, or another suite, wrote there.
    let layouts: WidgetLayoutService | undefined;
    let startingRows: number | undefined;

    // The rows this run wrote go with it rather than piling up, and the case fails if any stayed.
    // Before the handle goes, since the rows are read and deleted through its database.
    afterEach(async () => {
      if (layouts !== undefined && startingRows !== undefined) {
        await deleteRunRows(layouts, RUN);
        expect(await countLayoutRows(layouts, RUN)).toBe(0);
        expect(await countLayoutRows(layouts)).toBe(startingRows);
      }
      layouts = undefined;
      startingRows = undefined;
      await handle?.destroy();
      handle = undefined;
    });

    it("hand a saved card a new starting value, and leave a value its person chose", async () => {
      handle = await boot(5);
      layouts = new WidgetLayoutService(handle.adapter, silentLogger);
      startingRows = await countLayoutRows(layouts);
      const scope = `starting-values-${label}-${RUN}`;
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
            {
              ...recentOrders(5),
              id: "core/orders",
              // Below the minimum it states beside it.
              size: { default: { w: 3, h: 4 }, min: { w: 6, h: 4 } },
            },
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
      'plugin "@test/broken", widget "core/orders": size.min must not be larger than size.default'
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
