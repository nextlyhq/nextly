import { describe, expect, it } from "vitest";

import { isReservedPath } from "../reserved-paths";

describe("isReservedPath", () => {
  it("reserves the framework prefixes and their children", () => {
    for (const path of [
      "/admin",
      "/admin/",
      "/admin/collections/posts",
      "/api",
      "/api/plugins/x",
      "/_next/static/chunk.js",
      "/static/logo.png",
    ]) {
      expect(isReservedPath(path)).toBe(true);
    }
  });

  it("reserves the well-known metadata files", () => {
    for (const path of [
      "/sitemap.xml",
      "/robots.txt",
      "/favicon.ico",
      "/manifest.webmanifest",
      "/manifest.json",
      "/opengraph-image",
      "/twitter-image",
    ]) {
      expect(isReservedPath(path)).toBe(true);
    }
  });

  it("allows ordinary content paths", () => {
    for (const path of [
      "/about",
      "/blog/hello-world",
      "/administration", // not /admin
      "/apiary", // not /api
      "/sitemap", // not /sitemap.xml
      "/",
    ]) {
      expect(isReservedPath(path)).toBe(false);
    }
  });

  it("normalizes a missing leading slash and a trailing slash", () => {
    expect(isReservedPath("admin")).toBe(true);
    expect(isReservedPath("about/")).toBe(false);
    expect(isReservedPath("api/")).toBe(true);
  });
});
