import { describe, expect, it } from "vitest";

import { nextlyRobots } from "../robots";

describe("nextlyRobots", () => {
  it("disallows the /admin and /api roots on a path boundary and advertises the sitemap", () => {
    const robots = nextlyRobots({
      sitemap: "https://example.com/sitemap.xml",
    })();
    expect(robots).toEqual({
      rules: {
        userAgent: "*",
        disallow: ["/admin/", "/admin$", "/admin?", "/api/", "/api$", "/api?"],
      },
      sitemap: "https://example.com/sitemap.xml",
    });
  });

  it("does not blanket-exclude a similarly-prefixed content path like /administration", () => {
    const { rules } = nextlyRobots()();
    const disallow = rules.disallow as string[];
    // A raw `/admin` prefix would match `/administration`; the boundary forms
    // (`/admin/`, `/admin$`, `/admin?`) do not.
    expect(disallow).not.toContain("/admin");
    expect(disallow.some(rule => "/administration".startsWith(rule))).toBe(
      false
    );
  });

  it("covers the bare root, subtree, and query variants of a framework root", () => {
    const disallow = nextlyRobots()().rules.disallow as string[];
    // Subtree, exact-root ($), and query-bearing root (?) are all pinned.
    expect(disallow).toContain("/admin/");
    expect(disallow).toContain("/admin$");
    expect(disallow).toContain("/admin?");
  });

  it("merges and dedupes extra disallow paths and keeps the defaults", () => {
    const robots = nextlyRobots({ disallow: ["/api/", "/drafts"] })();
    expect(robots.rules).toEqual({
      userAgent: "*",
      disallow: [
        "/admin/",
        "/admin$",
        "/admin?",
        "/api/",
        "/api$",
        "/api?",
        "/drafts",
      ],
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
