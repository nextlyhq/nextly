/**
 * The Pages panel's writes as an author reaches them: through core's request
 * handler, with a real API key per role, against a real database.
 *
 * The unit suites pin what the routes ask of the Direct API. This pins what
 * that asking MEANS — that a created page is a draft the search then lists,
 * that a duplicate is a draft "Copy of" its source under a slug of its own,
 * that a rename changes the title and nothing else, that a delete removes the
 * page, that a caller core denies delete is refused with the page left as it
 * was, and that a collection without a Page Builder field is never written.
 *
 * @module __tests__/pages-write.integration.test
 */

// Read once, when the harness validates its environment; API keys are signed
// with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  PAGES_SEARCH_ROUTE_PATH,
  type PageItem,
  type PagesSearchResponse,
} from "../pages-search-contract";
import {
  pageDuplicatePath,
  pagePath,
  PAGES_ROUTE_PATH,
} from "../pages-write-contract";
import { pageBuilder } from "../plugin";

/** The plugin's own page collection: Draft/Published, a unique slug. */
const PAGES = "pages";
/** A collection WITHOUT a Page Builder field, which every key may write. */
const NOTES = "notes";

const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

/** The Direct API calls this suite makes staff and content with, trusted. */
interface Direct {
  users: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  permissions: {
    find(args: {
      limit: number;
    }): Promise<{ items: { id: string; slug: string }[] }>;
  };
  roles: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<{ item: { id: string | number } }>;
  find(args: {
    collection: string;
    where?: Record<string, unknown>;
    status?: string;
  }): Promise<{ items: Record<string, unknown>[] }>;
}

interface ApiKeys {
  createApiKey(
    userId: string,
    input: {
      name: string;
      tokenType: string;
      roleId?: string;
      expiresIn: string;
    }
  ): Promise<{ key: string }>;
}

type Verb = "GET" | "POST" | "PATCH" | "DELETE";

/** One request to a plugin route through core's handler, as `key`. */
async function ask(
  method: Verb,
  path: string,
  key: string,
  body?: unknown
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const [pathname = "", search = ""] = path.split("?");
  const segments = [
    "plugins",
    ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
    ...pathname.slice(1).split("/").map(decodeURIComponent),
  ];
  const request = new Request(
    `http://localhost/api/${segments.map(encodeURIComponent).join("/")}${search === "" ? "" : `?${search}`}`,
    {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
  return handlers[method](request, {
    params: Promise.resolve({ params: segments }),
  });
}

/** The item of a write expected to succeed. */
async function written<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as { message: string; item: T };
  expect(typeof body.message).toBe("string");
  return body.item;
}

/** How many roles this file has made, for names that stay short. */
let rolesMade = 0;

describe.each(getConfiguredTestDialects())(
  "the Pages panel's writes (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    /** May read, create, update and delete pages, and write notes. */
    let editor = "";
    /** Everything the editor holds except deleting pages. */
    let noDelete = "";
    let noteId = "";

    /** One stored page, read trusted, by id. */
    async function stored(
      id: string
    ): Promise<Record<string, unknown> | undefined> {
      const found = await direct.find({
        collection: PAGES,
        where: { id: { equals: id } },
        status: "all",
      });
      return found.items[0];
    }

    /** What the search lists for `q`, as `key`. */
    async function searched(q: string, key: string): Promise<PageItem[]> {
      const response = await ask(
        "GET",
        `${PAGES_SEARCH_ROUTE_PATH}?${new URLSearchParams({ q }).toString()}`,
        key
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as PagesSearchResponse).items.slice();
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [notes],
        plugins: [pageBuilder()],
      });
      direct = t.nextly as unknown as Direct;

      // The first user is the super-admin every key is minted by; a key may
      // hold no more than its owner does.
      const owner = await direct.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await direct.permissions.find({ limit: 500 });

      /** A key whose role holds exactly the permissions named. */
      async function keyHolding(slugs: string[]): Promise<string> {
        // Numbered rather than spelled from the permissions, so the role's
        // name stays inside the roles table's length on Postgres and MySQL,
        // which refuse a longer one (SQLite doesn't check). Tagged by file,
        // so two files sharing a database never name the same role.
        rolesMade += 1;
        const roleTag = `pw-${rolesMade}`;
        const ids = slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined) {
            throw new Error(`${slug} is not seeded, so a role grants nothing`);
          }
          return found.id;
        });
        const role = await direct.roles.create({
          data: {
            name: `Role ${roleTag}`,
            slug: `r-${roleTag}`,
            permissionIds: ids,
          },
        });
        const keys = t.getService("apiKeyService") as unknown as ApiKeys;
        const { key } = await keys.createApiKey(owner.item.id, {
          name: `key ${slugs.join(" ")}`,
          tokenType: "role-based",
          roleId: role.item.id,
          expiresIn: "unlimited",
        });
        return key;
      }

      const writeNotes = ["create", "read", "update", "delete"].map(
        action => `${action}-${NOTES}`
      );
      noDelete = await keyHolding([
        `create-${PAGES}`,
        `read-${PAGES}`,
        `update-${PAGES}`,
        ...writeNotes,
      ]);
      editor = await keyHolding([
        `create-${PAGES}`,
        `read-${PAGES}`,
        `update-${PAGES}`,
        `delete-${PAGES}`,
        ...writeNotes,
      ]);
      noteId = String(
        (await direct.create({ collection: NOTES, data: { title: "A note" } }))
          .item.id
      );
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    describe("creating a page", () => {
      it("creates a draft with a slug from its title and an empty page document, which the search then lists", async () => {
        const item = await written<PageItem>(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: PAGES,
            title: "Fresh Page",
          })
        );

        expect(item).toMatchObject({
          collection: PAGES,
          collectionLabel: "Page",
          field: "content",
          title: "Fresh Page",
          status: "draft",
        });
        const row = await stored(item.id);
        expect(row).toMatchObject({ slug: "fresh-page", status: "draft" });
        expect(row?.content).toMatchObject({ kind: "page", nodes: [] });
        expect(
          (await searched("fresh page", editor)).map(found => found.id)
        ).toEqual([item.id]);
      });

      it("gives a second page of the same title a slug of its own", async () => {
        const first = await written<PageItem>(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: PAGES,
            title: "Twin",
          })
        );
        const second = await written<PageItem>(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: PAGES,
            title: "Twin",
          })
        );

        expect((await stored(first.id))?.slug).toBe("twin");
        expect((await stored(second.id))?.slug).toBe("twin-2");
      });
    });

    describe("duplicating a page", () => {
      it("makes a draft 'Copy of' it under a different slug, with its content", async () => {
        const original = String(
          (
            await direct.create({
              collection: PAGES,
              data: {
                title: "Origin",
                slug: "origin",
                status: "published",
                content: { formatVersion: 1, kind: "page", nodes: [] },
              },
            })
          ).item.id
        );

        const copy = await written<PageItem>(
          await ask(
            "POST",
            pageDuplicatePath({ collection: PAGES, id: original }),
            editor
          )
        );

        expect(copy).toMatchObject({
          title: "Copy of Origin",
          status: "draft",
        });
        expect(copy.id).not.toBe(original);
        const row = await stored(copy.id);
        expect(row).toMatchObject({ status: "draft", slug: "copy-of-origin" });
        expect(row?.slug).not.toBe((await stored(original))?.slug);
        // The original is untouched.
        expect(await stored(original)).toMatchObject({
          title: "Origin",
          status: "published",
        });
      });

      it("copies a page never published, as a draft of its own, when the caller may read it", async () => {
        // Core's duplicate reads its source as the caller's own read of it, so
        // a draft the caller can open is one it copies. The copy is a draft
        // under its own slug, and the draft it came from is untouched.
        const draft = await written<PageItem>(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: PAGES,
            title: "Unpublished",
          })
        );

        const copy = await written<PageItem>(
          await ask(
            "POST",
            pageDuplicatePath({ collection: PAGES, id: draft.id }),
            editor
          )
        );

        expect(copy).toMatchObject({
          title: "Copy of Unpublished",
          status: "draft",
        });
        expect(copy.id).not.toBe(draft.id);
        expect((await stored(copy.id))?.slug).not.toBe(
          (await stored(draft.id))?.slug
        );
        expect(await stored(draft.id)).toMatchObject({
          title: "Unpublished",
          status: "draft",
        });
      });
    });

    describe("renaming a page", () => {
      it("changes the title and nothing else", async () => {
        const page = await written<PageItem>(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: PAGES,
            title: "Old name",
          })
        );
        const before = await stored(page.id);

        const renamed = await written<PageItem>(
          await ask(
            "PATCH",
            pagePath({ collection: PAGES, id: page.id }),
            editor,
            {
              title: "  New name  ",
            }
          )
        );

        expect(renamed).toMatchObject({ id: page.id, title: "New name" });
        const after = await stored(page.id);
        expect(after?.title).toBe("New name");
        // The slug, the status and the content are what they were.
        expect({
          slug: after?.slug,
          status: after?.status,
          content: after?.content,
        }).toEqual({
          slug: before?.slug,
          status: before?.status,
          content: before?.content,
        });
      });
    });

    describe("renaming a published page", () => {
      it("keeps the new title as the page's working draft, as every save of a published page does", async () => {
        const id = String(
          (
            await direct.create({
              collection: PAGES,
              data: {
                title: "Live name",
                slug: "live-name",
                status: "published",
              },
            })
          ).item.id
        );

        const renamed = await written<PageItem>(
          await ask("PATCH", pagePath({ collection: PAGES, id }), editor, {
            title: "Next name",
          })
        );

        expect(renamed).toMatchObject({ id, title: "Next name" });
        // The live row keeps its title until the page is published, and the
        // search says the page holds changes.
        expect(await stored(id)).toMatchObject({
          title: "Live name",
          status: "published",
        });
        const [listed] = await searched("live name", editor);
        expect(listed).toMatchObject({ id, state: "changed" });
      });
    });

    describe("deleting a page", () => {
      it("removes it, and the search no longer lists it", async () => {
        const page = await written<PageItem>(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: PAGES,
            title: "Doomed page",
          })
        );

        const gone = await written<{ id: string; collection: string }>(
          await ask(
            "DELETE",
            pagePath({ collection: PAGES, id: page.id }),
            editor
          )
        );

        expect(gone).toEqual({ collection: PAGES, id: page.id });
        expect(await stored(page.id)).toBeUndefined();
        expect(await searched("doomed", editor)).toEqual([]);
      });

      it("refuses a caller core denies delete, and the page stays", async () => {
        const page = await written<PageItem>(
          await ask("POST", PAGES_ROUTE_PATH, noDelete, {
            collection: PAGES,
            title: "Kept page",
          })
        );

        const response = await ask(
          "DELETE",
          pagePath({ collection: PAGES, id: page.id }),
          noDelete
        );

        expect(response.status).toBe(403);
        expect(await stored(page.id)).toMatchObject({ title: "Kept page" });
      });
    });

    describe("a collection without a Page Builder field", () => {
      it("is refused for every write, though core would let this caller write it, and nothing changes", async () => {
        const at = { collection: NOTES, id: noteId };
        const responses = [
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: NOTES,
            title: "Sneaky",
          }),
          await ask("POST", pageDuplicatePath(at), editor),
          await ask("PATCH", pagePath(at), editor, { title: "Renamed note" }),
          await ask("DELETE", pagePath(at), editor),
        ];

        for (const response of responses) {
          expect(response.status).toBe(403);
          expect(await response.text()).not.toContain(NOTES);
        }
        const all = await direct.find({ collection: NOTES });
        expect(all.items.map(row => row.title)).toEqual(["A note"]);
      });

      it("CONTROL: core lets this caller write that collection, so the refusal is the route's", async () => {
        const handlers = createDynamicHandlers();
        const segments = ["collections", NOTES, "entries", noteId];
        const response = await handlers.PATCH(
          new Request(`http://localhost/api/${segments.join("/")}`, {
            method: "PATCH",
            headers: {
              authorization: `Bearer ${editor}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ title: "A note" }),
          }),
          { params: Promise.resolve({ params: segments }) }
        );
        expect(response.status, await response.clone().text()).toBe(200);
      });
    });
  }
);
