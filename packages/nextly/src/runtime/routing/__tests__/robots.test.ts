import { describe, expect, it } from "vitest";

import { nextlyRobots } from "../robots";

describe("nextlyRobots", () => {
  it("disallows /admin and /api and advertises the sitemap", () => {
    const robots = nextlyRobots({
      sitemap: "https://example.com/sitemap.xml",
    })();
    expect(robots).toEqual({
      rules: { userAgent: "*", disallow: ["/admin", "/api"] },
      sitemap: "https://example.com/sitemap.xml",
    });
  });

  it("merges and dedupes extra disallow paths and keeps the defaults", () => {
    const robots = nextlyRobots({ disallow: ["/api", "/drafts"] })();
    expect(robots.rules).toEqual({
      userAgent: "*",
      disallow: ["/admin", "/api", "/drafts"],
    });
  });

  it("passes through userAgent, allow, and host", () => {
    const robots = nextlyRobots({
      userAgent: "Googlebot",
      allow: ["/api/public"],
      host: "https://example.com",
    })();
    expect(robots.rules).toMatchObject({
      userAgent: "Googlebot",
      allow: ["/api/public"],
    });
    expect(robots.host).toBe("https://example.com");
  });

  it("omits the sitemap key when none is given", () => {
    const robots = nextlyRobots()();
    expect(robots).not.toHaveProperty("sitemap");
  });
});
