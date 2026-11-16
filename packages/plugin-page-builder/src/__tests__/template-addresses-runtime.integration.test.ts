/**
 * A collection's template address set at runtime, against a real instance:
 * stored on its template, set and changed only under the routing permission,
 * and moving its entries' address claims as it changes.
 *
 * The collections given an address here are declared in code without one,
 * which is how the page builder sees a collection made in the Schema Builder:
 * its address can only be the one its template stores. The browser suite
 * makes a collection in the Schema Builder itself.
 *
 * What separates a correct wiring from a plausible broken one:
 * - a person who may update templates but not change routing can neither set
 *   nor change an address through REST, the Direct API as that person, or the
 *   template action, while the rest of their save goes through;
 * - a person holding the permission can, through REST and the action;
 * - an entry saved after the address is set holds its address there, with no
 *   restart;
 * - an address change moves every entry's claim, frees the old paths for
 *   other documents, and leaves an entry whose new address a page holds
 *   waiting, reported in the action's answer;
 * - an address another collection holds, in code or on its template, and
 *   `/`, are refused, naming the other collection.
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
import { afterEach, describe, expect, it } from "vitest";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { TEMPLATES_SLUG } from "../collections/templates";
import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";
import type { TemplateActionResult } from "../templates/template-actions-contract";

import { holding, person, post } from "./transfer-harness";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

const PLAIN_PAGE = { formatVersion: 1, kind: "page", nodes: [] };
const TEMPLATE = { formatVersion: 1, kind: "template", nodes: [] };

/** May look after templates in every way but where they are served. */
const TEMPLATE_AUTHOR = [
  "read-templates",
  "create-templates",
  "update-templates",
  "publish-templates",
];

/** The same, and may change where a collection's entries are served. */
const ROUTING_AUTHOR = [...TEMPLATE_AUTHOR, "manage-template-routing"];

const idOf = (created: unknown): string =>
  String((created as { item: { id: unknown } }).item.id);

/** A REST update of an entry, made with a session cookie. */
async function patch(
  cookie: string,
  collection: string,
  id: string,
  body: Record<string, unknown>
): Promise<number> {
  const path = `collections/${collection}/entries/${id}`;
  const response = await createDynamicHandlers().PATCH(
    new Request(`${ORIGIN}/api/${path}`, {
      method: "PATCH",
      headers: {
        cookie: `${cookie}; nextly_csrf=${CSRF}`,
        "x-csrf-token": CSRF,
        origin: ORIGIN,
        "content-type": "application/json",
      },
      // Made whatever is stored: these tests are not about stale writes.
      body: JSON.stringify({ ...body, _overwrite: true }),
    }),
    { params: Promise.resolve({ params: path.split("/") }) }
  );
  await response.text();
  return response.status;
}

describe.each(getConfiguredTestDialects())(
  "template addresses set at runtime (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      const entries = (slug: string, singular: string) =>
        defineCollection({
          slug,
          labels: { singular, plural: `${singular}s` },
          status: true,
          fields: [
            text({ name: "title" }),
            text({ name: "slug", unique: true }),
          ],
        });
      current = await createTestNextly({
        dialect,
        plugins: [
          pageBuilder({ templates: { addresses: { posts: "/blog" } } }),
        ],
        collections: [
          entries("posts", "Post"),
          entries("events", "Event"),
          entries("news", "Story"),
        ],
        seedPublic: true,
      });
      // The instance's first user is its super admin, so it is made here and
      // never acts: every author below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    async function template(
      t: TestNextly,
      collection: string,
      address: string | null = null
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: TEMPLATES_SLUG,
          data: {
            title: collection,
            collection,
            content: TEMPLATE,
            status: "published",
            address,
          },
          overrideAccess: true,
        })
      );
    }

    async function entry(
      t: TestNextly,
      collection: string,
      slug: string
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection,
          data: { title: slug, slug, status: "published" },
          overrideAccess: true,
        })
      );
    }

    async function addressOf(t: TestNextly, id: string): Promise<unknown> {
      const row = (await t.nextly.findByID({
        collection: TEMPLATES_SLUG,
        id,
        overrideAccess: true,
        depth: 0,
      })) as unknown as Record<string, unknown>;
      return row.address;
    }

    /** Every claim row of `kinds`: its kind, path and holder, sorted. */
    async function held(
      t: TestNextly,
      kinds: readonly string[] = ["address"]
    ): Promise<string[]> {
      const found = await t.nextly.find({
        collection: ADDRESS_CLAIMS_SLUG,
        overrideAccess: true,
        depth: 0,
        limit: 200,
      });
      return (found.items as Record<string, unknown>[])
        .filter(row => kinds.includes(String(row.kind)))
        .map(
          row =>
            `${String(row.kind)} ${String(row.path)} ${String(row.holderCollection)}:${String(row.holderId)}`
        )
        .sort();
    }

    const act = (cookie: string, action: unknown, dryRun?: boolean) =>
      post(cookie, ["templates", "actions"], {
        action,
        ...(dryRun === undefined ? {} : { dryRun }),
      });

    it("lets nobody without the routing permission set or change an address, by REST, the Direct API or the action", async () => {
      const t = await boot();
      const events = await template(t, "events", "/events");
      const news = await template(t, "news");
      const author = await holding(t, TEMPLATE_AUTHOR);

      // Changing: the rest of the save goes through, the address does not.
      expect(
        await patch(author.cookie, TEMPLATES_SLUG, events, {
          title: "Renamed",
          address: "/happenings",
          status: "published",
        })
      ).toBe(200);
      expect(await addressOf(t, events)).toBe("/events");
      const renamed = (await t.nextly.findByID({
        collection: TEMPLATES_SLUG,
        id: events,
        overrideAccess: true,
        depth: 0,
      })) as unknown as Record<string, unknown>;
      expect(renamed.title).toBe("Renamed");

      // Setting one where there was none.
      await patch(author.cookie, TEMPLATES_SLUG, news, {
        address: "/news",
        status: "published",
      });
      expect(await addressOf(t, news)).toBeNull();

      // The Direct API, as that person.
      await t.nextly.update({
        collection: TEMPLATES_SLUG,
        id: events,
        // Made whatever is stored, as the REST updates above are.
        data: { address: "/elsewhere", status: "published", _overwrite: true },
        user: { id: author.id },
        overrideAccess: false,
      });
      expect(await addressOf(t, events)).toBe("/events");

      // The action asks for the permission before anything else.
      const refused = await act(author.cookie, {
        kind: "set-template-address",
        id: events,
        address: "/happenings",
      });
      expect(refused.status).toBe(403);
      expect(await addressOf(t, events)).toBe("/events");
      expect(await held(t)).toEqual([]);
    });

    it("lets a person holding the routing permission set and change an address, by REST and the action", async () => {
      const t = await boot();
      const events = await template(t, "events");
      const author = await holding(t, ROUTING_AUTHOR);

      const set = await act(author.cookie, {
        kind: "set-template-address",
        id: events,
        address: "/events",
      });
      expect(set.status).toBe(200);
      expect((set.body.item as TemplateActionResult).template).toMatchObject({
        id: events,
        address: "/events",
        status: "published",
      });
      expect(await addressOf(t, events)).toBe("/events");

      expect(
        await patch(author.cookie, TEMPLATES_SLUG, events, {
          address: "/happenings",
          status: "published",
        })
      ).toBe(200);
      expect(await addressOf(t, events)).toBe("/happenings");

      // Removing it, through the action, with an emptied value.
      const removed = await act(author.cookie, {
        kind: "set-template-address",
        id: events,
        address: "",
      });
      expect(removed.status).toBe(200);
      expect(await addressOf(t, events)).toBeNull();
    });

    it("serves entries at an address set after start, and moves them when it changes, freeing the old paths", async () => {
      const t = await boot();
      const events = await template(t, "events");
      const author = await holding(t, ROUTING_AUTHOR);
      await act(author.cookie, {
        kind: "set-template-address",
        id: events,
        address: "/events",
      });

      // Saved after the address was set: held there, with no restart.
      const launch = await entry(t, "events", "launch");
      const party = await entry(t, "events", "party");
      expect(await held(t)).toEqual([
        `address /events/launch events:${launch}`,
        `address /events/party events:${party}`,
      ]);
      const content = pageBuilderContent({ nextly: t.nextly as never });
      expect(await content.resolveAddress(undefined, "/events/launch")).toEqual(
        { collection: "events", id: launch, kind: "address" }
      );

      // A page already at one of the new addresses keeps it.
      const taken = idOf(
        await t.nextly.create({
          collection: "pages",
          data: {
            title: "Party",
            slug: "happenings/party",
            content: PLAIN_PAGE,
            status: "published",
          },
          overrideAccess: true,
        })
      );

      const moved = await act(author.cookie, {
        kind: "set-template-address",
        id: events,
        address: "/happenings",
      });
      expect(moved.status).toBe(200);
      expect((moved.body.item as TemplateActionResult).waiting).toBe(1);
      expect(await held(t)).toEqual([
        `address /happenings/launch events:${launch}`,
        `address /happenings/party pages:${taken}`,
      ]);
      expect(await held(t, ["waiting"])).toEqual([
        `waiting /happenings/party events:${party}`,
      ]);
      expect(
        await content.resolveAddress(undefined, "/events/launch")
      ).toBeNull();
      expect(
        await content.resolveAddress(undefined, "/happenings/launch")
      ).toEqual({ collection: "events", id: launch, kind: "address" });

      // The old path is free for another document.
      const reused = idOf(
        await t.nextly.create({
          collection: "pages",
          data: {
            title: "Launch",
            slug: "events/launch",
            content: PLAIN_PAGE,
            status: "published",
          },
          overrideAccess: true,
        })
      );
      expect(await content.resolveAddress(undefined, "/events/launch")).toEqual(
        { collection: "pages", id: reused, kind: "address" }
      );
    });

    it("refuses an address another collection holds, in code or on its template, and the site's root, naming the other collection", async () => {
      const t = await boot();
      const events = await template(t, "events", "/events");
      const news = await template(t, "news");
      const author = await holding(t, ROUTING_AUTHOR);

      const messages = async (address: string): Promise<string[]> => {
        const answered = await act(
          author.cookie,
          { kind: "set-template-address", id: news, address },
          true
        );
        expect(answered.status).toBe(200);
        return [...(answered.body.item as TemplateActionResult).refusals];
      };
      expect(await messages("/blog")).toEqual([
        '"/blog" is the address the collection "posts" is given in code. Each collection needs an address of its own.',
      ]);
      expect(await messages("/events")).toEqual([
        '"/events" is already the address of the collection "events". Each collection needs an address of its own.',
      ]);
      expect(await messages("/")).toEqual([
        expect.stringMatching(/site's root/),
      ]);

      // The guard on the write says the same, by REST.
      expect(
        await patch(author.cookie, TEMPLATES_SLUG, news, {
          address: "/events",
          status: "published",
        })
      ).toBe(400);
      expect(await addressOf(t, news)).toBeNull();
      expect(await addressOf(t, events)).toBe("/events");
    });
  }
);
