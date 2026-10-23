/**
 * A card's settings reach the data it shows, on every configured dialect: each setting a widget
 * declares changes the rows its query answers, and a default changed after a card was placed
 * reaches everyone who never changed that setting, and no one who did.
 *
 * The card's settings go through the real layout endpoint and are read back, so what is applied
 * is what was stored; the declaration is the registry's, which is what the admin is sent; the
 * settings become the query through `applyWidgetSettings`, the one path they take; and the query
 * runs against real rows.
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshCollectionSources } from "../collection-sources";
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery, type WidgetQuery } from "../query";
import { deregisterWidget, getWidget, registerWidget } from "../registry";
import { applyWidgetSettings } from "../settings";

const NOTES = "notes";
const WIDGET = "test/notes";
/** More rows than any limit below, so each limit is what decides the count. */
const ROWS = 9;

interface Placement {
  id: string;
  widgetId: string;
  width: string;
  removed: boolean;
  config?: Record<string, unknown>;
}

interface LayoutRead {
  placements: Placement[];
  version: number;
  scope: string;
}

/** The notes card, its `limit` defaulting to `defaultLimit`. */
function declare(defaultLimit: number): void {
  if (getWidget(WIDGET)) deregisterWidget(WIDGET);
  registerWidget(
    {
      id: WIDGET,
      title: "Notes",
      archetype: "list",
      defaultSize: "md",
      defaultOrder: 1000,
      query: { source: `collection:${NOTES}`, op: "list", limit: 5 },
      settings: [
        {
          name: "limit",
          type: "number",
          label: "Rows",
          defaultValue: defaultLimit,
        },
      ],
    },
    { source: "@test/settings" }
  );
}

describe.each(getConfiguredTestDialects())(
  "a card's settings reach its data (%s)",
  dialect => {
    let handle: TestNextly;
    /** The first account, a super-admin, who may read the notes. */
    let reader: string;
    let caller: ReadCaller;

    async function call(
      method: "GET" | "PUT",
      body?: unknown
    ): Promise<Response> {
      const token = await signAccessToken(
        buildClaims({
          userId: reader,
          email: `${reader}@example.com`,
          name: reader,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      const request = new Request("http://localhost/api/dashboard/layout", {
        method,
        headers: {
          cookie: `nextly_session=${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const context = {
        params: Promise.resolve({ params: ["dashboard", "layout"] }),
      };
      const handlers = createDynamicHandlers();
      return method === "GET"
        ? handlers.GET(request, context)
        : handlers.PUT(request, context);
    }

    async function read(): Promise<LayoutRead> {
      const res = await call("GET");
      expect(res.status).toBe(200);
      return (await res.json()) as LayoutRead;
    }

    /** Store `config` on the notes card as a setting changed at rest: not an arrangement. */
    async function choose(config: Record<string, unknown>): Promise<void> {
      const seen = await read();
      const res = await call("PUT", {
        placements: seen.placements.map(p =>
          p.widgetId === WIDGET ? { ...p, config } : p
        ),
        version: seen.version,
        scope: seen.scope,
        arranged: false,
      });
      expect(res.status).toBe(200);
    }

    /** How many rows the notes card is answered, as its stored settings and today's declaration ask. */
    async function rowsShown(): Promise<number> {
      const card = (await read()).placements.find(p => p.widgetId === WIDGET);
      expect(card).toBeDefined();
      const declared = getWidget(WIDGET)!;
      const query = applyWidgetSettings(
        declared.query as WidgetQuery,
        declared.settings,
        card!.config
      );
      const result = await executeWidgetQuery(
        validateWidgetQuery(query),
        caller
      );
      expect(result.op).toBe("list");
      return (result as { items: unknown[] }).items.length;
    }

    beforeAll(async () => {
      handle = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
        ],
      });
      const nextly = handle.nextly as unknown as {
        users: {
          create: (a: { data: Record<string, unknown> }) => Promise<{
            item: { id: string };
          }>;
        };
      };
      reader = (
        await nextly.users.create({
          data: {
            email: "reader@example.com",
            password: "Password123!",
            name: "Reader",
            isActive: true,
          },
        })
      ).item.id;
      caller = { user: { id: reader, roles: ["super-admin"] } };
      for (let i = 0; i < ROWS; i++) {
        await handle.nextly.create({
          collection: NOTES,
          data: { title: `Note ${i}` },
        });
      }
      // What the query endpoint does before resolving any query: publish the collection sources
      // from the live registry, which boot does not do.
      await refreshCollectionSources();
    }, 120_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    afterEach(async () => {
      if (getWidget(WIDGET)) deregisterWidget(WIDGET);
      // Each case starts from a reader who has changed nothing.
      const seen = await read();
      await call("PUT", {
        placements: seen.placements.map(({ config: _config, ...p }) => p),
        version: seen.version,
        scope: seen.scope,
        arranged: false,
      });
    });

    it("answers the card the number of rows its reader chose", async () => {
      declare(5);
      expect(await rowsShown()).toBe(5);
      await choose({ limit: 3 });
      expect(await rowsShown()).toBe(3);
      await choose({ limit: 8 });
      expect(await rowsShown()).toBe(8);
    });

    it("brings a default changed after the card was placed to a reader who never changed it", async () => {
      declare(5);
      expect(await rowsShown()).toBe(5);
      // The reader changed nothing, so nothing is stored, and the new default is what they see.
      declare(7);
      expect(await rowsShown()).toBe(7);
    });

    it("keeps a reader's own choice when the default changes after it", async () => {
      declare(5);
      await choose({ limit: 2 });
      declare(9);
      expect(await rowsShown()).toBe(2);
    });
  }
);
