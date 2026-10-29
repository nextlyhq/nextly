import { describe, expect, it } from "vitest";

import { DEFAULT_PORTS } from "../worktree.mjs";

import {
  captureName,
  capturePlan,
  parseOptions,
  prodPort,
  publishedRoute,
  UsageError,
} from "./options.mjs";

describe("what the visual check is asked to do", () => {
  it("reads the routes and each flag", () => {
    expect(
      parseOptions([
        "/admin",
        "/admin/collections/posts",
        "--full",
        "--reuse",
        "--publish",
        "posts-list",
      ])
    ).toEqual(
      expect.objectContaining({
        routes: ["/admin", "/admin/collections/posts"],
        full: true,
        reuse: true,
        publish: "posts-list",
      })
    );
    expect(parseOptions(["/admin"])).toEqual(
      expect.objectContaining({ full: false, reuse: false, publish: undefined })
    );
  });

  it("refuses no route, a route that is not a path, and a topic a branch name cannot hold", () => {
    expect(() => parseOptions([])).toThrow(UsageError);
    expect(() => parseOptions(["admin"])).toThrow(UsageError);
    expect(() => parseOptions(["/admin", "--publish", "../main"])).toThrow(
      UsageError
    );
    expect(() => parseOptions(["/admin", "--publish", "a b"])).toThrow(
      UsageError
    );
    expect(() => parseOptions(["/admin", "--reuse", "--keep"])).toThrow(
      UsageError
    );
  });

  /*
   * Distinct names are the property: a naming that dropped the query or merged
   * separators would still produce a tidy name, and two routes would then
   * write over each other's captures.
   */
  it("names a capture after its route, width and scheme, one name per route", () => {
    expect(captureName("/admin", 390, "light")).toBe("admin-390-light.png");
    expect(captureName("/admin/collections/posts", 1440, "dark")).toBe(
      "admin-collections-posts-1440-dark.png"
    );
    expect(captureName("/", 1024, "light")).toBe("root-1024-light.png");
    expect(captureName("/admin/x?tab=fields", 390, "dark")).toMatch(
      /^admin-x-tab-[0-9a-f]{8}-390-dark\.png$/
    );
    expect(captureName("/admin/x", 390, "dark")).not.toBe(
      captureName("/admin/x?tab=fields", 390, "dark")
    );
  });

  /*
   * A capture's name is published: it is a file in the screenshot branch's
   * history and part of every raw URL in "The look". A query value such as a
   * reset token must never be in it, while two values of one key must still
   * name two captures.
   */
  it("keeps a query's values out of the name, and two values apart", () => {
    // Assembled from pieces, so no credential-shaped text sits in the source.
    const secret = ["f3a9", "c2e1", "7b64d08"].join("");
    const name = captureName(
      `/admin/reset-password?token=${secret}`,
      390,
      "light"
    );
    expect(name).not.toContain(secret);
    expect(name).toMatch(
      /^admin-reset-password-token-[0-9a-f]{8}-390-light\.png$/
    );
    expect(captureName("/admin/x?tab=fields", 390, "dark")).not.toBe(
      captureName("/admin/x?tab=api", 390, "dark")
    );
  });

  /*
   * A fragment is published the same way a query would be: an address such as
   * `#access_token=…` carries a credential there, and a `?` inside a fragment
   * is still the fragment's, not a query to read keys from. Distinct names
   * stay the property, so two fragments still name two captures.
   */
  it("keeps a fragment's text out of the name, and two fragments apart", () => {
    // Assembled from pieces, so no credential-shaped text sits in the source.
    const secret = ["9d1e", "a07c", "44b2f3"].join("");
    for (const route of [
      `/admin/plugin#access_token=${secret}`,
      `/admin/plugin#access_token=${secret}?view=1`,
      `/admin/plugin?tab=api#access_token=${secret}`,
    ]) {
      expect(captureName(route, 390, "light"), route).not.toContain(secret);
      expect(publishedRoute(route), route).not.toContain(secret);
    }
    expect(
      captureName(`/admin/plugin#access_token=${secret}`, 390, "light")
    ).toMatch(/^admin-plugin-[0-9a-f]{8}-390-light\.png$/);
    expect(
      publishedRoute(`/admin/plugin?tab=api#access_token=${secret}`)
    ).toMatch(/^\/admin\/plugin\?tab=…#[0-9a-f]{8}$/);
    expect(captureName("/admin/x#a", 390, "dark")).not.toBe(
      captureName("/admin/x#b", 390, "dark")
    );
    expect(captureName("/admin/x?tab=api", 390, "dark")).not.toBe(
      captureName("/admin/x?tab=api#more", 390, "dark")
    );
  });

  /*
   * Each of these passes a plain character check, and git refuses each as a
   * branch name; refused while parsing, they cost no build.
   */
  it("refuses a topic git cannot take as a branch name, before anything runs", () => {
    for (const topic of ["foo.", "foo.lock", "a..b"]) {
      expect(() => parseOptions(["/admin", "--publish", topic]), topic).toThrow(
        /pr-screenshots\//
      );
      expect(() => parseOptions(["--unpublish", topic]), topic).toThrow(
        UsageError
      );
    }
    expect(parseOptions(["/admin", "--publish", "posts.list_2"]).publish).toBe(
      "posts.list_2"
    );
  });

  it("takes --unpublish alone, with no route to capture", () => {
    expect(parseOptions(["--unpublish", "posts-list"])).toEqual(
      expect.objectContaining({ unpublish: "posts-list", routes: [] })
    );
    expect(() => parseOptions(["/admin", "--unpublish", "posts-list"])).toThrow(
      UsageError
    );
    expect(() => parseOptions(["--publish", "a", "--unpublish", "b"])).toThrow(
      UsageError
    );
  });

  it("takes --owner only with --unpublish, and --allow-findings only with --publish", () => {
    expect(parseOptions(["--unpublish", "t", "--owner", "feature-x"])).toEqual(
      expect.objectContaining({ unpublish: "t", owner: "feature-x" })
    );
    expect(() => parseOptions(["/admin", "--owner", "feature-x"])).toThrow(
      UsageError
    );
    expect(
      parseOptions(["/admin", "--publish", "t", "--allow-findings"])
    ).toEqual(expect.objectContaining({ publish: "t", allowFindings: true }));
    expect(() => parseOptions(["/admin", "--allow-findings"])).toThrow(
      UsageError
    );
  });

  it("takes --raw-base, an https address, only with --publish", () => {
    const base = "https://raw.githubusercontent.com/someone/fork";
    expect(
      parseOptions(["/admin", "--publish", "t", "--raw-base", base])
    ).toEqual(expect.objectContaining({ rawBase: base }));
    expect(() => parseOptions(["/admin", "--raw-base", base])).toThrow(
      UsageError
    );
    expect(() =>
      parseOptions(["/admin", "--publish", "t", "--raw-base", "raw.example/x"])
    ).toThrow(UsageError);
  });

  it("takes --prepare with routes to capture, and not with --unpublish", () => {
    expect(parseOptions(["/admin", "--prepare", "open.mjs"])).toEqual(
      expect.objectContaining({ prepare: "open.mjs" })
    );
    expect(() =>
      parseOptions(["--unpublish", "t", "--prepare", "open.mjs"])
    ).toThrow(UsageError);
  });

  it("answers --help with the usage, and nothing else to do", () => {
    expect(parseOptions(["--help"])).toEqual(
      expect.objectContaining({ help: true })
    );
  });

  it("refuses two routes whose captures would share a name", () => {
    expect(() => parseOptions(["/admin/a-b", "/admin/a/b"])).toThrow(
      /same capture names/
    );
  });

  it("plans six captures per route: three widths, light and dark", () => {
    const plan = capturePlan(["/admin"]);
    expect(plan.map(step => step.file)).toEqual([
      "admin-390-light.png",
      "admin-390-dark.png",
      "admin-1024-light.png",
      "admin-1024-dark.png",
      "admin-1440-light.png",
      "admin-1440-dark.png",
    ]);
    expect(capturePlan(["/admin", "/admin/media"])).toHaveLength(12);
  });

  it("serves on the checkout's own production port, from the environment or its slot settings", () => {
    expect(prodPort({ E2E_PROD_PORT: "3452" }, undefined)).toBe(3452);
    expect(prodPort({}, { env: { E2E_PROD_PORT: "3212" } })).toBe(3212);
    expect(
      prodPort({ E2E_PROD_PORT: "3452" }, { env: { E2E_PROD_PORT: "3212" } })
    ).toBe(3452);
    expect(prodPort({}, undefined)).toBe(DEFAULT_PORTS.E2E_PROD_PORT);
  });
});
