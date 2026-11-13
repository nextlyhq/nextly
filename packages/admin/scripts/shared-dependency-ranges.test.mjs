/**
 * The packages the admin leaves to the application, shared with `@nextlyhq/ui`,
 * are declared at the range `@nextlyhq/ui` declares.
 *
 * The admin's build bundles most of its dependencies, but not these: `@nextlyhq/ui`,
 * a peer every application installs, depends on them too, so the application's
 * bundler can give both packages one copy. That holds only while the two
 * ranges agree. Were they to drift apart, a package manager could install two
 * versions, and the application would ship both again, one per package.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const manifestOf = name =>
  JSON.parse(readFileSync(join(PACKAGES, name, "package.json"), "utf8"));

/** The packages the admin's build leaves external although it once bundled them. */
const SHARED = name =>
  name.startsWith("@radix-ui/") ||
  ["tailwind-merge", "clsx", "class-variance-authority"].includes(name);

describe("the dependencies the admin shares with @nextlyhq/ui", () => {
  const admin = manifestOf("admin").dependencies;
  const ui = {
    ...manifestOf("ui").dependencies,
    ...manifestOf("ui").peerDependencies,
  };
  const shared = Object.keys(admin).filter(SHARED);

  it("are each one @nextlyhq/ui declares, at the same range", () => {
    expect(shared.length).toBeGreaterThan(3);
    expect(
      shared
        .filter(name => ui[name] !== admin[name])
        .map(name => `${name}: admin ${admin[name]}, ui ${ui[name] ?? "none"}`)
    ).toEqual([]);
  });
});
