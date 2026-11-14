/**
 * The pages a site's routes render from their own code, read from what
 * `next build` wrote: routes with no variable part, and the addresses a
 * route with one declared, never a framework, admin or API route.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { addressOfAppPath, codeRoutesOf, readCodeRoutes } from "../routes";

describe("the address a page route serves", () => {
  it("drops route groups and the page file", () => {
    expect(addressOfAppPath("/(frontend)/pricing/page")).toBe("/pricing");
    expect(addressOfAppPath("/(frontend)/page")).toBe("/");
    expect(addressOfAppPath("/compare/[tool]/page")).toBe("/compare/[tool]");
  });

  it("answers nothing for a route that is not a page a visitor is served", () => {
    expect(addressOfAppPath("/sitemap.xml/route")).toBeUndefined();
    expect(addressOfAppPath("/_not-found/page")).toBeUndefined();
    expect(addressOfAppPath("/admin/[[...params]]/page")).toBeUndefined();
    expect(addressOfAppPath("/admin/page")).toBeUndefined();
    expect(addressOfAppPath("/api/things/page")).toBeUndefined();
    expect(addressOfAppPath("/feed/@modal/page")).toBeUndefined();
    expect(addressOfAppPath("/feed/(..)photo/[id]/page")).toBeUndefined();
  });

  it("keeps an address that only starts like the admin's", () => {
    expect(addressOfAppPath("/administration/page")).toBe("/administration");
  });
});

describe("the pages built in code", () => {
  it("lists each static route and each address a dynamic route declared, by address", () => {
    const routes = codeRoutesOf(
      [
        "/(frontend)/pricing/page",
        "/(frontend)/contact/page",
        "/(frontend)/integrations/[name]/page",
        "/(frontend)/compare/[tool]/page",
        "/admin/[[...params]]/page",
        "/robots.txt/route",
      ],
      [
        { path: "/pricing", srcRoute: "/pricing" },
        { path: "/integrations/wordpress", srcRoute: "/integrations/[name]" },
        { path: "/integrations/webflow", srcRoute: "/integrations/[name]" },
        { path: "/admin", srcRoute: "/admin/[[...params]]" },
        { path: "/elsewhere", srcRoute: null },
      ]
    );

    expect(routes).toEqual([
      {
        path: "/contact",
        source: "built",
        route: "app/(frontend)/contact/page",
      },
      {
        path: "/integrations/webflow",
        source: "dynamic",
        route: "app/(frontend)/integrations/[name]/page",
      },
      {
        path: "/integrations/wordpress",
        source: "dynamic",
        route: "app/(frontend)/integrations/[name]/page",
      },
      {
        path: "/pricing",
        source: "built",
        route: "app/(frontend)/pricing/page",
      },
    ]);
  });

  it("lists a route that declared no address with none", () => {
    expect(codeRoutesOf(["/compare/[tool]/page"], [])).toEqual([]);
  });
});

describe("reading the build", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** An app with its source and a production build of it. */
  function app(): string {
    dir = mkdtempSync(join(tmpdir(), "seo-code-routes-"));
    mkdirSync(join(dir, "src/app/(site)/pricing"), { recursive: true });
    writeFileSync(join(dir, "src/app/(site)/pricing/page.tsx"), "");
    mkdirSync(join(dir, "build/server"), { recursive: true });
    writeFileSync(
      join(dir, "build/server/app-paths-manifest.json"),
      JSON.stringify({
        "/(site)/pricing/page": "app/(site)/pricing/page.js",
        "/(site)/tools/[name]/page": "app/(site)/tools/[name]/page.js",
      })
    );
    writeFileSync(
      join(dir, "build/prerender-manifest.json"),
      JSON.stringify({
        version: 4,
        routes: {
          "/pricing": { srcRoute: "/pricing" },
          "/tools/counter": { srcRoute: "/tools/[name]" },
        },
      })
    );
    return dir;
  }

  it("reads the routes from the build directory, naming each route's source file", () => {
    const appDir = app();

    expect(readCodeRoutes({ appDir, buildDir: "build" })).toEqual([
      {
        path: "/pricing",
        source: "built",
        route: "src/app/(site)/pricing/page.tsx",
      },
      {
        path: "/tools/counter",
        source: "dynamic",
        route: "app/(site)/tools/[name]/page",
      },
    ]);
  });

  it("leaves out an address the build answered not found, a declared one or a fixed one", () => {
    const appDir = app();
    writeFileSync(
      join(appDir, "build/server/app-paths-manifest.json"),
      JSON.stringify({
        "/(site)/pricing/page": "app/(site)/pricing/page.js",
        "/(site)/retired/page": "app/(site)/retired/page.js",
        "/(site)/tools/[name]/page": "app/(site)/tools/[name]/page.js",
      })
    );
    writeFileSync(
      join(appDir, "build/prerender-manifest.json"),
      JSON.stringify({
        version: 4,
        routes: {
          "/pricing": { srcRoute: "/pricing", initialStatus: 200 },
          "/retired": { srcRoute: "/retired", initialStatus: 404 },
          "/tools/counter": { srcRoute: "/tools/[name]" },
          // A topic with nothing in it: its page calls `notFound()`.
          "/tools/empty": { srcRoute: "/tools/[name]", initialStatus: 404 },
        },
      })
    );

    expect(
      readCodeRoutes({ appDir, buildDir: "build" }).map(route => route.path)
    ).toEqual(["/pricing", "/tools/counter"]);
  });

  it("leaves out an address the build answered not found under Cache Components, read from its page's own record", () => {
    // With Cache Components on, Next.js writes no `initialStatus` to the
    // prerender manifest: a page that called `notFound()` while the build
    // rendered it says so only in the `.meta` file beside its HTML.
    const appDir = app();
    writeFileSync(
      join(appDir, "build/server/app-paths-manifest.json"),
      JSON.stringify({
        "/(site)/page": "app/(site)/page.js",
        "/(site)/pricing/page": "app/(site)/pricing/page.js",
        "/(site)/retired/page": "app/(site)/retired/page.js",
        "/(site)/tools/[name]/page": "app/(site)/tools/[name]/page.js",
      })
    );
    const partial = { renderingMode: "PARTIALLY_STATIC" };
    writeFileSync(
      join(appDir, "build/prerender-manifest.json"),
      JSON.stringify({
        version: 4,
        routes: {
          "/": { srcRoute: "/", ...partial },
          "/pricing": { srcRoute: "/pricing", ...partial },
          "/retired": { srcRoute: "/retired", ...partial },
          "/tools/counter": { srcRoute: "/tools/[name]", ...partial },
          "/tools/empty": { srcRoute: "/tools/[name]", ...partial },
          // No record of its own: listed, as before.
          "/tools/unrecorded": { srcRoute: "/tools/[name]", ...partial },
        },
      })
    );
    const meta = (path: string, status: number) => {
      const file = join(appDir, "build/server/app", `${path}.meta`);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify({ status, headers: {} }));
    };
    meta("index", 200);
    meta("pricing", 200);
    meta("retired", 404);
    meta("tools/counter", 200);
    meta("tools/empty", 404);

    expect(
      readCodeRoutes({ appDir, buildDir: "build" }).map(route => route.path)
    ).toEqual(["/", "/pricing", "/tools/counter", "/tools/unrecorded"]);
  });

  it("reads the record of a page at /index where Next.js keeps it, not the home page's", () => {
    // Next.js names a page's files from its path made unambiguous with the
    // home page's `index`: `/index` is kept as `index/index`, `/index/old`
    // as `index/index/old`.
    const appDir = app();
    writeFileSync(
      join(appDir, "build/server/app-paths-manifest.json"),
      JSON.stringify({
        "/(site)/page": "app/(site)/page.js",
        "/(site)/index/page": "app/(site)/index/page.js",
        "/(site)/index/old/page": "app/(site)/index/old/page.js",
      })
    );
    const partial = { renderingMode: "PARTIALLY_STATIC" };
    writeFileSync(
      join(appDir, "build/prerender-manifest.json"),
      JSON.stringify({
        version: 4,
        routes: {
          "/": { srcRoute: "/", ...partial },
          "/index": { srcRoute: "/index", ...partial },
          "/index/old": { srcRoute: "/index/old", ...partial },
        },
      })
    );
    const meta = (path: string, status: number) => {
      const file = join(appDir, "build/server/app", `${path}.meta`);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify({ status, headers: {} }));
    };
    meta("index", 404);
    meta("index/index", 200);
    meta("index/index/old", 404);

    expect(
      readCodeRoutes({ appDir, buildDir: "build" }).map(route => route.path)
    ).toEqual(["/index"]);
  });

  it("reads nothing where there is no build", () => {
    const appDir = app();

    expect(readCodeRoutes({ appDir, buildDir: "missing" })).toEqual([]);
  });
});

describe("the source file lookup in a Next.js build", () => {
  // Turbopack traces a filesystem call whose path it cannot bound, and a path
  // joined from the working directory and a route's name bounds to the whole
  // project, which the build then ships as server code. The annotation is
  // what keeps it out, and it is read where Turbopack reads it: in the call.
  it("marks each call that builds or reads the page's path for Turbopack to ignore", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../routes.ts"),
      "utf8"
    );
    const body = /function sourceFileOf\([^)]*\): string \{([\s\S]*?)\n\}/.exec(
      source
    )?.[1];
    expect(body).toBeDefined();
    const calls = [...(body ?? "").matchAll(/\b(existsSync|join)\(([^)]*)\)/g)];
    expect(calls.map(([, name]) => name).sort()).toEqual([
      "existsSync",
      "join",
    ]);
    for (const [call, , args] of calls) {
      expect(args?.trimStart(), call).toMatch(
        /^\/\*turbopackIgnore: true\*\/ /
      );
    }
  });
});
