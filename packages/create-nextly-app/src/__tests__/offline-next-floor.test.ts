/**
 * The Next.js range a new app declares when the npm registry cannot be read.
 *
 * Online, a scaffold asks the registry for the latest `next` and
 * `eslint-config-next`. Offline, or behind a mirror that refuses the request,
 * it writes a fallback range instead, and an offline cache or private mirror
 * then installs whatever that range admits. So the fallback must admit no
 * release older than the one Nextly's own `next` peer accepts: that floor is
 * the first release without the advisories the peer excludes. Held here to
 * `nextly`'s published peer, so the two cannot drift apart.
 */
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig } from "../types";

const pgDatabase: DatabaseConfig = {
  type: "postgresql",
  adapter: "@nextlyhq/adapter-postgres",
  databaseDriver: "pg",
  connectionUrl: "postgresql://localhost/test",
  envExample: "postgresql://localhost/test",
};

/** The lowest Next.js 16 release `nextly`'s own `next` peer accepts. */
function nextlyNext16Floor(): string | undefined {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../nextly/package.json", import.meta.url),
      "utf8"
    )
  );
  return /\^(16\.\d+\.\d+)/.exec(manifest.peerDependencies.next)?.[1];
}

describe("a scaffold made while the npm registry cannot be read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("declares no Next.js older than nextly's own peer accepts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    // A fresh module, so no earlier test's registry answer is cached in it.
    const { generatePackageJson } = await import("../utils/template");
    const floor = nextlyNext16Floor();
    expect(floor).toMatch(/^16\./);

    const pkg = JSON.parse(
      await generatePackageJson("offline-app", pgDatabase)
    );
    expect(pkg.dependencies.next).toBe(`^${floor}`);
    expect(pkg.devDependencies["eslint-config-next"]).toBe(`^${floor}`);
  });
});
