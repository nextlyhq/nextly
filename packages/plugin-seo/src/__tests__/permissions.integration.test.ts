/**
 * Who may change SEO, judged through Nextly's own request handler with real
 * sessions on every configured dialect: each of the plugin's routes, the
 * settings Single and a page's own SEO, called by people holding and lacking
 * each permission.
 *
 * - Site-wide SEO needs `manage-seo`: the settings with the settings
 *   Single's own read or update permission beside it, which core asks of
 *   every Single, and redirects, their imports and addresses not found with
 *   nothing else, since the plugin keeps those itself.
 * - The Pages screen, its list and its save of a page with
 *   no entry's SEO, needs `manage-seo` alone: the plugin keeps that SEO.
 * - The check of what search engines received needs `check-seo`.
 * - Where page SEO has its own permission, a person who may edit a page but
 *   not its SEO saves the page with its SEO left as it was, and the SEO tab
 *   is told they may not change it.
 * - The problem list answers anyone who may read a type SEO is added to,
 *   and names redirects only to someone who may see them.
 * - Share images need the media library's own permissions; the sitemap and
 *   robots.txt are public.
 *
 * The roles are named for what they hold and every person holds exactly
 * what the case grants, so a gate that decided by a role's name, or let
 * one permission stand in for another, could not pass the admitted cases.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, ServiceContainer, text } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lastCatchUp } from "../address-record/catch-up";
import { NOT_FOUND_SLUG } from "../not-found/collection";
import { keptSeoContext } from "../not-found/report";
import { seoPlugin, type SeoPluginOptions } from "../plugin";
import { REDIRECTS_SLUG } from "../redirects/collection";
import { putRedirect } from "../redirects/store";
import { SEO_SETTINGS_SLUG } from "../settings/contract";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const PLUGIN = "@nextlyhq/plugin-seo";

/** The SEO settings Single's own permissions, which core asks of a Single. */
const SETTINGS = [`read-${SEO_SETTINGS_SLUG}`, `update-${SEO_SETTINGS_SLUG}`];

/**
 * The redirects' and the not-found log's own permissions. The plugin keeps
 * both, writing as the system, so neither opens anything: a role holding
 * them all and not `manage-seo` is refused.
 */
const STORES = [
  `read-${REDIRECTS_SLUG}`,
  `create-${REDIRECTS_SLUG}`,
  `update-${REDIRECTS_SLUG}`,
  `delete-${REDIRECTS_SLUG}`,
  `read-${NOT_FOUND_SLUG}`,
];

/** May edit posts, every part of them but, where it is its own, their SEO. */
const POST_EDITOR = ["read-posts", "create-posts", "update-posts"];

let made = 0;

/** A name no other row in this run has. */
function unique(stem: string): string {
  made += 1;
  return `${stem}-${String(made)}`;
}

/** A person whose one role holds exactly `slugs`, signed in. */
async function holding(
  t: TestNextly,
  slugs: readonly string[]
): Promise<string> {
  const name = unique("person");
  const user = await t.nextly.users.create({
    email: `${name}@example.com`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const permissions = await t.nextly.permissions.find({ limit: 1000 });
  const ids = slugs.map(slug => {
    const found = permissions.items.find(item => item.slug === slug);
    if (found === undefined) throw new Error(`${slug} is not seeded`);
    return found.id;
  });
  const role = await t.nextly.roles.create({
    data: { name: unique("role"), slug: unique("holds"), permissionIds: ids },
  });
  const assigned = await new ServiceContainer(
    t.adapter
  ).userRoles.assignRoleToUser(user.item.id, role.item.id);
  if (!assigned.success) throw new Error("the role was not assigned");
  const token = await signAccessToken(
    buildClaims({
      userId: user.item.id,
      email: `${name}@example.com`,
      name,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** A call through Nextly's own handler, signed in as `cookie` or as no one. */
async function request(
  method: Method,
  path: string,
  cookie: string | null,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const handlers = createDynamicHandlers();
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie !== null) {
    headers.cookie = `${cookie}; nextly_csrf=${CSRF}`;
    headers["x-csrf-token"] = CSRF;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await handlers[method](
    new Request(`${ORIGIN}/api/${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: path.split("?")[0]!.split("/") }) }
  );
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    parsed = { text };
  }
  return { status: response.status, body: parsed };
}

/** One of the plugin's routes. */
const route = (
  method: Method,
  path: string,
  cookie: string | null,
  body?: unknown
) => request(method, `plugins/${PLUGIN}${path}`, cookie, body);

/** The item a mutation or a document answer carries. */
function itemOf(body: Record<string, unknown>): Record<string, unknown> {
  const item = body.item ?? body.data ?? body;
  return item as Record<string, unknown>;
}

async function boot(
  dialect: TestDialect,
  options: Partial<SeoPluginOptions>
): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    plugins: [
      seoPlugin({
        collections: ["posts"],
        baseUrl: "https://acme.example",
        ...options,
      }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
    ],
    seedPublic: true,
  });
  // The instance's first user is its super-admin, made here so that none of
  // the people below is.
  await t.nextly.users.create({
    email: "owner@example.com",
    password: "Password123!",
    data: { name: "Owner", isActive: true },
  });
  await lastCatchUp();
  return t;
}

/** A post as the system made it, with its own SEO title. */
async function post(t: TestNextly, slug: string): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: {
      title: slug,
      slug,
      status: "published",
      seo: { metaTitle: `${slug} as searched` },
    },
    overrideAccess: true,
  });
  return String(created.item.id);
}

/** A post's stored title and SEO title. */
async function stored(t: TestNextly, id: string) {
  const row = (await t.nextly.findByID({
    collection: "posts",
    id,
    overrideAccess: true,
    depth: 0,
  })) as unknown as { title?: unknown; seo?: { metaTitle?: unknown } };
  return { title: row.title, metaTitle: row.seo?.metaTitle };
}

/** What the SEO tab's route answers a person about a post being edited. */
const resolve = (cookie: string, id: string) =>
  route("POST", "/resolve", cookie, {
    kind: "collection",
    slug: "posts",
    id,
    document: { title: "Typed", slug: "typed" },
  });

describe.each(getConfiguredTestDialects())(
  "SEO permissions, page SEO with its own permission (%s)",
  dialect => {
    let t: TestNextly;
    const people: Record<string, string> = {};

    beforeAll(async () => {
      t = await boot(dialect, { pagePermissions: true });
      const as = async (name: string, slugs: readonly string[]) => {
        people[name] = await holding(t, slugs);
      };
      await as("reader", ["read-posts"]);
      await as("postEditor", POST_EDITOR);
      await as("seoEditor", [...POST_EDITOR, "edit-seo-posts"]);
      await as("siteSeo", ["manage-seo", ...SETTINGS, "read-posts"]);
      await as("storesOnly", [...SETTINGS, ...STORES, "read-posts"]);
      await as("manageOnly", ["manage-seo"]);
      await as("settingsOnly", ["update-settings", "read-settings"]);
      await as("checker", ["check-seo"]);
      await as("media", ["create-media", "read-media"]);
      await as("addsMedia", ["create-media"]);
      await as("importer", ["manage-seo", ...POST_EDITOR, "edit-seo-posts"]);
      await as("importerWithoutPageSeo", ["manage-seo", ...POST_EDITOR]);
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    describe("the SEO settings need manage-seo and the Single's own permission", () => {
      const reads: [string, string][] = [
        ["the settings document", "/settings/document"],
        ["the content types", "/settings/content-types"],
      ];
      it.each(reads)("answers %s to someone holding both", async (_, path) => {
        expect((await route("GET", path, people.siteSeo!)).status).toBe(200);
      });
      it.each(reads)(
        "refuses %s to someone without manage-seo, with no data",
        async (_, path) => {
          const refused = await route("GET", path, people.storesOnly!);
          expect(refused.status).toBe(403);
          expect(refused.body.items).toBeUndefined();
          expect(refused.body.item).toBeUndefined();
        }
      );
      it.each(reads)(
        "refuses %s to someone holding manage-seo alone",
        async (_, path) => {
          expect((await route("GET", path, people.manageOnly!)).status).toBe(
            403
          );
        }
      );
      it.each(reads)("refuses %s to someone signed out", async (_, path) => {
        expect((await route("GET", path, null)).status).toBe(401);
      });

      it("reads and saves the settings Single only with both", async () => {
        const single = `singles/${SEO_SETTINGS_SLUG}`;
        expect((await request("GET", single, people.siteSeo!)).status).toBe(
          200
        );
        const saved = await request("PATCH", single, people.siteSeo!, {
          siteName: "Acme",
          _overwrite: true,
        });
        expect(saved.status).toBe(200);

        for (const who of ["storesOnly", "manageOnly", "reader"]) {
          // Refused, or answered as missing where the person holds the
          // Single's read and only the rule refuses: no data either way.
          const read = await request("GET", single, people[who]!);
          expect([403, 404]).toContain(read.status);
          expect(JSON.stringify(read.body)).not.toContain("Acme");
          const write = await request("PATCH", single, people[who]!, {
            siteName: `Changed by ${who}`,
            _overwrite: true,
          });
          expect([403, 404]).toContain(write.status);
        }
        const kept = (await t.nextly.findSingle({
          slug: SEO_SETTINGS_SLUG,
          overrideAccess: true,
        })) as unknown as { siteName?: unknown };
        expect(kept.siteName).toBe("Acme");
      });
    });

    describe("redirects and addresses not found need manage-seo", () => {
      const reads: [string, string][] = [
        ["the redirects", "/redirects"],
        ["the addresses not found", "/not-found"],
      ];
      it.each(reads)("answers %s to someone holding it", async (_, path) => {
        expect((await route("GET", path, people.manageOnly!)).status).toBe(200);
      });
      it.each(reads)(
        "refuses %s to someone without it, whatever else they hold, with no data",
        async (_, path) => {
          for (const who of ["storesOnly", "reader", "checker"]) {
            const refused = await route("GET", path, people[who]!);
            expect([who, refused.status]).toEqual([who, 403]);
            expect(refused.body.items).toBeUndefined();
          }
        }
      );
      it.each(reads)("refuses %s to someone signed out", async (_, path) => {
        expect((await route("GET", path, null)).status).toBe(401);
      });

      it("adds, changes, imports and removes redirects only with it", async () => {
        const add = { from: "/old-perm", to: "/new-perm" };
        expect(
          (await route("POST", "/redirects", people.storesOnly!, add)).status
        ).toBe(403);
        const added = await route(
          "POST",
          "/redirects",
          people.manageOnly!,
          add
        );
        expect(added.status).toBe(201);
        const id = String(itemOf(added.body).id);

        const edit = { to: "/newer-perm" };
        expect(
          (await route("PATCH", `/redirects/${id}`, people.storesOnly!, edit))
            .status
        ).toBe(403);
        expect(
          (await route("DELETE", `/redirects/${id}`, people.storesOnly!)).status
        ).toBe(403);
        const file = { file: "from,to\n/imported-perm,/new-perm\n" };
        expect(
          (await route("POST", "/redirects/import", people.storesOnly!, file))
            .status
        ).toBe(403);
        expect(
          (await route("POST", "/redirects/import", people.manageOnly!, file))
            .status
        ).toBe(200);
        expect(
          (await route("PATCH", `/redirects/${id}`, people.manageOnly!, edit))
            .status
        ).toBe(200);
        expect(
          (await route("DELETE", `/redirects/${id}`, people.manageOnly!)).status
        ).toBe(200);
      });
    });

    describe("pages and addresses need manage-seo", () => {
      it("lists the site's addresses to someone holding it", async () => {
        const answered = await route("GET", "/pages", people.manageOnly!);
        expect(answered.status).toBe(200);
        expect(Array.isArray(answered.body.items)).toBe(true);
      });

      it("refuses the list to someone without it, whatever else they hold, with no data", async () => {
        for (const who of ["storesOnly", "reader", "checker"]) {
          const refused = await route("GET", "/pages", people[who]!);
          expect([who, refused.status]).toEqual([who, 403]);
          expect(refused.body.items).toBeUndefined();
        }
        expect((await route("GET", "/pages", null)).status).toBe(401);
      });

      it("takes a save only from someone holding it", async () => {
        const save = {
          path: "/pricing",
          title: "Plans",
          description: "",
          hidden: false,
        };
        for (const who of ["storesOnly", "reader", "checker"]) {
          const refused = await route("POST", "/pages/seo", people[who]!, save);
          expect([who, refused.status]).toEqual([who, 403]);
        }
        // Past the permission: refused only because this site's build has
        // no page at /pricing, which is the save's own check.
        expect(
          (await route("POST", "/pages/seo", people.manageOnly!, save)).status
        ).toBe(400);
      });
    });

    describe("the check of what search engines received needs check-seo", () => {
      it("takes a check from someone holding it", async () => {
        // Past the gate: the body is refused for what it says, before
        // anything is fetched.
        expect(
          (await route("POST", "/received", people.checker!, {})).status
        ).toBe(400);
      });

      it.each(["siteSeo", "reader", "postEditor"])(
        "refuses %s, who does not hold it, before anything is read or fetched",
        async who => {
          expect(
            (
              await route("POST", "/received", people[who]!, {
                address: "https://acme.example/blog/one",
              })
            ).status
          ).toBe(403);
        }
      );
    });

    describe("a page's SEO, where it has its own permission", () => {
      it("saves an edit's other fields and keeps the SEO as it was for someone without it", async () => {
        const id = await post(t, "kept");
        const saved = await request(
          "PATCH",
          `collections/posts/entries/${id}`,
          people.postEditor!,
          {
            title: "Kept, retitled",
            seo: { metaTitle: "Changed without leave" },
            _overwrite: true,
          }
        );
        expect(saved.status).toBe(200);
        expect(await stored(t, id)).toEqual({
          title: "Kept, retitled",
          metaTitle: "kept as searched",
        });
      });

      it("saves the SEO of someone holding it", async () => {
        const id = await post(t, "changed");
        const saved = await request(
          "PATCH",
          `collections/posts/entries/${id}`,
          people.seoEditor!,
          {
            title: "Changed, retitled",
            seo: { metaTitle: "Changed with leave" },
            _overwrite: true,
          }
        );
        expect(saved.status).toBe(200);
        expect(await stored(t, id)).toEqual({
          title: "Changed, retitled",
          metaTitle: "Changed with leave",
        });
      });

      it("makes a page without the SEO typed by someone without it", async () => {
        const created = await request(
          "POST",
          "collections/posts/entries",
          people.postEditor!,
          {
            title: "New",
            slug: "new",
            seo: { metaTitle: "Typed without leave" },
          }
        );
        expect(created.status).toBe(201);
        const id = String(itemOf(created.body).id);
        const { metaTitle } = await stored(t, id);
        expect(metaTitle ?? null).toBeNull();
      });

      it("tells the SEO tab who may change it, and answers it only to a reader", async () => {
        const id = await post(t, "tab");
        const editor = await resolve(people.seoEditor!, id);
        expect(editor.status).toBe(200);
        expect(itemOf(editor.body).mayChange).toBe(true);
        for (const who of ["postEditor", "reader"]) {
          const answer = await resolve(people[who]!, id);
          expect([who, answer.status]).toEqual([who, 200]);
          expect([who, itemOf(answer.body).mayChange]).toEqual([who, false]);
        }
        expect((await resolve(people.manageOnly!, id)).status).toBe(403);
      });
    });

    describe("bulk edit, where a page's SEO has its own permission", () => {
      /** The posts' rows as the table reads them for `cookie`, by id. */
      async function rowsFor(cookie: string) {
        const read = await route("GET", "/bulk/rows?type=posts", cookie);
        expect(read.status, JSON.stringify(read.body)).toBe(200);
        const body = read.body as unknown as {
          rows: { id: string; rev?: string; editable: boolean }[];
        };
        return new Map(body.rows.map(row => [row.id, row]));
      }

      it("shows the rows read-only, and saves none of them, for someone without it", async () => {
        const id = await post(t, "bulk-kept");
        const row = (await rowsFor(people.postEditor!)).get(id);
        expect(row?.editable).toBe(false);
        const saved = await route("POST", "/bulk/save", people.postEditor!, {
          type: "posts",
          changes: [{ id, rev: row?.rev, title: "Changed without leave" }],
        });
        expect(saved.status).toBe(403);
        expect((await stored(t, id)).metaTitle).toBe("bulk-kept as searched");
      });

      it("saves the rows of someone holding it", async () => {
        const id = await post(t, "bulk-changed");
        const row = (await rowsFor(people.seoEditor!)).get(id);
        expect(row?.editable).toBe(true);
        const saved = await route("POST", "/bulk/save", people.seoEditor!, {
          type: "posts",
          changes: [{ id, rev: row?.rev, title: "Changed with leave" }],
        });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        expect((await stored(t, id)).metaTitle).toBe("Changed with leave");
      });

      it("shows a reader the rows, read-only", async () => {
        const id = await post(t, "bulk-read");
        expect((await rowsFor(people.reader!)).get(id)?.editable).toBe(false);
      });
    });

    describe("imports need manage-seo", () => {
      const source = { kind: "group", field: "seo", map: {} };

      it("refuses the groups, a dry run and an apply without it", async () => {
        for (const who of ["postEditor", "seoEditor", "storesOnly"] as const) {
          expect(
            (await route("GET", "/import/groups", people[who]!)).status
          ).toBe(403);
          expect(
            (await route("POST", "/import/dry-run", people[who]!, { source }))
              .status
          ).toBe(403);
          expect(
            (
              await route("POST", "/import/apply", people[who]!, {
                source,
                plan: "x",
              })
            ).status
          ).toBe(403);
        }
        expect((await route("GET", "/import/groups", null)).status).toBe(401);
      });

      it("imports for someone holding it, leaving out pages whose SEO they may not change", async () => {
        const id = await post(t, "imported");
        // Its typed title made the same as its automatic one, whatever the
        // settings earlier cases saved make that.
        const rows = await route(
          "GET",
          "/bulk/rows?type=posts",
          people.importer!
        );
        const automatic = (
          rows.body as unknown as { rows: { id: string; autoTitle?: string }[] }
        ).rows.find(row => row.id === id)?.autoTitle;
        expect(automatic).toBeDefined();
        await t.nextly.update({
          collection: "posts",
          id,
          data: { seo: { metaTitle: automatic }, _overwrite: true },
          overrideAccess: true,
        });
        // The typed title is the same as the automatic one, so the import
        // makes it automatic, for someone who may change the page's SEO.
        const without = await route(
          "POST",
          "/import/dry-run",
          people.importerWithoutPageSeo!,
          { source }
        );
        expect(without.status, JSON.stringify(without.body)).toBe(200);
        const left = without.body as unknown as {
          pages: number;
          warnings: string[];
        };
        expect(left.pages).toBe(0);
        expect(left.warnings.join(" ")).toContain("you may not change");

        const dry = await route("POST", "/import/dry-run", people.importer!, {
          source,
        });
        expect(dry.status, JSON.stringify(dry.body)).toBe(200);
        const run = dry.body as unknown as { pages: number; plan: string };
        expect(run.pages).toBeGreaterThan(0);
        const applied = await route("POST", "/import/apply", people.importer!, {
          source,
          plan: run.plan,
        });
        expect(applied.status, JSON.stringify(applied.body)).toBe(200);
        expect((await stored(t, id)).metaTitle).toBe("");
      });
    });

    describe("the problem list", () => {
      it("answers someone who may read a type SEO is added to, and no one else", async () => {
        expect((await route("GET", "/problems", people.reader!)).status).toBe(
          200
        );
        const refused = await route("GET", "/problems", people.manageOnly!);
        expect(refused.status).toBe(403);
        expect(refused.body.problems).toBeUndefined();
      });

      it("names a redirect chain only to someone who may see redirects", async () => {
        const ctx = keptSeoContext();
        if (!ctx) throw new Error("the SEO plugin never started");
        // A redirect to an address a pattern added after it moves on again.
        for (const [source, target] of [
          ["/chain-a", "/moved/x"],
          ["/moved/*", "/moved-again/*"],
        ] as const) {
          await ctx.services.collections.withTransaction(tx =>
            putRedirect(ctx, tx, {
              locale: "en",
              origin: "person",
              source,
              target,
            })
          );
        }
        const checked = await route("POST", "/problems/check", people.siteSeo!);
        expect(checked.status).toBe(200);
        const kinds = async (who: string) => {
          const list = await route("GET", "/problems", people[who]!);
          const problems = itemOf(list.body).problems as { kind: string }[];
          return problems.map(problem => problem.kind);
        };
        expect(await kinds("siteSeo")).toContain("redirectChain");
        expect(await kinds("reader")).not.toContain("redirectChain");
        expect(await kinds("storesOnly")).not.toContain("redirectChain");
      });
    });

    describe("the optional connections need manage-seo", () => {
      const calls: [Method, string][] = [
        ["GET", "/connections"],
        ["POST", "/connections/search-console/connect"],
        ["GET", "/connections/search-console/callback?state=s&code=c"],
        ["POST", "/connections/search-console/disconnect"],
        ["GET", "/connections/search-console/report"],
      ];

      it.each(calls)(
        "answers %s %s to someone holding it",
        async (method, path) => {
          for (const who of ["siteSeo", "manageOnly"]) {
            const { status } = await route(method, path, people[who]!);
            // Past the gate: what is left is the route's own answer, such as no
            // Google sign-in named or nothing connected.
            expect([401, 403]).not.toContain(status);
          }
        }
      );

      it.each(calls)(
        "refuses %s %s to someone without it, whatever else they hold",
        async (method, path) => {
          for (const who of ["reader", "storesOnly", "checker", "seoEditor"]) {
            expect((await route(method, path, people[who]!)).status).toBe(403);
          }
        }
      );

      it.each(calls)(
        "refuses %s %s to someone signed out",
        async (method, path) => {
          expect((await route(method, path, null)).status).toBe(401);
        }
      );

      it("keeps the plugin's own settings, where connections are kept, to manage-seo", async () => {
        const path = `plugins-settings/${PLUGIN}`;
        const body = { indexNowLast: null };
        expect(
          (await request("PATCH", path, people.settingsOnly!, body)).status
        ).toBe(403);
        expect(
          (await request("PATCH", path, people.manageOnly!, body)).status
        ).toBe(200);
      });

      it("never answers a credential, even to someone holding it", async () => {
        const { body } = await route("GET", "/connections", people.siteSeo!);
        expect(JSON.stringify(body)).not.toMatch(/token|verifier|key/i);
      });
    });

    describe("share images and the public files", () => {
      it("makes a share image only for someone who may add to and read the media library", async () => {
        expect(
          (await route("POST", "/share-image", people.reader!, {})).status
        ).toBe(403);
        expect(
          (await route("POST", "/share-image", people.addsMedia!, {})).status
        ).toBe(403);
        // Past both: refused for naming no picture.
        expect(
          (await route("POST", "/share-image", people.media!, {})).status
        ).toBe(400);
      });

      it.each(["sitemap.xml", "robots.txt"])(
        "serves %s to anyone",
        async file => {
          expect((await request("GET", file, null)).status).toBe(200);
        }
      );

      it("serves llms.txt to anyone once it is switched on", async () => {
        expect((await request("GET", "llms.txt", null)).status).toBe(404);
        await t.nextly.updateSingle({
          slug: SEO_SETTINGS_SLUG,
          data: { _overwrite: true, llmsTxt: true },
          overrideAccess: true,
        });
        expect((await request("GET", "llms.txt", null)).status).toBe(200);
        await t.nextly.updateSingle({
          slug: SEO_SETTINGS_SLUG,
          data: { _overwrite: true, llmsTxt: false },
          overrideAccess: true,
        });
      });
    });

    it("hides the admin's site-wide screens behind the plugin's own permissions", () => {
      const admin = seoPlugin({ collections: ["posts"] }).contributes?.admin;
      const gates = Object.fromEntries(
        (admin?.menu ?? []).map(item => [item.label, item.requiredPermission])
      );
      expect(gates).toEqual({
        Overview: "manage-seo",
        Pages: "manage-seo",
        Problems: undefined,
        Redirects: "manage-seo",
        Settings: "manage-seo",
      });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "SEO permissions, page SEO with the page (%s)",
  dialect => {
    let t: TestNextly;
    let postEditor: string;

    beforeAll(async () => {
      t = await boot(dialect, {});
      postEditor = await holding(t, POST_EDITOR);
    }, 60_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("lets whoever may edit a page change its SEO, as before", async () => {
      const id = await post(t, "as-before");
      const saved = await request(
        "PATCH",
        `collections/posts/entries/${id}`,
        postEditor,
        { seo: { metaTitle: "Changed with the page" }, _overwrite: true }
      );
      expect(saved.status).toBe(200);
      expect((await stored(t, id)).metaTitle).toBe("Changed with the page");
      expect(itemOf((await resolve(postEditor, id)).body).mayChange).toBe(true);
    });

    it("declares the site-wide permissions and no page SEO permission", async () => {
      const slugs = (await t.nextly.permissions.find({ limit: 1000 })).items
        .map(item => item.slug)
        .filter(
          slug =>
            slug === "manage-seo" ||
            slug === "check-seo" ||
            slug.startsWith("edit-seo-")
        );
      expect(slugs.sort()).toEqual(["check-seo", "manage-seo"]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "SEO permissions, the problem list of a Single (%s)",
  dialect => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [
          seoPlugin({
            collections: ["posts"],
            singles: ["home"],
            baseUrl: "https://acme.example",
          }),
        ],
        collections: [
          defineCollection({
            slug: "posts",
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            fields: [text({ name: "title" })],
            publicAddress: "/",
          }),
        ],
        seedPublic: true,
      });
      await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      await lastCatchUp();
    }, 60_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("answers someone who may read the Single alone, with its page, and refuses someone who may read neither", async () => {
      await t.nextly.updateSingle({
        slug: "home",
        data: { title: "t".repeat(70), _overwrite: true },
      });
      const homeReader = await holding(t, ["read-home"]);
      const pagesOf = async (cookie: string) => {
        for (let tries = 0; tries < 100; tries++) {
          const list = await route("GET", "/problems", cookie);
          expect(list.status).toBe(200);
          const problems = itemOf(list.body).problems as {
            subject: { type?: string };
          }[];
          const types = problems.map(problem => problem.subject.type);
          if (types.includes("single:home")) return types;
          // The save's check runs after the save: given a moment.
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error("the Single's check never finished");
      };
      expect(await pagesOf(homeReader)).toContain("single:home");
      // A reader of posts alone is not shown the Single's page.
      const postsReader = await holding(t, ["read-posts"]);
      const posts = await route("GET", "/problems", postsReader);
      expect(posts.status).toBe(200);
      expect(
        (itemOf(posts.body).problems as { subject: { type?: string } }[]).some(
          problem => problem.subject.type === "single:home"
        )
      ).toBe(false);
      // The list says which pages it checked for them, so a page it left
      // out is not taken for one with no problems.
      const checkedOf = async (cookie: string) =>
        (
          itemOf((await route("GET", "/problems", cookie)).body).checked as {
            type: string;
          }[]
        ).map(page => page.type);
      expect(await checkedOf(postsReader)).not.toContain("single:home");
      expect(await checkedOf(homeReader)).toContain("single:home");
      const refused = await route(
        "GET",
        "/problems",
        await holding(t, ["check-seo"])
      );
      expect(refused.status).toBe(403);
      expect(refused.body.problems).toBeUndefined();
    });
  }
);
