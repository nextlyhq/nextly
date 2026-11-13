/**
 * The admin's dashboard, list and edit screens read the registry once, and
 * then not again while it has not changed, on every dialect, through the real
 * catch-all handler.
 *
 * The registry's rows and listings (`dynamic_collections`, `dynamic_singles`,
 * `dynamic_components`) are cached under the database's stored count of
 * registry writes (`storedSchemaSeq`), not for a lifetime. So:
 * - after a warm-up, the requests those screens send read no registry row and
 *   no registry listing, even past the old one-second lifetime and past the
 *   interval the count is read at: only the count is read again;
 * - a change another copy of the app makes (a write this process's services
 *   never see, moving the count as every registry write does) is seen once
 *   this process reads the count again, and not before;
 * - a registry write made in this process is seen at once.
 *
 * The startup request is sent without its two paged lists (`/collections`
 * and `/singles` with a page and a size): those page, sort and count in the
 * database, as a list endpoint does, and are read on every request by design.
 */
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../__tests__/fixtures/permission-holders";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  relationship,
  text,
} from "../../config";
import { dispatchCollections } from "../../dispatcher/handlers/collection-dispatcher";
import { DynamicCollectionRegistryService } from "../../domains/dynamic-collections/services/dynamic-collection-registry-service";
import { storeSchemaVersion } from "../../domains/schema/schema-version";
import {
  SCHEMA_VERSION_READ_INTERVAL_MS,
  storedSchemaSeq,
} from "../../domains/schema/stored-schema-seq";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { ServiceContainer } from "../../services";
import type { Logger } from "../../shared/types";

const ORIGIN = "http://localhost";
const EDITOR = "registry-once-editor";
const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/** Every part of the admin's startup request but its two paged lists. */
const STARTUP = `/startup?${[
  "/auth/setup-status",
  "/auth/session",
  "/admin-meta",
  "/admin-meta/workspace",
  "/me",
  "/me/permissions",
  "/me/capabilities",
  "/general-settings",
]
  .map(path => `path=${encodeURIComponent(path)}`)
  .join("&")}`;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A real wait: the cache and the count are timed on the process's clock. */
const pause = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

async function sessionCookie(): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId: EDITOR,
      email: `${EDITOR}@example.test`,
      name: EDITOR,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

/** One admin request, as the signed-in editor, answered in full. */
async function send(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ status: number; text: string }> {
  const url = new URL(`${ORIGIN}/admin/api${path}`);
  const params = url.pathname
    .slice("/admin/api/".length)
    .split("/")
    .filter(Boolean);
  const headers: Record<string, string> = {
    origin: ORIGIN,
    cookie: await sessionCookie(),
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const handlers = createDynamicHandlers();
  const request = new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const context = { params: Promise.resolve({ params }) };
  const response =
    method === "GET"
      ? await handlers.GET(request, context)
      : await handlers.POST(request, context);
  return { status: response.status, text: await response.text() };
}

/** The statements of `calls` that read a registry table. */
function registryReads(
  calls: readonly RecordedStatement[]
): RecordedStatement[] {
  return calls.filter(call =>
    /\bfrom\s+["`]?(dynamic_collections|dynamic_singles|dynamic_components)["`]?/i.test(
      call.text
    )
  );
}

/** The statements of `calls` that read the stored schema version. */
function versionReads(
  calls: readonly RecordedStatement[]
): RecordedStatement[] {
  return calls.filter(call =>
    /^\s*select\b[\s\S]*\bfrom\s+["`]?nextly_meta["`]?/i.test(call.text)
  );
}

describe.each(getConfiguredTestDialects())(
  "the admin screens' registry reads (%s)",
  dialect => {
    async function boot(): Promise<{ t: TestNextly; postId: string }> {
      const t = (current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "authors",
            fields: [text({ name: "name" })],
          }),
          defineCollection({
            slug: "posts",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              relationship({ name: "author", relationTo: "authors" }),
              fieldGroup({ name: "card", component: "card" }),
            ],
          }),
        ],
        singles: [
          defineSingle({ slug: "home", fields: [text({ name: "heading" })] }),
        ],
        fieldGroups: [
          defineFieldGroup({
            slug: "card",
            fields: [text({ name: "heading" })],
          }),
        ],
      }));
      await superAdminUser(t, EDITOR);
      const author = await t.nextly.create({
        collection: "authors",
        data: { name: "Ana" },
      });
      const post = await t.nextly.create({
        collection: "posts",
        data: { title: "First", author: String(author.item.id) },
      });
      return { t, postId: String(post.item.id) };
    }

    /** The requests the dashboard, list and edit screens send, by name. */
    function screens(
      postId: string
    ): Array<[string, () => Promise<{ status: number; text: string }>]> {
      const layout = "/dashboard/layout?width=1304";
      const entry = `/collections/posts/entries/${postId}`;
      return [
        ["startup", () => send("GET", STARTUP)],
        ["dashboard layout", () => send("GET", layout)],
        [
          "dashboard query",
          async () => {
            const placed = JSON.parse((await send("GET", layout)).text) as {
              placements: { id: string; widgetId: string }[];
            };
            return send("POST", "/dashboard/query", {
              queries: placed.placements.map(card => ({
                widget: card.widgetId,
                card: card.id,
              })),
            });
          },
        ],
        ["collection", () => send("GET", "/collections/posts")],
        ["schema", () => send("GET", "/collections/schema/posts")],
        [
          "entries",
          () =>
            send(
              "GET",
              "/collections/posts/entries?page=1&limit=25&sortBy=createdAt&sortOrder=desc&status=all&count=capped"
            ),
        ],
        [
          "entry for the form",
          () =>
            send(
              "GET",
              `${entry}?depth=2&fallback-locale=none&draft=true&translation-status=1&status=all`
            ),
        ],
        [
          "entry",
          () =>
            send(
              "GET",
              `${entry}?depth=0&fallback-locale=none&draft=true&status=all`
            ),
        ],
        ["autosave", () => send("GET", `${entry}/versions/autosave`)],
      ];
    }

    it("after a warm-up, read no registry row or listing while the count stays, past the lifetime and the interval", async () => {
      const { t, postId } = await boot();
      for (const [name, run] of screens(postId)) {
        expect((await run()).status, name).toBe(200);
      }
      // Past the one-second lifetime rows were kept for, and past the
      // interval the count is read at.
      await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);

      const recorder = await recordStatements(t.adapter, dialect);
      const answered: Record<string, number> = {};
      try {
        for (const [name, run] of screens(postId)) {
          answered[name] = (await run()).status;
        }
      } finally {
        recorder.uninstall();
      }
      expect(Object.values(answered)).toEqual(
        Object.keys(answered).map(() => 200)
      );
      expect(
        registryReads(recorder.calls).map(call => call.text.slice(0, 160))
      ).toEqual([]);
      // The run went past the interval: the count was read again, and that
      // was all of the registry it asked about.
      expect(versionReads(recorder.calls).length).toBeGreaterThan(0);
    });

    it("sees a change another copy makes once the count is read again, and not before", async () => {
      const { t } = await boot();
      const registry = new DynamicCollectionRegistryService(t.adapter, silent);
      const listing = t.getService("collectionRegistryService") as {
        getAllCollectionsForRead(): Promise<
          { slug: string; description?: string | null }[]
        >;
      };
      const description = async () => ({
        row: (
          (await registry.getCollection("posts")) as {
            description?: string | null;
          }
        ).description,
        listed: (await listing.getAllCollectionsForRead()).find(
          collection => collection.slug === "posts"
        )?.description,
      });

      // The count read now, and the row and the listing cached under it.
      await storedSchemaSeq(t.adapter, { fresh: true });
      const before = await description();
      expect(before.row).not.toBe("Changed elsewhere");

      // Another copy's change: the row and the count in one transaction,
      // made past this process's registry services, so nothing here is
      // cleared or told.
      await t.adapter.transaction(async tx => {
        await tx.update(
          "dynamic_collections",
          { description: "Changed elsewhere" },
          { and: [{ column: "slug", op: "=", value: "posts" }] }
        );
        await storeSchemaVersion(tx.getDrizzle(), dialect, { wrote: true });
      });

      expect(await description()).toEqual(before);
      await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);
      expect(await description()).toEqual({
        row: "Changed elsewhere",
        listed: "Changed elsewhere",
      });
    });

    it("sees a registry write made in this process at once", async () => {
      const { t } = await boot();
      const registry = new DynamicCollectionRegistryService(t.adapter, silent);
      const slugs = t.getService("collectionRegistryService") as {
        getAllSlugs(): Promise<string[]>;
      };
      // Cached first, so a stale answer would be served if the write did not
      // clear what this process holds.
      await registry.getCollection("posts");
      expect(await slugs.getAllSlugs()).not.toContain("notes");

      const services = {} as ServiceContainer;
      await dispatchCollections(
        services,
        "updateCollection",
        { collectionName: "posts" },
        { description: "Changed here" }
      );
      await dispatchCollections(
        services,
        "createCollection",
        {},
        { name: "notes", label: "Notes", fields: [{ name: "x", type: "text" }] }
      );

      expect(
        (
          (await registry.getCollection("posts")) as {
            description?: string | null;
          }
        ).description
      ).toBe("Changed here");
      expect(await slugs.getAllSlugs()).toContain("notes");
    });
  }
);
