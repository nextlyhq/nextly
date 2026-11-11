/**
 * The redirects screen's routes on each dialect: a person adds, edits and
 * removes redirects with addresses as visitors open them, every refusal comes
 * back with the sentence the screen shows, and the addresses not found come
 * with the closest live page suggested.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  definePlugin,
  type PluginContext,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { createNextlyProxy } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { NOT_FOUND_SLUG } from "../../not-found/collection";
import { recordNotFound } from "../../not-found/log";
import { keptSeoContext, logNotFound } from "../../not-found/report";
import { seoPlugin } from "../../plugin";
import { REDIRECTS_SLUG } from "../collection";
import { redirectRoutes } from "../routes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Makes the next saves of one From address fail, as a store that went down. */
const faults = { failSourceOf: "" };

async function boot(dialect: TestDialect, languages = false) {
  faults.failSourceOf = "";
  current = await createTestNextly({
    dialect,
    // Languages and no address rule: every language is read as prefixed.
    ...(languages
      ? { localization: { locales: ["en", "de"], defaultLocale: "en" } }
      : {}),
    plugins: [
      seoPlugin({ collections: ["pages"] }),
      definePlugin({
        name: "@test/redirect-faults",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx) {
          ctx.hooks.on("beforeCreate", REDIRECTS_SLUG, context => {
            const data = (context as { data?: Record<string, unknown> }).data;
            if (
              faults.failSourceOf !== "" &&
              data?.source === faults.failSourceOf
            ) {
              throw new Error("the redirect store went down");
            }
          });
        },
      }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
    ],
  });
  const seo = keptSeoContext();
  if (!seo) throw new Error("the SEO plugin never started");
  return { t: current, seo };
}

/** Call one of the screen's routes as Sara, signed in. */
async function call(
  seo: PluginContext,
  method: string,
  path: string,
  body?: unknown
) {
  const [routePath, id] =
    path.startsWith("/redirects/") && path !== "/redirects/import"
      ? ["/redirects/:id", path.slice("/redirects/".length)]
      : [path, undefined];
  const route = redirectRoutes().find(
    each => each.method === method && each.path === routePath
  );
  if (!route) throw new Error(`no route ${method} ${path}`);
  const ctx = {
    ...seo,
    user: { id: "u1", email: "sara@example.com", name: "Sara Khan" },
    params: id === undefined ? {} : { id },
  } as unknown as PluginRouteContext;
  try {
    const response = await route.handler(
      new Request(`https://example.com/admin/api/plugins/x${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              body: JSON.stringify(body),
              headers: { "content-type": "application/json" },
            }),
      }),
      ctx
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  } catch (error) {
    const refused = error as { code?: string; publicMessage?: string };
    return {
      status: 0,
      body: { code: refused.code, message: refused.publicMessage },
    };
  }
}

const items = (body: Record<string, unknown>) =>
  body.items as Record<string, unknown>[];

describe.each(getConfiguredTestDialects())(
  "the redirects screen's routes (%s)",
  dialect => {
    it("adds a redirect a person types, permanent by default, and says what joined the chain", async () => {
      const { seo } = await boot(dialect);
      await call(seo, "POST", "/redirects", { from: "/b", to: "/c" });

      const added = await call(seo, "POST", "/redirects", {
        from: "/a",
        to: "/b",
      });

      expect(added.status).toBe(201);
      expect(added.body).toMatchObject({
        message:
          "Added. It works from the next visit. /b already goes on to /c, so this goes straight there in one hop.",
        item: {
          from: "/a",
          to: "/c",
          type: "permanent",
          origin: "person",
          addedBy: "Sara Khan",
        },
      });
    });

    it("lists every redirect newest first, with addresses as visitors open them", async () => {
      const { seo } = await boot(dialect);
      await call(seo, "POST", "/redirects", { from: "/one", to: "/x" });
      await new Promise(resolve => setTimeout(resolve, 1_100));
      await call(seo, "POST", "/redirects", {
        from: "/two/*",
        to: "/y/*",
        type: "temporary",
      });

      const listed = await call(seo, "GET", "/redirects");

      expect(
        items(listed.body).map(item => `${item.from} ${item.to} ${item.type}`)
      ).toEqual(["/two/* /y/* temporary", "/one /x permanent"]);
    });

    it("refuses with the sentence the screen shows", async () => {
      const { t, seo } = await boot(dialect);
      await t.nextly.create({
        collection: "pages",
        data: { title: "Live", slug: "live", status: "published" },
      });
      await call(seo, "POST", "/redirects", { from: "/a", to: "/b" });

      expect(
        await call(seo, "POST", "/redirects", { from: "/live", to: "/x" })
      ).toEqual({
        status: 0,
        body: {
          code: "DUPLICATE",
          message:
            "/live is the address of a published page, so it can't redirect. Give that page another address first.",
        },
      });
      expect(
        (await call(seo, "POST", "/redirects", { from: "/a", to: "/c" })).body
          .message
      ).toBe(
        "/a already has a redirect. Remove it first, or edit it in the list."
      );
      expect(
        (await call(seo, "POST", "/redirects", { from: "/b", to: "/a" })).body
          .message
      ).toBe("That makes a loop: /b → /a → /b.");
      expect(
        (await call(seo, "POST", "/redirects", { from: "old", to: "/a" })).body
          .message
      ).toBe("Start the From address with /, for example /old-page.");
    });

    it("edits a redirect's To address and type, and removes one", async () => {
      const { seo } = await boot(dialect);
      const added = await call(seo, "POST", "/redirects", {
        from: "/a",
        to: "/b",
      });
      const id = String((added.body.item as Record<string, unknown>).id);

      const edited = await call(seo, "PATCH", `/redirects/${id}`, {
        to: "/c",
        type: "temporary",
      });
      expect(edited.body.message).toBe("Saved. /a now goes to /c, temporary.");

      const removed = await call(seo, "DELETE", `/redirects/${id}`);
      expect(removed.body.message).toBe("Removed the redirect from /a");
      expect(items((await call(seo, "GET", "/redirects")).body)).toEqual([]);
    });

    it("lists the addresses not found, most visited first then most recent, each with the closest live page", async () => {
      const { t, seo } = await boot(dialect);
      for (const slug of ["pricing", "keyword-research"]) {
        await t.nextly.create({
          collection: "pages",
          data: { title: slug, slug, status: "published" },
        });
      }
      const ask = (path: string, minute: number) =>
        recordNotFound(
          seo,
          { locale: "en", path },
          "missing",
          new Date(Date.UTC(2026, 0, 1, 0, minute))
        );
      await ask("/keyword-research-tool", 1);
      await ask("/pricing-plans", 2);
      await ask("/pricing-plans", 3);
      await ask("/zzz", 4);

      const listed = await call(seo, "GET", "/not-found");

      expect(
        items(listed.body).map(
          item => `${item.path} ${item.hits} ${item.suggestion}`
        )
      ).toEqual([
        "/pricing-plans 2 /pricing",
        "/zzz 1 null",
        "/keyword-research-tool 1 /keyword-research",
      ]);
    });

    it("shows what a file would do and changes nothing until it is imported", async () => {
      const { seo } = await boot(dialect);
      await call(seo, "POST", "/redirects", {
        from: "/testimonial",
        to: "/customers",
      });
      await call(seo, "POST", "/redirects", {
        from: "/resources",
        to: "/blog",
      });
      const file = [
        "From,To",
        "/old-blog/*,/blog/*",
        "/guides/seo-basics,/resources",
        "/testimonial,/customers",
        "/tools/meta,/tools/meta-generator",
      ].join("\n");

      const dry = await call(seo, "POST", "/redirects/import", { file });

      expect(dry.body.message).toBe("4 rows read. Nothing has changed yet.");
      expect(
        (
          dry.body.item as { rows: Record<string, unknown>[]; applied: boolean }
        ).rows.map(row => `${row.line} ${row.kind} ${row.says}`)
      ).toEqual([
        "2 new New pattern: every old address goes to the same place under the new one.",
        "3 joined Chain joined: /guides/seo-basics → /resources → /blog becomes one hop to /blog.",
        "4 same Already there, no change.",
        "5 new New.",
      ]);
      expect(items((await call(seo, "GET", "/redirects")).body)).toHaveLength(
        2
      );

      const done = await call(seo, "POST", "/redirects/import", {
        file,
        apply: true,
      });

      expect(done.body.message).toBe("Imported 3 redirects in one step");
      expect(
        items((await call(seo, "GET", "/redirects")).body)
          .map(item => `${item.from} ${item.to} ${item.origin}`)
          .sort()
      ).toEqual([
        "/guides/seo-basics /blog import",
        "/old-blog/* /blog/* import",
        "/resources /blog person",
        "/testimonial /customers person",
        "/tools/meta /tools/meta-generator import",
      ]);
    });

    it("imports nothing from a file with a loop in it", async () => {
      const { seo } = await boot(dialect);
      await call(seo, "POST", "/redirects", {
        from: "/testimonial",
        to: "/customers",
      });
      const file = "/a,/b\n/customers,/testimonial";

      const tried = await call(seo, "POST", "/redirects/import", {
        file,
        apply: true,
      });

      const result = tried.body.item as {
        rows: Record<string, unknown>[];
        applied: boolean;
      };
      expect(result.applied).toBe(false);
      expect(result.rows[1]).toMatchObject({
        kind: "refused",
        refusal: "loop",
        says: "Loop: /customers → /testimonial → /customers.",
      });
      expect(items((await call(seo, "GET", "/redirects")).body)).toHaveLength(
        1
      );
    });

    it("keeps nothing of a file whose import fails part-way", async () => {
      const { seo } = await boot(dialect);
      faults.failSourceOf = "/c";

      const tried = await call(seo, "POST", "/redirects/import", {
        file: "/a,/x\n/b,/y\n/c,/z\n/d,/w",
        apply: true,
      });

      expect(tried.status).toBe(0);
      expect(items((await call(seo, "GET", "/redirects")).body)).toEqual([]);
    });

    it("reads an address no language serves in the default language, on the screen, in the Proxy and in the log", async () => {
      const { t, seo } = await boot(dialect, true);
      const proxy = createNextlyProxy(
        {} as Parameters<typeof createNextlyProxy>[0],
        {
          start: async () => undefined,
          next: () => () => new Response(null),
        }
      );

      const added = await call(seo, "POST", "/redirects", {
        from: "/webinar",
        to: "/events",
      });
      expect(added.body.item).toMatchObject({
        from: "/en/webinar",
        to: "/en/events",
      });

      for (const asked of ["/webinar", "/en/webinar"]) {
        const answer = await proxy(new Request(`https://example.com${asked}`));
        expect(answer?.headers.get("location")).toBe(
          "https://example.com/en/events"
        );
      }

      await logNotFound(
        new Headers({ "x-nextly-seo-asked-for": "https://example.com/gone" })
      );
      const { items: logged } = await t.nextly.find({
        collection: NOT_FOUND_SLUG,
      });
      expect(
        (logged as Record<string, unknown>[]).map(
          row => `${row.locale}|${row.path}|${row.asked}`
        )
      ).toEqual(["en|/gone|/gone"]);
      const listed = await call(seo, "GET", "/not-found");
      // Shown as the visitor asked for it, not as the rule spells it.
      expect(items(listed.body).map(item => item.path)).toEqual(["/gone"]);
    });
  }
);
