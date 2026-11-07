/**
 * Deleting a collection takes its template, and its entries' own designs,
 * with it: listed first by the delete dialog's endpoint, then removed in the
 * delete's own transaction, through Nextly's own request handler as the
 * admin's Schema Builder makes both calls.
 *
 * The collection is created at runtime, as the Schema Builder creates one,
 * since a collection declared in code cannot be deleted from the admin. It
 * is created as in development, where the Builder builds its table, so its
 * entries can be written and given designs of their own.
 *
 * @module __tests__/template-collection-delete.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
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
import { afterEach, describe, expect, it, vi } from "vitest";

import { TEMPLATES_SLUG } from "../collections/templates";
import { pageBuilder } from "../plugin";

import { person, post, sessionOf } from "./transfer-harness";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

/** The collection created at runtime, and one kept beside it. */
const HOST = "tcd_articles";
const KEPT = "posts";

/** A call to Nextly's own API, as the admin makes it. */
async function api(
  cookie: string,
  method: "GET" | "POST" | "DELETE",
  path: readonly string[],
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const handlers = createDynamicHandlers();
  const request = new Request(`${ORIGIN}/api/${path.join("/")}`, {
    method,
    headers: {
      cookie: `${cookie}; nextly_csrf=${CSRF}`,
      "x-csrf-token": CSRF,
      origin: ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = { params: Promise.resolve({ params: [...path] }) };
  const response = await handlers[method](request, context);
  const text = await response.text();
  return {
    status: response.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

describe.each(getConfiguredTestDialects())(
  "deleting a collection with a template (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boot, sign in the site's owner, and create HOST as the Builder does. */
    async function boot(): Promise<{ t: TestNextly; cookie: string }> {
      const t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          // A collection may have a template when its entries have an
          // address: a `slug` text field.
          defineCollection({
            slug: KEPT,
            fields: [text({ name: "title" }), text({ name: "slug" })],
          }),
        ],
        seedPublic: true,
      });
      current = t;
      // The instance's first user is its super admin.
      const cookie = await sessionOf(t, await person(t, "owner"));
      // As in development, where the Builder builds the table at once; the
      // rest of the case runs as the suite does.
      vi.stubEnv("NODE_ENV", "development");
      try {
        const made = await api(cookie, "POST", ["collections"], {
          name: HOST,
          label: "Articles",
          fields: [
            { name: "title", type: "text" },
            { name: "slug", type: "text" },
          ],
        });
        expect(made.status).toBe(201);
      } finally {
        vi.unstubAllEnvs();
      }
      return { t, cookie };
    }

    /** The templates rows as stored, every state, by title. */
    async function templateTitles(t: TestNextly): Promise<string[]> {
      const found = await t.nextly.find({
        collection: TEMPLATES_SLUG,
        overrideAccess: true,
        status: "all",
        limit: 100,
      });
      return found.items.map(row => String(row.title)).sort();
    }

    it("lists the collection's template, then deletes it with the collection", async () => {
      const { t, cookie } = await boot();
      await t.nextly.create({
        collection: TEMPLATES_SLUG,
        data: { title: "Article page", collection: HOST },
        overrideAccess: true,
      });
      await t.nextly.create({
        collection: TEMPLATES_SLUG,
        data: { title: "Post page", collection: KEPT },
        overrideAccess: true,
      });

      const impact = await api(cookie, "GET", [
        "collections",
        "schema",
        HOST,
        "delete-impact",
      ]);
      expect(impact.status).toBe(200);
      const groups = impact.body.impact as {
        plugin: string;
        items: { label: string; kind: string }[];
      }[];
      expect(groups.flatMap(group => group.items)).toEqual([
        { label: "Article page", kind: "template" },
      ]);
      // Listing deleted nothing.
      expect(await templateTitles(t)).toEqual(["Article page", "Post page"]);

      const deleted = await api(cookie, "DELETE", ["collections", HOST]);
      expect(deleted.status).toBe(200);
      expect(await templateTitles(t)).toEqual(["Post page"]);
    });

    it("lists and deletes the entries' own designs with the collection", async () => {
      const { t, cookie } = await boot();
      const entry = await t.nextly.create({
        collection: HOST,
        data: { title: "Hello world", slug: "hello-world" },
        overrideAccess: true,
      });
      const act = (action: Record<string, unknown>) =>
        post(cookie, ["templates", "actions"], { action });
      expect(
        (
          await act({
            kind: "create-template",
            collection: HOST,
            publish: true,
          })
        ).status
      ).toBe(200);
      expect(
        (
          await act({
            kind: "give-entry-design",
            collection: HOST,
            entry: String(entry.item.id),
          })
        ).status
      ).toBe(200);

      const impact = await api(cookie, "GET", [
        "collections",
        "schema",
        HOST,
        "delete-impact",
      ]);
      const groups = impact.body.impact as {
        items: { label: string; kind: string }[];
      }[];
      const items = groups.flatMap(group => group.items);
      expect(items.map(item => item.kind).sort()).toEqual([
        "design",
        "template",
      ]);
      expect(items).toContainEqual({ label: "Hello world", kind: "design" });
      expect((await templateTitles(t)).length).toBe(2);

      const deleted = await api(cookie, "DELETE", ["collections", HOST]);
      expect(deleted.status).toBe(200);
      expect(await templateTitles(t)).toEqual([]);
    });
  }
);
