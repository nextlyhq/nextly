/**
 * On every configured dialect: where the Page Builder offers a page's design
 * level, the SEO tab's route answers it as the page's template level, and the
 * problem list judges the page with it, so a description only the design sets
 * is not listed as missing. A page no design draws is judged as before.
 *
 * The Page Builder is stood in for by a plugin of its name offering only its
 * design service, answering for the post whose slug is `designed`.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { PluginContext, PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import {
  pageRefKey,
  problemList,
  type ProblemChecks,
  type Reader,
} from "../../problems/check";
import { PROBLEMS_SLUG } from "../../problems/store";
import { readSeoRules } from "../../settings/rules";
import { structuredDataFromSettings } from "../../settings/structured-data-rules";
import { noSocialCardRules } from "../../social/card";
import { rulesFromOptions } from "../../structured-data/rules";
import type { SeoTabContext } from "../../tab/contract";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** What the stand-in's design says about the post it draws. */
const DESIGNED = {
  title: "Designed post | Acme",
  description: "Written by the post's design.",
};

/** A plugin of the Page Builder's name offering only its design service. */
const pageBuilder: PluginDefinition = {
  name: "@nextlyhq/plugin-page-builder",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    // Its Settings place, which the SEO plugin adds a tab to.
    admin: {
      places: [
        { name: "nextlyhq-plugin-page-builder.settings", accepts: ["tab"] },
      ],
    },
    services: {
      designSeo: () => ({
        valuesFor: async ({ entry }: { entry: Record<string, unknown> }) =>
          entry.slug === "designed" ? DESIGNED : undefined,
      }),
    },
  },
};

const CHECKS: ProblemChecks = {
  targets: ["posts"],
  readers: {
    readRules: readSeoRules,
    readStructuredDataRules: structuredDataFromSettings(
      rulesFromOptions(undefined, undefined)
    ),
    readSocialCardRules: noSocialCardRules,
  },
};

async function boot(dialect: TestDialect) {
  const seen: { ctx?: PluginContext } = {};
  const seo = seoPlugin({ collections: ["posts"], sitemap: false });
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    plugins: [
      pageBuilder,
      {
        ...seo,
        init(ctx) {
          seen.ctx = ctx;
          return seo.init?.(ctx);
        },
      },
    ],
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
    ],
  });
  if (!seen.ctx) throw new Error("the SEO plugin never started");
  const ctx = seen.ctx;
  const everything: Reader = {
    pages: async pages => new Set(pages.map(pageRefKey)),
    readsType: () => true,
    seesRedirects: true,
    count: async type => ctx.services.collections.count(type, {}),
  };
  return { t: current, ctx, everything };
}

/** An API key whose role reads and edits posts, as an editor's does. */
async function editorKey(t: TestNextly): Promise<string> {
  const direct = t.nextly as unknown as {
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
  };
  const owner = await direct.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  const seeded = await direct.permissions.find({ limit: 500 });
  const ids = ["read-posts", "update-posts"].map(slug => {
    const found = seeded.items.find(item => item.slug === slug);
    if (found === undefined) throw new Error(`${slug} is not seeded`);
    return found.id;
  });
  const role = await direct.roles.create({
    data: { name: "Editor", slug: "editor", permissionIds: ids },
  });
  const keys = t.getService("apiKeyService") as unknown as {
    createApiKey(
      userId: string,
      input: Record<string, unknown>
    ): Promise<{ key: string }>;
  };
  const { key } = await keys.createApiKey(owner.item.id, {
    name: "editor",
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

async function publish(t: TestNextly, slug: string): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { title: `Post ${slug}`, slug, status: "published" },
  });
  return String(created.item.id);
}

/** Waits until the save's check has kept a row for each of `ids`. */
async function checked(t: TestNextly, ids: string[]): Promise<void> {
  for (let tries = 0; tries < 100; tries++) {
    const { items } = await t.nextly.find({
      collection: PROBLEMS_SLUG,
      limit: 100,
      overrideAccess: true,
    });
    const held = new Set(
      (items as Record<string, unknown>[]).map(row => String(row.holderId))
    );
    if (ids.every(id => held.has(id))) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("the pages' checks never finished");
}

describe.each(getConfiguredTestDialects())(
  "a page's design level, asked outside a request (%s)",
  dialect => {
    it("is the template level the SEO tab's route answers", async () => {
      const { t } = await boot(dialect);
      const id = await publish(t, "designed");
      const segments = ["plugins", "@nextlyhq", "plugin-seo", "resolve"];
      const key = await editorKey(t);
      const response = await createDynamicHandlers().POST(
        new Request(`https://admin.example/api/${segments.join("/")}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            kind: "collection",
            slug: "posts",
            id,
            document: { title: "Post designed", slug: "designed" },
          }),
        }),
        { params: Promise.resolve({ params: segments }) }
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const context = (await response.json()) as SeoTabContext;
      expect(context.levels.template).toEqual(DESIGNED);
    });

    it("judges a page with what its design sets, and one no design draws as before", async () => {
      const { t, ctx, everything } = await boot(dialect);
      const designed = await publish(t, "designed");
      const plain = await publish(t, "plain");
      await checked(t, [designed, plain]);

      const list = await problemList(ctx, CHECKS, everything);
      const kinds = (id: string) =>
        list.problems.filter(p => p.subject.id === id).map(p => p.kind);
      expect(kinds(designed)).not.toContain("noDescription");
      expect(kinds(plain)).toContain("noDescription");
    });
  }
);
