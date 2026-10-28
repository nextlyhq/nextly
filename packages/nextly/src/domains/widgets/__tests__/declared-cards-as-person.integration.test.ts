/**
 * One declared widget asked for by two people with different read access, through the real
 * `POST /api/dashboard/query` on every configured dialect: each is answered what their own
 * access allows, and a widget's `access` is judged before its data function runs.
 *
 * `widget-cards.test.ts` decides the order (access, then settings, then `shows`, then the data
 * function) against a mocked batch. Only stored people, stored grants and a database settle that
 * the person the batch resolves is the one every read runs as, on each dialect.
 *
 * @module domains/widgets/__tests__/declared-cards-as-person.integration.test
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { WidgetLayoutService } from "../../../services/widgets/widget-layout-service";
import { sanitizeConfig } from "../../../shared/types/config";
import { defineWidget } from "../declaration/define-widget";

const ORDERS = "dp_orders";
const NOTES = "dp_notes";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Each widget whose data function ran, in the order they ran. */
let ran: string[] = [];

const shop = definePlugin({
  name: "@test/person-shop",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [
      defineCollection({ slug: ORDERS, fields: [text({ name: "state" })] }),
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
    ],
    dashboard: {
      widgets: [
        // Offered on the strength of the notes alone, and counts orders: only the person's own
        // grants decide what that count reads.
        defineWidget({
          id: "acme/orders-beside-notes",
          title: "Orders beside notes",
          description: "Orders, counted beside the notes desk",
          category: "Shop",
          size: { default: { w: 12, h: 3 } },
          access: `read-${NOTES}`,
          load: async ({ services }) => {
            ran.push("acme/orders-beside-notes");
            return { total: await services.count(ORDERS) };
          },
          view: "figure",
        }),
        // Names the collections it reads: a person who may not read one is never asked for it.
        defineWidget({
          id: "acme/orders-read",
          title: "Orders read",
          description: "Orders, for who may read them",
          category: "Shop",
          size: { default: { w: 12, h: 3 } },
          access: { collections: [ORDERS] },
          load: async ({ services }) => {
            ran.push("acme/orders-read");
            return { total: await services.count(ORDERS) };
          },
          view: "figure",
        }),
      ],
    },
  },
});

describe.each(getConfiguredTestDialects())(
  "a declared widget asked for by two people (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    /** May read the orders and the notes. */
    let reader: string;
    /** May read the notes only. */
    let notesOnly: string;

    async function account(email: string): Promise<string> {
      const nextly = handle.nextly as unknown as {
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

    /** The batch's slots for `userId`'s own cards, asked for by widget and card id. */
    async function slotsFor(
      userId: string,
      cards: { widget: string; card: string }[]
    ): Promise<unknown[]> {
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
      const res = await createDynamicHandlers({
        config: sanitizeConfig({ collections: [], plugins: [shop] }),
      }).POST(
        new Request("http://localhost/api/dashboard/query", {
          method: "POST",
          headers: {
            cookie: `nextly_session=${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ queries: cards }),
        }),
        { params: Promise.resolve({ params: ["dashboard", "query"] }) }
      );
      expect(res.status).toBe(200);
      return ((await res.json()) as { results: unknown[] }).results;
    }

    /** Stores `userId`'s own dashboard: one card of each widget, the card id its widget's. */
    async function place(userId: string, widgets: string[]): Promise<void> {
      await new WidgetLayoutService(handle.adapter, silent).saveLayout(
        "user",
        userId,
        widgets.map(widgetId => ({
          id: widgetId.replace("/", "-"),
          widgetId,
          w: 12,
          h: 3,
          removed: false,
        })),
        0
      );
    }

    const asked = (widget: string) => ({
      widget,
      card: widget.replace("/", "-"),
    });

    beforeAll(async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [shop],
      });
      // The first account of an instance is its super admin, who reads everything; the two
      // people asked for below come after it.
      await account("dp-admin@example.com");
      reader = await account("dp-reader@example.com");
      notesOnly = await account("dp-notes@example.com");
      await grantTo(handle, reader, "read", [ORDERS, NOTES]);
      await grantTo(handle, notesOnly, "read", [NOTES]);
      for (const state of ["open", "open", "sent"]) {
        await handle.nextly.create({ collection: ORDERS, data: { state } });
      }
      await place(reader, ["acme/orders-beside-notes", "acme/orders-read"]);
      await place(notesOnly, ["acme/orders-beside-notes", "acme/orders-read"]);
    }, 120_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    beforeEach(() => {
      ran = [];
    });

    it("answers one widget's card with what each person's own access allows", async () => {
      const [read] = await slotsFor(reader, [
        asked("acme/orders-beside-notes"),
      ]);
      const [refused] = await slotsFor(notesOnly, [
        asked("acme/orders-beside-notes"),
      ]);
      // The same data function, run for each: it counts what the person asking may read.
      expect(read).toEqual({ ok: true, result: { op: "count", total: 3 } });
      expect(refused).toMatchObject({ ok: false });
      expect(JSON.stringify(refused)).not.toContain('"total"');
      expect(ran).toEqual([
        "acme/orders-beside-notes",
        "acme/orders-beside-notes",
      ]);
    });

    it("never runs the data function for a person who may not read a collection the widget names", async () => {
      const [read] = await slotsFor(reader, [asked("acme/orders-read")]);
      expect(read).toEqual({ ok: true, result: { op: "count", total: 3 } });
      expect(ran).toEqual(["acme/orders-read"]);

      ran = [];
      const [refused] = await slotsFor(notesOnly, [asked("acme/orders-read")]);
      // The one answer a card that is not theirs gets, and nothing of the widget's ran.
      expect(refused).toMatchObject({ ok: false, code: "unavailable" });
      expect(ran).toEqual([]);
    });
  }
);
