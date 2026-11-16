/**
 * The check behind "Block these N pages anyway" on a running site: the
 * sitemap pages the rules as typed would keep search engines from, by line,
 * with their key; nothing for rules the screen refuses; and the check is
 * only for someone who may manage site-wide SEO.
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
import { defineCollection, text } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import { blockedPagesKey } from "../robots-rules-stored";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const POSTS = "seorr_posts";
const SITE = "https://acme.example";
const PLUGIN = "@nextlyhq/plugin-seo";
const CSRF = "c".repeat(64);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A signed-in person holding exactly `permissions`, or every one. */
async function personWith(
  t: TestNextly,
  name: string,
  permissions: readonly string[] | "all"
): Promise<string> {
  const stored = await t.nextly.permissions.find({ limit: 1000 });
  const ids =
    permissions === "all"
      ? []
      : permissions.map(slug => {
          const found = stored.items.find(p => p.slug === slug);
          if (found === undefined) throw new Error(`no permission ${slug}`);
          return String(found.id);
        });
  const roles =
    ids.length === 0
      ? []
      : [
          String(
            (
              await t.nextly.roles.create({
                data: { name, slug: `seorr-${name}`, permissionIds: ids },
              })
            ).item.id
          ),
        ];
  const created = await t.nextly.users.create({
    email: `${name}@example.com`,
    password: "Password123!",
    data: { name, isActive: true, roles },
  });
  const token = await signAccessToken(
    buildClaims({
      userId: String(created.item.id),
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

/** Asks the check about `text`, as `cookie`. */
async function check(cookie: string, text: string) {
  const segments = [
    "plugins",
    ...PLUGIN.split("/"),
    "settings",
    "robots-rules-check",
  ];
  const res = await createDynamicHandlers().POST(
    new Request(`${SITE}/api/${segments.join("/")}`, {
      method: "POST",
      headers: {
        cookie: `${cookie}; nextly_csrf=${CSRF}`,
        "x-csrf-token": CSRF,
        origin: SITE,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  return { status: res.status, body: res.ok ? await res.json() : undefined };
}

describe.each(getConfiguredTestDialects())(
  "which sitemap pages own robots.txt rules block (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [seoPlugin({ collections: [POSTS], baseUrl: SITE })],
        collections: [
          defineCollection({
            slug: POSTS,
            status: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
        // Seeds the plugin's own permissions, such as `manage-seo`.
        seedPublic: true,
      });
      for (const slug of ["harbour", "boats", "tides"]) {
        await current.nextly.create({
          collection: POSTS,
          data: { title: slug, slug, status: "published" },
        });
      }
      await lastCatchUp();
      return current;
    }

    it("names the pages each line blocks, and their key", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      const { status, body } = await check(
        owner,
        "User-agent: *\nDisallow: /search\nDisallow: /blog/t"
      );
      expect(status).toBe(200);
      expect(body).toEqual({
        lines: [
          {
            line: 3,
            rule: "Disallow: /blog/t",
            count: 1,
            examples: ["/blog/tides"],
          },
        ],
        pagesKey: blockedPagesKey(["/blog/tides"]),
      });
    });

    it("finds nothing blocked for rules that block no listed page", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      expect(
        (await check(owner, "User-agent: *\nDisallow: /search")).body
      ).toEqual({ lines: [], pagesKey: blockedPagesKey([]) });
    });

    it("checks nothing for rules the screen refuses", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      expect((await check(owner, "User-agent: *\nDisallow: /")).body).toEqual({
        lines: [],
        pagesKey: blockedPagesKey([]),
      });
    });

    it("is only for someone who may manage site-wide SEO", async () => {
      const t = await boot();
      // The first person is the site's owner; the others come after.
      await personWith(t, "owner", "all");
      const reader = await personWith(t, "reader", [`read-${POSTS}`]);
      const manager = await personWith(t, "manager", ["manage-seo"]);
      expect(
        (await check(reader, "User-agent: *\nDisallow: /blog")).status
      ).toBe(403);
      expect(
        (await check(manager, "User-agent: *\nDisallow: /blog")).status
      ).toBe(200);
    });
  }
);
