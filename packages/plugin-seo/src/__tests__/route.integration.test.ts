/**
 * P7c — the public sitemap route serves XML, and collection change events
 * invalidate the cache so the sitemap reflects new published entries. Drives the
 * `contributes.routes` handler directly against a live boot (D25/D28 + D8/D51).
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seo } from "../plugin";

let current: TestNextly | undefined;

beforeEach(() => {
  // init subscribes to events once per (collections) via a globalThis guard;
  // clear it so each boot re-subscribes.
  delete (globalThis as Record<string, unknown>)["__seo_events_pages"];
});
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pages = () =>
  defineCollection({
    slug: "pages",
    fields: [text({ name: "slug" }), text({ name: "status" })],
  });

describe("seo sitemap route + event invalidation (P7c)", () => {
  it("declares a public GET /sitemap.xml route", () => {
    const route = seo({ collections: ["pages"], baseUrl: "https://x.com" })
      .plugin.contributes?.routes?.[0];
    expect(route).toMatchObject({
      method: "GET",
      path: "/sitemap.xml",
      public: true,
    });
  });

  it("serves XML and reflects new published entries after change events", async () => {
    const seoResult = seo({ collections: ["pages"], baseUrl: "https://x.com" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let services: any;
    const probe = definePlugin({
      name: "@test/seo-route-probe",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init: c => {
        services = c.services;
      },
    });
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoResult.plugin, probe],
    });

    const handler = seoResult.plugin.contributes!.routes![0].handler;
    const call = async (): Promise<string> => {
      const res = await handler(
        new Request("http://localhost/sitemap.xml"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { services } as any
      );
      expect(res.headers.get("content-type")).toContain("xml");
      return res.text();
    };

    await current.nextly.create({
      collection: "pages",
      data: { slug: "a", status: "published" },
    });
    await current.events.settle();
    expect(await call()).toContain("/pages/a");

    // A new entry fires collection.pages.created → cache invalidated → the next
    // request regenerates and includes it (would be stale "a"-only otherwise).
    await current.nextly.create({
      collection: "pages",
      data: { slug: "b", status: "published" },
    });
    await current.events.settle();
    const xml = await call();
    expect(xml).toContain("/pages/a");
    expect(xml).toContain("/pages/b");
  });
});
