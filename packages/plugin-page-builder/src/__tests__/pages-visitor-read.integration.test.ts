/**
 * A visitor reads a published page, and nothing of a page that is not.
 *
 * A site serves its pages to people who are not signed in, through a route
 * that reads as they would (`createBlocksPage`, `createContentRoute`) and
 * through REST. Such a visitor is judged by the Public role, which boot grants
 * a collection's read only where the collection's read rule answers `true`.
 * `pages` declares that rule, so a published page reaches a visitor; the
 * visitor's read is held to published content whatever it asks for, so a
 * draft page, and the working draft of a published page, never do.
 *
 * Each read is asked of REST, of a checked Direct API call and of the website,
 * with the same pages, so the three ways a visitor arrives are held to one
 * answer. A signed-in read of everything is the control: the drafts exist, so
 * a visitor not seeing them is the bound working, not an empty table.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createContentRoute, createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const PAGES = "pages";

type Doc = Record<string, unknown>;

/** A REST read with no credential, as a visitor's browser sends it. */
function visit(segments: string[], search = ""): Promise<Response> {
  const handlers = createDynamicHandlers();
  const req = new Request(`${ORIGIN}/api/${segments.join("/")}${search}`, {
    method: "GET",
    headers: { origin: ORIGIN },
  });
  return handlers.GET(req, { params: Promise.resolve({ params: segments }) });
}

const idOf = (created: unknown) =>
  String((created as { item: { id: string | number } }).item.id);

describe.each(getConfiguredTestDialects())(
  "a visitor reads published pages only (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let liveId = "";
    let draftId = "";

    /** The website's answer for a slug: the page's title, or a 404. */
    async function website(slug: string): Promise<string> {
      const route = createContentRoute({
        collections: [PAGES],
        nextly: t.nextly,
        render: (entry: Doc) => entry,
      });
      try {
        const page = (await route.ContentPage({
          params: { slug: [slug] },
        })) as Doc;
        return String(page.title);
      } catch (error) {
        if (String(error).includes("NEXT_HTTP_ERROR_FALLBACK;404")) {
          return "404";
        }
        throw error;
      }
    }

    /** A checked Direct API read: no user, so the visitor is asking. */
    const asVisitor = { overrideAccess: false, user: undefined };

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // The boot's seeding: the Public role, and its read of each collection
        // whose read rule answers a visitor `true`.
        seedPublic: true,
        plugins: [pageBuilder()],
      });

      liveId = idOf(
        await t.nextly.create({
          collection: PAGES,
          data: { title: "Live", slug: "live", status: "published" },
        } as never)
      );
      // An edit kept as the published page's working draft: the live row
      // still holds "Live" until the edit is published.
      await t.nextly.update({
        collection: PAGES,
        id: liveId,
        data: { title: "Pending edit" },
        draft: true,
      } as never);
      draftId = idOf(
        await t.nextly.create({
          collection: PAGES,
          data: { title: "Unreleased", slug: "unreleased", status: "draft" },
        } as never)
      );
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("the control: a signed-in read sees the draft page and the pending edit", async () => {
      const all = await t.nextly.find({
        collection: PAGES,
        status: "all",
      } as never);
      expect(
        ((all as { items: Doc[] }).items ?? []).map(page => page.title).sort()
      ).toEqual(["Live", "Unreleased"]);
      const pending = (await t.nextly.findByID({
        collection: PAGES,
        id: liveId,
        draft: true,
      } as never)) as Doc;
      expect(pending.title).toBe("Pending edit");
    });

    it("serves a published page to a visitor, on the website, over REST and through the Direct API", async () => {
      expect(await website("live")).toBe("Live");

      // What a visitor is handed of a page, pinned: the page's own fields and
      // its dates, and nothing naming a person, a lock or a note. A column
      // that starts reaching visitors fails here, so whether it should is
      // decided rather than inherited.
      const one = await visit(["collections", PAGES, "entries", liveId]);
      expect(one.status).toBe(200);
      expect(Object.keys((await one.json()) as Doc).sort()).toEqual([
        "content",
        "createdAt",
        "firstPublishedAt",
        "id",
        "slug",
        "status",
        "title",
        "updatedAt",
      ]);

      const listed = await visit(["collections", PAGES, "entries"]);
      expect(listed.status).toBe(200);
      expect(
        ((await listed.json()) as { items: Doc[] }).items.map(
          page => page.title
        )
      ).toEqual(["Live"]);

      const found = await t.nextly.find({
        collection: PAGES,
        ...asVisitor,
      } as never);
      expect(
        ((found as { items: Doc[] }).items ?? []).map(page => page.title)
      ).toEqual(["Live"]);
    });

    it("shows a visitor nothing of a draft page, whatever status it asks for", async () => {
      expect(await website("unreleased")).toBe("404");

      for (const status of ["all", "draft"]) {
        const listed = await visit(
          ["collections", PAGES, "entries"],
          `?status=${status}`
        );
        expect(listed.status).toBe(200);
        expect(
          ((await listed.json()) as { items: Doc[] }).items.map(
            page => page.title
          )
        ).toEqual(status === "all" ? ["Live"] : []);
      }
      const byId = await visit(
        ["collections", PAGES, "entries", draftId],
        "?status=all"
      );
      expect(byId.status).toBe(404);

      await expect(
        t.nextly.findByID({
          collection: PAGES,
          id: draftId,
          status: "all",
          ...asVisitor,
        } as never)
      ).rejects.toBeTruthy();
    });

    it("shows a visitor a published page as published, not its pending edit", async () => {
      const byId = await visit(
        ["collections", PAGES, "entries", liveId],
        "?draft=true"
      );
      expect(byId.status).toBe(200);
      expect(((await byId.json()) as Doc).title).toBe("Live");

      const direct = (await t.nextly.findByID({
        collection: PAGES,
        id: liveId,
        draft: true,
        ...asVisitor,
      } as never)) as Doc;
      expect(direct.title).toBe("Live");

      // Nor its history, where the pending edit is kept.
      const versions = await visit([
        "collections",
        PAGES,
        "entries",
        liveId,
        "versions",
      ]);
      expect(versions.status).toBe(401);
    });
  }
);
