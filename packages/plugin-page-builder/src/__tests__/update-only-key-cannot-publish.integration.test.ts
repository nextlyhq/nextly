/**
 * A caller who may update the page builder's documents but not publish them
 * saves drafts and is refused every way of putting one live.
 *
 * Pages, components and Layouts each have their own publish grant, separate
 * from update, so a site can let an author prepare a page that someone else
 * puts live. That separation is only real if no write path publishes on the
 * update grant alone: a status-only body, a status sent beside content, a
 * create, either bulk update, or one of this plugin's own routes, which write
 * on the caller's behalf. Each is asked here with a role-based API key, the
 * caller most likely to be handed to a script, and each refusal is checked
 * against what is stored afterwards, not only the response.
 *
 * A key that holds publish makes the same requests and succeeds, so each
 * refusal is the missing grant and not a malformed request.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { PATTERNS_SLUG } from "../collections/patterns";
import {
  PAGE_BUILDER_PLUGIN_NAME,
  SAVE_PATTERN_ROUTE_PATH,
} from "../library-contract";
import { pageBuilder } from "../plugin";

/** The Direct API calls this suite makes staff and content with. */
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
    status?: "all";
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

const ORIGIN = "http://localhost";

/** The documents an author prepares and someone with publish puts live. */
const HOSTS = [PAGES_SLUG, COMPONENTS_SLUG, LAYOUTS_SLUG] as const;
type Host = (typeof HOSTS)[number];

/** Every grant an author needs to prepare those documents and save patterns. */
const AUTHORING = [...HOSTS, PATTERNS_SLUG].flatMap(slug => [
  `create-${slug}`,
  `read-${slug}`,
  `update-${slug}`,
]);

/** The publish grants the author's key lacks and the publisher's holds. */
const PUBLISHING = [...HOSTS, PATTERNS_SLUG].map(slug => `publish-${slug}`);

/** One request through the REST catch-all, as a site's script sends it. */
function rest(
  method: "POST" | "PATCH",
  path: string,
  key: string,
  body: unknown
): Promise<Response> {
  const segments = path.split("/").filter(Boolean);
  const request = new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  return createDynamicHandlers()[method](request, {
    params: Promise.resolve({ params: segments }),
  });
}

/** A page document holding one box, for a pattern saved from it. */
const PAGE_DOCUMENT = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [{ id: "box", type: "core/box", version: 1, props: {} }],
};

describe.each(getConfiguredTestDialects())(
  "an update-only key and publishing (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    /** Creates, reads and updates every page-builder document; publishes none. */
    let author = "";
    /** The same grants, and publish on each. */
    let publisher = "";
    let made = 0;

    /** A fresh draft of `host`, made as the system. */
    async function draftOf(host: Host): Promise<string> {
      made += 1;
      const created = await direct.create({
        collection: host,
        data: {
          title: `${host} ${String(made)}`,
          slug: `${host}-${String(made)}`,
          status: "draft",
        },
      });
      return String(created.item.id);
    }

    /** What `host` stores for `id`: its status and title, any language. */
    async function storedRow(
      host: Host,
      id: string
    ): Promise<{ status: unknown; title: unknown } | undefined> {
      const found = await direct.find({
        collection: host,
        where: { id: { equals: id } },
        status: "all",
      });
      const row = found.items[0];
      return row && { status: row.status, title: row.title };
    }

    /** The rows of `host` titled `title`, whatever their status. */
    async function titled(host: Host | typeof PATTERNS_SLUG, title: string) {
      const found = await direct.find({
        collection: host,
        where: { title: { equals: title } },
        status: "all",
      });
      return found.items;
    }

    beforeAll(async () => {
      // A refused write is logged by the gate that refuses it.
      vi.spyOn(console, "error").mockImplementation(() => {});
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [pageBuilder()],
      });
      direct = t.nextly as unknown as Direct;

      // The first user is the super-admin each key is minted by; a key holds
      // its role, never its owner's rights.
      const owner = await direct.users.create({
        data: {
          email: "owner@update-only.test",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await direct.permissions.find({ limit: 1000 });

      async function keyHolding(name: string, slugs: string[]) {
        const ids = slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined) {
            throw new Error(`${slug} is not seeded, so a role grants nothing`);
          }
          return found.id;
        });
        const role = await direct.roles.create({
          data: { name, slug: name, permissionIds: ids },
        });
        const keys = t.getService("apiKeyService") as unknown as ApiKeys;
        const { key } = await keys.createApiKey(owner.item.id, {
          name,
          tokenType: "role-based",
          roleId: role.item.id,
          expiresIn: "unlimited",
        });
        return key;
      }

      author = await keyHolding("page-author", AUTHORING);
      publisher = await keyHolding("page-publisher", [
        ...AUTHORING,
        ...PUBLISHING,
      ]);
    }, 180_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      await t?.destroy();
    });

    describe.each(HOSTS)("%s", host => {
      const entries = `collections/${host}/entries`;

      it("saves a draft on the update grant", async () => {
        const id = await draftOf(host);
        const res = await rest("PATCH", `${entries}/${id}`, author, {
          title: `${host} ${id} edited`,
          _overwrite: true,
        });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await storedRow(host, id)).toEqual({
          status: "draft",
          title: `${host} ${id} edited`,
        });
      });

      it("is refused a status-only publish, and the draft stays a draft", async () => {
        const id = await draftOf(host);
        const before = await storedRow(host, id);
        const res = await rest("PATCH", `${entries}/${id}`, author, {
          status: "published",
          _overwrite: true,
        });
        expect(res.status).toBe(403);
        expect(await storedRow(host, id)).toEqual(before);
      });

      it("is refused a publish sent with content, and neither is stored", async () => {
        const id = await draftOf(host);
        const before = await storedRow(host, id);
        const res = await rest("PATCH", `${entries}/${id}`, author, {
          title: `${host} ${id} published`,
          status: "published",
          _overwrite: true,
        });
        expect(res.status).toBe(403);
        expect(await storedRow(host, id)).toEqual(before);
      });

      it("is refused a create as published, and nothing is stored", async () => {
        const title = `${host} created live`;
        const res = await rest("POST", entries, author, {
          title,
          slug: `${host}-created-live`,
          status: "published",
        });
        expect(res.status).toBe(403);
        expect(await titled(host, title)).toEqual([]);
      });

      it("is refused a publish through bulk update by ids", async () => {
        const id = await draftOf(host);
        const before = await storedRow(host, id);
        const res = await rest("POST", `${entries}/bulk-update`, author, {
          ids: [id],
          data: { status: "published", _overwrite: true },
        });
        // A bulk write answers per row, so the row is what is checked.
        expect(res.status).not.toBe(500);
        expect(await storedRow(host, id)).toEqual(before);
      });

      it("is refused a publish through bulk update by query", async () => {
        const id = await draftOf(host);
        const before = await storedRow(host, id);
        const res = await rest("PATCH", entries, author, {
          where: { id: { equals: id } },
          data: { status: "published", _overwrite: true },
        });
        expect(res.status).not.toBe(500);
        expect(await storedRow(host, id)).toEqual(before);
      });

      it("is allowed the status-only publish once it holds publish", async () => {
        const id = await draftOf(host);
        const res = await rest("PATCH", `${entries}/${id}`, publisher, {
          status: "published",
          _overwrite: true,
        });
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await storedRow(host, id))?.status).toBe("published");
      });

      it("is allowed bulk publishing once it holds publish", async () => {
        const byIds = await draftOf(host);
        const byQuery = await draftOf(host);
        await rest("POST", `${entries}/bulk-update`, publisher, {
          ids: [byIds],
          data: { status: "published", _overwrite: true },
        });
        await rest("PATCH", entries, publisher, {
          where: { id: { equals: byQuery } },
          data: { status: "published", _overwrite: true },
        });
        expect((await storedRow(host, byIds))?.status).toBe("published");
        expect((await storedRow(host, byQuery))?.status).toBe("published");
      });
    });

    describe("the plugin's save-as-pattern route, which stores a live pattern", () => {
      const segments = [
        "plugins",
        ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
        SAVE_PATTERN_ROUTE_PATH.slice(1),
      ];

      function savePattern(key: string, title: string): Promise<Response> {
        const request = new Request(`${ORIGIN}/api/${segments.join("/")}`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            document: PAGE_DOCUMENT,
            selectedIds: ["box"],
            fields: { title, granularity: "section" },
          }),
        });
        return createDynamicHandlers().POST(request, {
          params: Promise.resolve({ params: segments }),
        });
      }

      it("refuses a key without publish, and stores no pattern", async () => {
        const title = "Pattern from an author key";
        const res = await savePattern(author, title);
        expect(res.status).toBe(403);
        expect(await titled(PATTERNS_SLUG, title)).toEqual([]);
      });

      it("stores the pattern for a key that holds publish", async () => {
        const title = "Pattern from a publisher key";
        const res = await savePattern(publisher, title);
        expect(res.status, await res.clone().text()).toBe(201);
        expect(await titled(PATTERNS_SLUG, title)).toMatchObject([
          { status: "published" },
        ]);
      });
    });
  }
);
