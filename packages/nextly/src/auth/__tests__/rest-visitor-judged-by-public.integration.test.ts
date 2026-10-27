/**
 * A visitor over REST is judged by the Public role, and given what the
 * website gives it.
 *
 * A request carrying no credential is a visitor. The collection and Single
 * routes ask the one decision for it, as a checked Direct API call and a
 * content route do: it may read or write what the Public role holds, where
 * the target's rule (if it names the action) answers `true`. Without the
 * permission it is asked to sign in (401), and a rule that refuses it is a
 * 403. It reads published content only, and never reads a version.
 *
 * Each read is asked of REST and of the website (`createContentRoute`, which
 * reads as the same visitor) with the same entries, so the two ways in are
 * held to one answer.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantPublic } from "../../__tests__/helpers/public-role";
import { defineCollection, defineSingle, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { createContentRoute } from "../../runtime/routing/content-route";
import type { ContentEntry } from "../../runtime/routing/resolve-content";

const ORIGIN = "http://localhost";

/** Read by anyone: boot grants the Public role its read. */
const OPEN = "rv_open";
/** No read rule: a visitor reads it only once Public is granted the read. */
const RULELESS = "rv_ruleless";
/** Its read rule refuses everyone, whatever Public holds. */
const CLOSED = "rv_closed";
/** Anyone may create by its rule; Public holds the create only once granted. */
const INBOX = "rv_inbox";
/** A Single anyone may read. */
const NOTICE = "rv_notice";

type Method = "GET" | "POST";

/** A REST request with no credential, as a visitor's browser sends it. */
function visit(
  method: Method,
  segments: string[],
  { search = "", body }: { search?: string; body?: unknown } = {}
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const req = new Request(`${ORIGIN}/api/${segments.join("/")}${search}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return handlers[method](req, {
    params: Promise.resolve({ params: segments }),
  });
}

async function titlesOver(res: Response): Promise<string[]> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Array<{ title?: unknown }> };
  return body.items.map(item => String(item.title)).sort();
}

describe.each(getConfiguredTestDialects())(
  "a visitor over REST is judged by the Public role (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let publishedId = "";
    let draftId = "";

    /** The website's answer for a slug: the entry's title, or a 404. */
    async function website(slug: string): Promise<string> {
      const route = createContentRoute({
        collections: [OPEN],
        nextly: t.nextly,
        render: (entry: ContentEntry) => entry,
      });
      try {
        const page = (await route.ContentPage({
          params: { slug: [slug] },
        })) as ContentEntry;
        return String(page.title);
      } catch (error) {
        if (String(error).includes("NEXT_HTTP_ERROR_FALLBACK;404")) {
          return "404";
        }
        throw error;
      }
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // The boot's seeding, which makes the Public role and grants it the
        // read of `rv_open` and `rv_notice`, whose read rules answer `true`.
        seedPublic: true,
        collections: [
          defineCollection({
            slug: OPEN,
            status: true,
            // Versioned, so the versions route has a history to refuse.
            versions: { drafts: true },
            access: { read: () => true },
            fields: [text({ name: "slug" }), text({ name: "title" })],
          }),
          defineCollection({
            slug: RULELESS,
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: CLOSED,
            access: { read: () => false },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: INBOX,
            access: { create: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: NOTICE,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const published = await t.nextly.create({
        collection: OPEN,
        data: { slug: "live", title: "Live", status: "published" },
      } as never);
      publishedId = String((published.item as { id: string | number }).id);
      const draft = await t.nextly.create({
        collection: OPEN,
        data: { slug: "unreleased", title: "Unreleased", status: "draft" },
      } as never);
      draftId = String((draft.item as { id: string | number }).id);
      await t.nextly.create({
        collection: RULELESS,
        data: { title: "kept" },
      } as never);
      await t.nextly.create({
        collection: CLOSED,
        data: { title: "sealed" },
      } as never);
      await t.nextly.updateSingle({
        slug: NOTICE,
        data: { title: "Opening hours" },
      } as never);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("lists what the website shows, published only, whatever status it asks", async () => {
      const listed = await titlesOver(
        await visit("GET", ["collections", OPEN, "entries"], {
          search: "?status=all",
        })
      );
      expect(listed).toEqual(["Live"]);
      expect(await website("live")).toBe("Live");
      expect(await website("unreleased")).toBe("404");
    });

    it("reads a published entry by id, and not a draft, as the website does", async () => {
      const live = await visit("GET", [
        "collections",
        OPEN,
        "entries",
        publishedId,
      ]);
      expect(live.status).toBe(200);
      expect(((await live.json()) as { title?: unknown }).title).toBe("Live");

      const draft = await visit(
        "GET",
        ["collections", OPEN, "entries", draftId],
        {
          search: "?status=all",
        }
      );
      expect(draft.status).toBe(404);
    });

    it("counts what it may list", async () => {
      const res = await visit("GET", ["collections", OPEN, "entries", "count"]);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { total?: unknown }).total).toBe(1);
    });

    it("reads a Single anyone may read", async () => {
      const res = await visit("GET", ["singles", NOTICE]);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { title?: unknown }).title).toBe(
        "Opening hours"
      );
    });

    it("is asked to sign in where Public lacks the read, and reads once it holds it", async () => {
      const before = await visit("GET", ["collections", RULELESS, "entries"]);
      expect(before.status).toBe(401);
      // Granted as a site admin would grant it: only what Public holds
      // differs between the two requests.
      await grantPublic(t, [`read-${RULELESS}`]);
      expect(
        await titlesOver(
          await visit("GET", ["collections", RULELESS, "entries"])
        )
      ).toEqual(["kept"]);
    });

    it("is refused 403 where Public holds the read and the rule refuses", async () => {
      await grantPublic(t, [`read-${CLOSED}`]);
      const res = await visit("GET", ["collections", CLOSED, "entries"]);
      expect(res.status).toBe(403);
    });

    it("creates where the rule answers true only once Public holds the create", async () => {
      const before = await visit("POST", ["collections", INBOX, "entries"], {
        body: { title: "first" },
      });
      expect(before.status).toBe(401);
      await grantPublic(t, [`create-${INBOX}`]);
      const after = await visit("POST", ["collections", INBOX, "entries"], {
        body: { title: "second" },
      });
      expect(after.status).toBe(201);
      const stored = await t.nextly.find({ collection: INBOX } as never);
      expect(
        (stored.items as Array<{ title?: unknown }>).map(item => item.title)
      ).toEqual(["second"]);
    });

    it("never reads an entry's versions, though Public holds its read", async () => {
      const res = await visit("GET", [
        "collections",
        OPEN,
        "entries",
        publishedId,
        "versions",
      ]);
      expect(res.status).toBe(401);
    });
  }
);
