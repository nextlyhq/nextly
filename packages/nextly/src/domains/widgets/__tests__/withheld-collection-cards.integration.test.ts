/**
 * Cards set to a collection, through the real layout endpoint on every
 * configured dialect: what each reader is handed, and what their save stores.
 *
 * What only the endpoint and a database can settle: the withholding follows
 * the reader's real access, a collection they may not read is never named to
 * them, and a save keeps that collection's card in the row for the day they may
 * read it.
 *
 * @module domains/widgets/__tests__/withheld-collection-cards.integration.test
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
import { MAX_PLACEMENTS, type WidgetPlacement } from "../layout";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Readable by everyone through its code-defined rule. */
const POSTS = "cv_blog_posts";
/** No rule: only the super admin may read it. */
const SECRET = "cv_secret";
/** Two collections whose slugs spell one generated id, so neither gets generated cards. */
const TWIN_UNDERSCORE = "cv_twin";
const TWIN_HYPHEN = "cv-twin";

interface LayoutRead {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
}

const card = (
  id: string,
  widgetId: string,
  patch: Partial<WidgetPlacement> = {}
): WidgetPlacement => ({
  id,
  widgetId,
  w: 3,
  h: 2,
  removed: false,
  ...patch,
});

describe.each(getConfiguredTestDialects())(
  "cards set to a collection the reader may not read (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    let admin: string;

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

    async function read(userId: string): Promise<LayoutRead> {
      const res = await call(userId, "GET");
      expect(res.status).toBe(200);
      return (await res.json()) as LayoutRead;
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
          defineCollection({ slug: SECRET, fields: [text({ name: "title" })] }),
          defineCollection({
            slug: TWIN_UNDERSCORE,
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: TWIN_HYPHEN,
            fields: [text({ name: "title" })],
          }),
        ],
      });
      // The first account of an instance is its super admin.
      admin = await account("cv-admin@example.com");
    }, 120_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    it("shows a Count card set to either of two readable collections whose slugs collide", async () => {
      // 🔴 Judged by the reader's verdict on each collection, not read off the
      // generated cards, which the collision drops for both: read that way,
      // a card set to either was withheld as one they may not read.
      const reader = await account("cv-twins@example.com");
      await grantTo(handle, reader, "read", [TWIN_UNDERSCORE, TWIN_HYPHEN]);
      const own = [
        card("under", "core/count", {
          config: { collection: TWIN_UNDERSCORE },
        }),
        card("hyphen", "core/count", { config: { collection: TWIN_HYPHEN } }),
      ];
      await service().saveLayout("user", reader, own, 0);
      const seen = await read(reader);
      expect(seen.placements).toEqual(own);
      // The must-differ half: a reader who may read only one is shown only it.
      const half = await account("cv-one-twin@example.com");
      await grantTo(handle, half, "read", [TWIN_UNDERSCORE]);
      await service().saveLayout("user", half, own, 0);
      expect((await read(half)).placements).toEqual([own[0]]);
    });

    it("withholds a Count card set to a collection the reader may not read, and keeps it in the row", async () => {
      const own = [
        card("mine", "core/count", { config: { collection: POSTS } }),
        card("theirs", "core/count", { config: { collection: SECRET } }),
        card("old", "core/count", { config: { collection: "cv_deleted" } }),
      ];
      const reader = await account("cv-reader@example.com");
      // The permission comes before the posts' code rule, which only narrows it.
      await grantTo(handle, reader, "read", [POSTS]);
      await service().saveLayout("user", reader, own, 0);

      const seen = await read(reader);
      // 🔴 Handed over, the card's settings would name the collection. And
      // the one set to a collection that does not exist is withheld the same
      // way: drawn instead, it would tell the reader which names exist.
      expect(seen.placements.map(placement => placement.id)).toEqual(["mine"]);
      expect(JSON.stringify(seen)).not.toMatch(/cv[-_]secret/);

      const res = await call(reader, "PUT", {
        placements: seen.placements,
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      const stored = await service().getLayout("user", reader);
      expect(stored.layout?.placements).toEqual(own);
    });

    it("withholds a Recent entries, Over time or Breakdown card set to a collection the reader may not read, as it does a Count card", async () => {
      // Every widget offered per collection reads the collection its
      // Collection setting names, so the same rule withholds each, not Count's
      // cards alone.
      const own = [
        card("recent", "core/recent-entries", {
          config: { collection: POSTS },
        }),
        card("recent-theirs", "core/recent-entries", {
          config: { collection: SECRET },
        }),
        card("over-theirs", "core/over-time", {
          config: { collection: SECRET },
        }),
        card("breakdown-theirs", "core/breakdown", {
          config: { collection: SECRET },
        }),
      ];
      const reader = await account("cv-lister@example.com");
      // The permission comes before the posts' code rule, which only narrows it.
      await grantTo(handle, reader, "read", [POSTS]);
      await service().saveLayout("user", reader, own, 0);

      const seen = await read(reader);
      expect(seen.placements.map(placement => placement.id)).toEqual([
        "recent",
      ]);
      expect(JSON.stringify(seen)).not.toMatch(/cv[-_]secret/);

      // Their save carries every withheld card back in place.
      const res = await call(reader, "PUT", {
        placements: seen.placements,
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      const stored = await service().getLayout("user", reader);
      expect(stored.layout?.placements).toEqual(own);
    });

    it("refuses a card set to a collection the reader may not read, whether it exists or not, with one answer", async () => {
      const reader = await account("cv-guesser@example.com");
      const seen = await read(reader);
      const attempt = async (collection: string) => {
        const res = await call(reader, "PUT", {
          placements: [
            ...seen.placements,
            card("guess", "core/count", { config: { collection } }),
          ],
          version: seen.version,
          scope: seen.scope,
        });
        const body = (await res.json()) as {
          error?: { code?: string; message?: string; data?: unknown };
        };
        return {
          status: res.status,
          code: body.error?.code,
          message: body.error?.message,
          data: body.error?.data,
        };
      };
      const existing = await attempt(SECRET);
      const missing = await attempt("cv_nowhere");
      // 🔴 Refused, and refused identically: a write that answered the two
      // differently would tell the reader which names exist.
      expect(existing.status).toBe(400);
      expect(missing).toEqual(existing);
      expect(JSON.stringify(existing)).not.toMatch(/cv[-_]secret/);
      // Nothing was stored for either.
      const stored = await service().getLayout("user", reader);
      expect(
        (stored.layout?.placements ?? []).some(
          placement => placement.id === "guess"
        )
      ).toBe(false);
    });

    it("lets a reader add a card whatever number of withheld cards their row carries out of view", async () => {
      // 🔴 Kept and hidden, a card of a widget nobody declares must never cost
      // the reader an add: the payload limit counts what they submit, and the
      // row's own ceiling drops carried cards rather than refusing, so neither
      // answer depends on cards they cannot see.
      const reader = await account("cv-hoarder@example.com");
      await grantTo(handle, reader, "read", [POSTS]);
      // A plugin's cards the install does not have now: carried, not dropped,
      // so the row keeps every one of them out of view.
      const hidden = Array.from({ length: MAX_PLACEMENTS }, (_, i) =>
        card(`gone${i}`, `acme/cv-gone-${i}`)
      );
      await service().saveLayout("user", reader, hidden, 0);
      const seen = await read(reader);
      expect(seen.placements).toEqual([]);

      const added = card("posts", "core/count", {
        config: { collection: POSTS },
      });
      const res = await call(reader, "PUT", {
        placements: [added],
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      const stored = await service().getLayout("user", reader);
      expect(stored.layout?.placements).toEqual([...hidden, added]);
    });

    it("hands the same card to a reader who may read its collection", async () => {
      const own = [
        card("secret", "core/count", { config: { collection: SECRET } }),
      ];
      await service().saveLayout("user", admin, own, 0);

      const seen = await read(admin);
      expect(
        seen.placements.filter(placement => placement.id === "secret")
      ).toEqual(own);
    });
  }
);
