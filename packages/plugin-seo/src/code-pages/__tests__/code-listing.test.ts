/**
 * The one list of pages built in code: the build's files, what the build
 * being served recorded, and what the options state, each address once,
 * with the build's files as the cross-check; the params a route is handed
 * at an address; and the `codeAddresses` option, checked at start.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildIdIn } from "../build-record";
import { withKnownAddresses } from "../code-listing";
import { paramsOfAddress, type CodeBuild } from "../routes";
import { statedAddressesOf } from "../stated";

const BUILD: CodeBuild = {
  routes: [{ path: "/pricing", source: "built", route: "app/pricing/page" }],
  dynamic: [
    { address: "/docs/[[...slug]]", route: "app/docs/[[...slug]]/page" },
    { address: "/compare/[slug]", route: "app/compare/[slug]/page" },
  ],
  notFound: ["/compare/gone"],
};

describe("the pages built in code the running site lists", () => {
  it("adds what the build recorded and the options state, each once, behind the build's files", () => {
    const routes = withKnownAddresses(
      BUILD,
      [
        { path: "/docs", declared: false },
        { path: "/docs/a/b", declared: false },
        { path: "/pricing", declared: false },
        { path: "/compare/x", route: "/compare/[slug]", declared: true },
      ],
      [
        { path: "/compare/x", pattern: "/compare/[slug]" },
        { path: "/compare/y", pattern: "/compare/[slug]" },
      ]
    );
    expect(
      routes.map(({ path, source, route, listedBy, declared }) => ({
        path,
        source,
        route,
        listedBy,
        declared,
      }))
    ).toEqual([
      {
        path: "/compare/x",
        source: "dynamic",
        route: "app/compare/[slug]/page",
        listedBy: "build-record",
        declared: true,
      },
      {
        path: "/compare/y",
        source: "dynamic",
        route: "app/compare/[slug]/page",
        listedBy: "options",
        declared: true,
      },
      {
        path: "/docs",
        source: "dynamic",
        route: "app/docs/[[...slug]]/page",
        listedBy: "build-record",
        declared: true,
      },
      {
        path: "/docs/a/b",
        source: "dynamic",
        route: "app/docs/[[...slug]]/page",
        listedBy: "build-record",
        declared: true,
      },
      // The build's own file wins: a fixed route stays a built page.
      {
        path: "/pricing",
        source: "built",
        route: "app/pricing/page",
        listedBy: undefined,
        declared: undefined,
      },
    ]);
  });

  it("leaves out an address the build answered not found, and one no route of the build serves", () => {
    const routes = withKnownAddresses(
      BUILD,
      [
        { path: "/compare/gone", declared: false },
        { path: "/retired/page", declared: false },
      ],
      [{ path: "/blog/post", pattern: "/blog/[slug]" }]
    );
    expect(routes.map(route => route.path)).toEqual(["/pricing"]);
  });

  it("keeps a recorded address where the build's app paths name no route at all", () => {
    const routes = withKnownAddresses(
      { routes: [], dynamic: [] },
      [{ path: "/docs/a", route: "/docs/[[...slug]]", declared: true }],
      []
    );
    expect(routes).toEqual([
      {
        path: "/docs/a",
        source: "dynamic",
        route: "/docs/[[...slug]]",
        declared: true,
        listedBy: "build-record",
      },
    ]);
  });
});

describe("the params a route hands its page", () => {
  it("names each variable part as generateStaticParams would", () => {
    expect(paramsOfAddress("/docs/[[...slug]]", "/docs")).toEqual({});
    expect(paramsOfAddress("/docs/[[...slug]]", "/docs/a/b")).toEqual({
      slug: ["a", "b"],
    });
    expect(paramsOfAddress("/[lang]/[...rest]", "/en/x%20y")).toEqual({
      lang: "en",
      rest: ["x y"],
    });
    expect(paramsOfAddress("/compare/[slug]", "/compare/x")).toEqual({
      slug: "x",
    });
    expect(paramsOfAddress("/compare/[slug]", "/compare/x/y")).toBeUndefined();
    expect(paramsOfAddress("/docs/[...slug]", "/docs")).toBeUndefined();
  });
});

/** A context whose logger records each warning. */
function contextWithWarnings() {
  const warn = vi.fn();
  return { ctx: { logger: { warn } } as unknown as PluginContext, warn };
}

describe("the codeAddresses option", () => {
  it("refuses a route that isn't one, naming it", () => {
    expect(() => statedAddressesOf({ "docs/[slug]": () => [] })).toThrow(
      /codeAddresses "docs\/\[slug\]"/
    );
    expect(() =>
      statedAddressesOf({ "/docs/[...slug]/edit": () => [] })
    ).toThrow(/catch-all only as its last segment/);
    expect(() =>
      statedAddressesOf({
        "/docs/[slug]": { markdown: "text" } as unknown as {
          markdown: () => string;
        },
      })
    ).toThrow(/codeAddresses "\/docs\/\[slug\]\.markdown"/);
  });

  it("lists the pages each route's params name, and warns once of params missing a part", async () => {
    const stated = statedAddressesOf({
      "/products/[slug]": () => [{ slug: "b" }, {}, { slug: "a" }],
      "/teams/[team]/[member]": async () => [{ team: "x", member: "y" }],
    });
    const { ctx, warn } = contextWithWarnings();
    expect(await stated.addresses(ctx)).toEqual([
      { path: "/products/a", pattern: "/products/[slug]" },
      { path: "/products/b", pattern: "/products/[slug]" },
      { path: "/teams/x/y", pattern: "/teams/[team]/[member]" },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toEqual({ route: "/products/[slug]" });
  });

  it("lists nothing for a route whose params can't be read, and warns", async () => {
    const stated = statedAddressesOf({
      "/products/[slug]": () => {
        throw new Error("database down");
      },
    });
    const { ctx, warn } = contextWithWarnings();
    expect(await stated.addresses(ctx)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("finds the Markdown of the most specific route serving an address, with its params", () => {
    const docs = () => "docs";
    const guide = () => "guide";
    const stated = statedAddressesOf({
      "/docs/[[...slug]]": { markdown: docs },
      "/docs/guide": { markdown: guide },
      "/blog/[slug]": () => [],
    });
    expect(stated.markdownAt("/docs/a/b")).toEqual({
      markdown: docs,
      page: { path: "/docs/a/b", params: { slug: ["a", "b"] } },
    });
    expect(stated.markdownAt("/docs/guide")?.markdown).toBe(guide);
    expect(stated.markdownAt("/blog/x")).toBeUndefined();
    expect(stated.markdownAt("/elsewhere")).toBeUndefined();
  });
});

describe("the id of the build being served", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("is what next build wrote, and none where it wrote none", () => {
    dir = mkdtempSync(join(tmpdir(), "seo-build-id-"));
    expect(buildIdIn(dir)).toBeUndefined();
    writeFileSync(join(dir, "BUILD_ID"), "abc123\n");
    expect(buildIdIn(dir)).toBe("abc123");
    writeFileSync(join(dir, "BUILD_ID"), "  \n");
    expect(buildIdIn(dir)).toBeUndefined();
  });
});
