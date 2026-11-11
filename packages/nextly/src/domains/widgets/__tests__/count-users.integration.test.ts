/**
 * A Count card set to Users, through the real endpoints on every configured
 * dialect: who is offered Users, who may save a card set to it, and what the
 * card counts.
 *
 * What only the endpoints and a database can settle: the offer, the refusal
 * and the withholding follow the reader's real `read-users` verdict, a reader
 * without it is told the Count setting with no trace of Users, and the card
 * counts the accounts and those made this week on each dialect.
 *
 * @module domains/widgets/__tests__/count-users.integration.test
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
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
import { WidgetLayoutService } from "../../../services/widgets/widget-layout-service";
import { countWidget } from "../core-widgets/count";
import type { CountWidgetData } from "../core-widgets/data";
import { executeWidgetQuery } from "../execute";
import type { WidgetPlacement } from "../layout";
import { validateWidgetQuery } from "../query";
import { USERS_SOURCE_ID } from "../system-source-ids";

import { loadCard } from "./core-card-load";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Readable by everyone through its code-defined rule. */
const POSTS = "cu_posts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface LayoutRead {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
}

interface WorkspaceBody {
  widgets?: {
    id: string;
    settings?: { name: string; users?: unknown; defaultValue?: unknown }[];
  }[];
}

const card = (
  id: string,
  config: Record<string, unknown>
): WidgetPlacement => ({
  id,
  widgetId: "core/count",
  w: 3,
  h: 2,
  removed: false,
  config,
});

describe.each(getConfiguredTestDialects())(
  "a Count card set to Users (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    let admin: string;
    /** May read posts and users. */
    let peopleReader: string;
    /** May read posts, not users. */
    let postsReader: string;

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

    async function call(
      userId: string,
      method: "GET" | "PUT",
      path: string[],
      body?: unknown
    ): Promise<Response> {
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
      const request = new Request(`http://localhost/api/${path.join("/")}`, {
        method,
        headers: {
          cookie: `nextly_session=${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const context = { params: Promise.resolve({ params: path }) };
      const handlers = createDynamicHandlers();
      return method === "GET"
        ? handlers.GET(request, context)
        : handlers.PUT(request, context);
    }

    async function layout(userId: string): Promise<LayoutRead> {
      const res = await call(userId, "GET", ["dashboard", "layout"]);
      expect(res.status).toBe(200);
      return (await res.json()) as LayoutRead;
    }

    /** The Count declaration's Source setting, as the workspace payload tells it to `userId`. */
    async function sourceSetting(userId: string) {
      const res = await call(userId, "GET", ["admin-meta", "workspace"]);
      expect(res.status).toBe(200);
      const body = (await res.json()) as WorkspaceBody;
      const count = body.widgets?.find(widget => widget.id === "core/count");
      return count?.settings?.find(setting => setting.name === "collection");
    }

    function service(): WidgetLayoutService {
      return new WidgetLayoutService(handle.adapter, silent);
    }

    beforeAll(async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: POSTS,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      // The first account of an instance is its super admin.
      admin = await account("cu-admin@example.com");
      peopleReader = await account("cu-people@example.com");
      await grantTo(handle, peopleReader, "read", [POSTS, "users"]);
      postsReader = await account("cu-posts@example.com");
      await grantTo(handle, postsReader, "read", [POSTS]);
      // The admin joined a month ago; the two readers this week.
      await handle.adapter.update(
        "users",
        { created_at: new Date(Date.now() - 30 * DAY_MS) },
        { and: [{ column: "id", op: "=", value: admin }] }
      );
    }, 120_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    it("offers Users to a reader who may read users, and tells one who may not nothing of it", async () => {
      expect(await sourceSetting(peopleReader)).toMatchObject({
        name: "collection",
        users: true,
      });
      const told = await sourceSetting(postsReader);
      // The must-differ half: the same setting, without the offer.
      expect(told).toBeDefined();
      expect(told).not.toHaveProperty("users");
    });

    it("refuses a reader who may not read users a card set to Users, and stores nothing", async () => {
      const seen = await layout(postsReader);
      const res = await call(postsReader, "PUT", ["dashboard", "layout"], {
        placements: [
          ...seen.placements,
          card("people", { collection: "users" }),
        ],
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(400);
      const stored = await service().getLayout("user", postsReader);
      expect(
        (stored.layout?.placements ?? []).some(
          placement => placement.id === "people"
        )
      ).toBe(false);
    });

    it("saves the same card for a reader who may read users, and hands it back", async () => {
      const seen = await layout(peopleReader);
      const people = card("people", { collection: "users" });
      const res = await call(peopleReader, "PUT", ["dashboard", "layout"], {
        placements: [...seen.placements, people],
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      expect((await layout(peopleReader)).placements).toContainEqual(people);
    });

    it("withholds a stored card set to Users from a reader who may not read users, and keeps it in the row", async () => {
      const own = [
        card("posts", { collection: POSTS }),
        card("people", { collection: "users" }),
      ];
      const reader = await account("cu-later@example.com");
      await grantTo(handle, reader, "read", [POSTS]);
      await service().saveLayout("user", reader, own, 0);

      const seen = await layout(reader);
      expect(seen.placements.map(placement => placement.id)).toEqual([
        "posts",
      ]);
      // Their save carries the withheld card back in place.
      const res = await call(reader, "PUT", ["dashboard", "layout"], {
        placements: seen.placements,
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      expect((await service().getLayout("user", reader)).layout?.placements)
        .toEqual(own);
    });

    it("counts every account, and those made in the last 7 days", async () => {
      const total = await handle.adapter.count("users");
      const data = await loadCard<CountWidgetData>(
        countWidget,
        { collection: "users" },
        { user: { id: peopleReader } }
      );
      // Every account but the admin, who joined a month ago, is this week's.
      expect(data).toEqual({
        total,
        counted: "people",
        line: "change",
        change: total - 1,
      });
    });

    it("draws the people's trend ending at the number, and never a status split", async () => {
      const total = await handle.adapter.count("users");
      const trend = await loadCard<CountWidgetData>(
        countWidget,
        { collection: "users", show: "trend" },
        { user: { id: peopleReader } }
      );
      expect(trend.trend?.at(-1)).toBe(total);
      // Eight weeks back nobody had joined; the admin a month ago.
      expect(trend.trend?.[0]).toBe(0);
      expect(trend.trend).toContain(1);
      const split = await loadCard<CountWidgetData>(
        countWidget,
        { collection: "users", show: "split" },
        { user: { id: peopleReader } }
      );
      expect(split.line).toBe("change");
      expect(split.split).toBeUndefined();
    });

    it("answers a reader who may not read users as a source that does not exist", async () => {
      const ask = (userId: string) =>
        executeWidgetQuery(
          validateWidgetQuery({ source: USERS_SOURCE_ID, op: "count" }),
          { user: { id: userId } }
        );
      await expect(ask(peopleReader)).resolves.toMatchObject({ op: "count" });
      /** What a refusal says to its caller: nothing beyond its code and words. */
      const said = (error: unknown) => {
        const { code, statusCode, publicMessage } = error as {
          code?: unknown;
          statusCode?: unknown;
          publicMessage?: unknown;
        };
        return { code, statusCode, publicMessage };
      };
      const refused = await ask(postsReader).then(
        () => undefined,
        (error: unknown) => error
      );
      let missing: unknown;
      try {
        validateWidgetQuery({ source: "system:nowhere", op: "count" });
      } catch (error) {
        missing = error;
      }
      expect(refused).toBeDefined();
      expect(said(refused)).toEqual(said(missing));
    });
  }
);
