import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PUBLIC_ROUTE_PATHS, ROUTES } from "../routes";

/**
 * Three things answer "which routes are reachable without a session", and only
 * two of them can be tied together by the compiler.
 *
 * `PUBLIC_ROUTE_PATHS` is the declaration. The registry keys its public pages
 * by `PublicRoutePath`, so those two cannot disagree without a build failure,
 * and the refresh interceptor builds its set from the same array. The third is
 * the `pages/(auth)/` directory, which is a filesystem convention no type can
 * reach — a page added there is a URL a visitor can open whether or not
 * anything declared it public.
 *
 * So this reads the directory. It is the only one of the three that can catch a
 * page nobody declared, and the failure it prevents is specific: an undeclared
 * auth page still renders, but the interceptor redirects its expected 401 to
 * login and discards the URL. An invite token was lost exactly that way.
 */
const AUTH_PAGES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "pages",
  "(auth)"
);

/**
 * Page files, by the convention the registry follows: `login.tsx` answers
 * `/admin/login`. Only top-level `.tsx` is read, so a future subdirectory of
 * shared parts is not mistaken for a route.
 */
function authPageFiles(): string[] {
  return readdirSync(AUTH_PAGES_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".tsx"))
    .map(entry => entry.name.replace(/\.tsx$/, ""))
    .sort();
}

describe("public route declaration", () => {
  // Guards the guard: every assertion below is satisfied by an empty directory,
  // so a wrong path, a rename or a glob that stops matching would let the rest
  // of this file pass without reading anything.
  it("reads the auth pages directory", () => {
    expect(authPageFiles().length).toBeGreaterThan(0);
    expect(authPageFiles()).toContain("login");
  });

  it("declares every page under (auth) as public", () => {
    const declared = new Set<string>(PUBLIC_ROUTE_PATHS);
    const missing = authPageFiles()
      .map(name => `/admin/${name}`)
      .filter(path => !declared.has(path));

    expect(missing).toEqual([]);
  });

  it("declares no path without a page behind it", () => {
    const pages = new Set(authPageFiles().map(name => `/admin/${name}`));
    const orphaned = PUBLIC_ROUTE_PATHS.filter(path => !pages.has(path));

    expect(orphaned).toEqual([]);
  });

  it("names paths from ROUTES rather than spelling them again", () => {
    const known = new Set<string>(Object.values(ROUTES));
    const unknown = PUBLIC_ROUTE_PATHS.filter(path => !known.has(path));

    expect(unknown).toEqual([]);
  });
});
