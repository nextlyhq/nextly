/**
 * `seoStaticParams`: a dynamic route's `generateStaticParams`, wrapped so
 * that `next build` records the addresses it declares where the plugin reads
 * them while the build runs, before Next.js writes its prerender manifest.
 * The site's params come back unchanged; the build's manifest wins once it
 * exists; parallel workers lose and repeat no address; a failed write warns
 * once and changes nothing the site gets.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCodeRoutes } from "../routes";
import { declaredAddresses, seoStaticParams } from "../static-params";

let appDir: string;
const phase = process.env.NEXT_PHASE;

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "seo-static-params-"));
  mkdirSync(join(appDir, ".next/server"), { recursive: true });
  writeFileSync(
    join(appDir, ".next/server/app-paths-manifest.json"),
    JSON.stringify({
      "/(site)/pricing/page": "app/(site)/pricing/page.js",
      "/(site)/blog/[topic]/page": "app/(site)/blog/[topic]/page.js",
      "/(site)/docs/[...slug]/page": "app/(site)/docs/[...slug]/page.js",
    })
  );
  process.env.NEXT_PHASE = "phase-production-build";
});

afterEach(() => {
  rmSync(appDir, { recursive: true, force: true });
  if (phase === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = phase;
  vi.restoreAllMocks();
});

const paths = () =>
  readCodeRoutes({ appDir }).map(route => `${route.source} ${route.path}`);

describe("seoStaticParams", () => {
  it("returns the site's own params, the same array in the same order", async () => {
    const params = [{ topic: "b" }, { topic: "a" }];
    const generate = seoStaticParams("/blog/[topic]", () => params, {
      appDir,
    });
    expect(await generate()).toBe(params);
    expect(params).toEqual([{ topic: "b" }, { topic: "a" }]);
  });

  it("passes the parent's params on, and fills the address with them", async () => {
    writeFileSync(
      join(appDir, ".next/server/app-paths-manifest.json"),
      JSON.stringify({
        "/(site)/[lang]/docs/[topic]/page": "app/[lang]/docs/[topic]/page.js",
      })
    );
    // A nested route's generator answers its own part alone; the parent's
    // part comes from the params Next.js hands it.
    const generate = seoStaticParams(
      "/[lang]/docs/[topic]",
      (_: { params: { lang: string } }) => [{ topic: "intro" }],
      { appDir }
    );
    expect(await generate({ params: { lang: "en" } })).toEqual([
      { topic: "intro" },
    ]);
    expect(paths()).toEqual(["dynamic /en/docs/intro"]);
  });

  it("fills an optional catch-all, with and without its values", async () => {
    writeFileSync(
      join(appDir, ".next/server/app-paths-manifest.json"),
      JSON.stringify({ "/(site)/guide/[[...path]]/page": "app/page.js" })
    );
    await seoStaticParams(
      "/guide/[[...path]]",
      () => [{}, { path: ["setup", "first steps"] }, { path: [""] }],
      { appDir }
    )();
    expect(paths()).toEqual([
      "dynamic /guide",
      "dynamic /guide/setup/first%20steps",
    ]);
  });

  it("lists the declared pages while the build runs, before the prerender manifest exists", async () => {
    await seoStaticParams(
      "/blog/[topic]",
      () => [{ topic: "seo" }, { topic: "ai tools" }],
      { appDir }
    )();
    expect(paths()).toEqual([
      "dynamic /blog/ai%20tools",
      "dynamic /blog/seo",
      "built /pricing",
    ]);
  });

  it("records nothing outside `next build`", async () => {
    delete process.env.NEXT_PHASE;
    await seoStaticParams("/blog/[topic]", () => [{ topic: "seo" }], {
      appDir,
    })();
    expect(declaredAddresses(join(appDir, ".next"))).toEqual([]);
  });

  it("leaves out an address no visitor can be served at, as every code page's address", async () => {
    await seoStaticParams(
      "/blog/[topic]",
      () => [{ topic: "ok" }, { topic: "" }, { topic: "a?b" }],
      { appDir }
    )();
    expect(paths().filter(path => path.startsWith("dynamic"))).toEqual([
      "dynamic /blog/a%3Fb",
      "dynamic /blog/ok",
    ]);
  });

  it("loses and repeats no address when parallel workers record at once", async () => {
    const topics = Array.from({ length: 40 }, (_, i) => ({ topic: `t${i}` }));
    // Two workers each record every page, a third some of them.
    await Promise.all([
      seoStaticParams("/blog/[topic]", () => topics, { appDir })(),
      seoStaticParams("/blog/[topic]", () => topics, { appDir })(),
      seoStaticParams("/blog/[topic]", () => topics.slice(0, 10), {
        appDir,
      })(),
    ]);
    const listed = paths().filter(path => path.startsWith("dynamic"));
    expect(listed).toHaveLength(40);
    expect(new Set(listed).size).toBe(40);
  });

  it("gives way to the prerender manifest once the build has written it", async () => {
    await seoStaticParams("/blog/[topic]", () => [{ topic: "seo" }], {
      appDir,
    })();
    writeFileSync(
      join(appDir, ".next/prerender-manifest.json"),
      JSON.stringify({
        version: 4,
        routes: {
          "/pricing": { srcRoute: "/pricing" },
          "/blog/news": { srcRoute: "/blog/[topic]" },
        },
      })
    );
    expect(paths()).toEqual(["dynamic /blog/news", "built /pricing"]);
  });

  it("warns once of a write that fails, and still returns the site's params", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A file where the plugin's folder would go: nothing can be written there.
    writeFileSync(join(appDir, ".next/nextly-seo"), "");
    chmodSync(join(appDir, ".next/nextly-seo"), 0o400);
    const params = [{ topic: "seo" }];
    const generate = seoStaticParams("/blog/[topic]", () => params, {
      appDir,
    });
    expect(await generate()).toBe(params);
    expect(await generate()).toBe(params);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(readdirSync(join(appDir, ".next"))).not.toContain("static-params");
  });
});
