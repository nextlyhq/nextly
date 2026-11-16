/**
 * A sitemap made while `next build` runs lists the pages a route declared
 * through `seoStaticParams`, before any of them has rendered: on a first
 * build nothing has recorded them yet, and the sitemap may be made before
 * they render.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { keptSeoContext } from "../../not-found/report";
import { listPages } from "../../outputs/listing";
import { seoPlugin } from "../../plugin";
import { readCodeRoutes } from "../routes";
import { seoStaticParams } from "../static-params";

let current: TestNextly | undefined;
let build: string | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  delete process.env.NEXT_PHASE;
  if (build !== undefined) rmSync(build, { recursive: true, force: true });
  build = undefined;
});

describe.each(getConfiguredTestDialects())(
  "pages declared while the build runs (%s)",
  dialect => {
    it("are listed before any of them has rendered", async () => {
      build = mkdtempSync(join(tmpdir(), "seo-declared-"));
      mkdirSync(join(build, "server"), { recursive: true });
      writeFileSync(
        join(build, "server/app-paths-manifest.json"),
        JSON.stringify({
          "/(site)/topics/[topic]/page": "app/(site)/topics/[topic]/page.js",
        })
      );
      current = await createTestNextly({
        dialect,
        plugins: [seoPlugin({ collections: ["pages"] })],
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

      process.env.NEXT_PHASE = "phase-production-build";
      await seoStaticParams("/topics/[topic]", () => [{ topic: "seo" }], {
        buildDir: build,
      })();
      const at = build;
      const { pages } = await listPages(seo, {
        origin: "https://acme.example",
        codeRoutes: () => readCodeRoutes({ buildDir: at }),
      });
      expect(pages.map(page => page.loc)).toContain(
        "https://acme.example/topics/seo"
      );
    });
  }
);
