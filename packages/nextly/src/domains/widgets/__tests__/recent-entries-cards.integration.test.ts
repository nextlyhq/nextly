/**
 * Recent entries cards through the real layout endpoint, on every configured
 * dialect: a reader keeps one per collection, and another for the same
 * collection with other settings.
 *
 * What only the endpoint and a database can settle: the save is accepted, not
 * refused as a second card of a one-card widget, and every card comes back
 * with its own settings, stored as sent.
 *
 * @module domains/widgets/__tests__/recent-entries-cards.integration.test
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
import type { WidgetPlacement } from "../layout";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const POSTS = "re_posts";
const PAGES = "re_pages";

interface LayoutRead {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
}

/** A Recent entries card, set as `config` says. */
const recent = (
  id: string,
  config: Record<string, unknown>
): WidgetPlacement => ({
  id,
  widgetId: "core/recent-entries",
  width: "half",
  removed: false,
  config,
});

describe.each(getConfiguredTestDialects())(
  "Recent entries cards (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    let editor: string;

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

    beforeAll(async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: POSTS,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: PAGES,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      // The first account of an instance is its super admin; the editor is
      // the second, reading both collections through their rules.
      await account("re-admin@example.com");
      editor = await account("re-editor@example.com");
    }, 120_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    it("keeps one card per collection, and another for the same collection with other settings", async () => {
      const seenRes = await call(editor, "GET");
      expect(seenRes.status).toBe(200);
      const seen = (await seenRes.json()) as LayoutRead;
      const cards = [
        recent("posts-recent", { collection: POSTS }),
        // 🔴 Refused as a second card of the widget, a reader could not keep
        // a filtered list of a collection beside its plain one.
        recent("posts-news", {
          collection: POSTS,
          filter: { title: { contains: "news" } },
          sort: "title",
        }),
        recent("pages-recent", { collection: PAGES }),
      ];

      const res = await call(editor, "PUT", {
        placements: [...seen.placements, ...cards],
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);

      const stored = await new WidgetLayoutService(
        handle.adapter,
        silent
      ).getLayout("user", editor);
      expect(
        stored.layout?.placements.filter(
          placement => placement.widgetId === "core/recent-entries"
        )
      ).toEqual(cards);
    });
  }
);
