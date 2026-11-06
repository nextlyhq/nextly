/**
 * The Next.js and React a new project declares.
 *
 * A new app gets the newest Next.js and React a Nextly release was reviewed
 * against, as a `~` range: patch releases of that minor, nothing newer. npm's
 * `latest` has no part in it, so a scaffold made the day a new minor or a new
 * major ships still declares what was reviewed. The registry here answers
 * with a newer `latest` for every package, and no request for these four is
 * expected at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig } from "../types";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

const FRAMEWORK = ["next", "eslint-config-next", "react", "react-dom"];

/** The registry, answering every dist-tags request with `latest`. */
function registryWithLatest(latest: string) {
  const fetch = vi.fn(async (_url: string) => ({
    ok: true,
    json: async () => ({ latest, alpha: "0.0.2-alpha.42" }),
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The dist-tags requests made for one of the four framework packages. */
function frameworkRequests(fetch: ReturnType<typeof registryWithLatest>) {
  return fetch.mock.calls
    .map(([url]) => decodeURIComponent(String(url)))
    .filter(url =>
      FRAMEWORK.some(name => url.endsWith(`/package/${name}/dist-tags`))
    );
}

describe("the framework versions a new project declares", () => {
  beforeEach(() => {
    // The module caches registry answers per run, so each case starts fresh.
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["a newer minor", "16.9.0"],
    ["a newer major", "17.0.0"],
  ])(
    "declares the reviewed versions when latest is %s",
    async (_label, latest) => {
      const fetch = registryWithLatest(latest);
      const { generatePackageJson } = await import("../utils/template");

      const pkg = JSON.parse(await generatePackageJson("app", sqlite));

      expect(pkg.dependencies.next).toBe("~16.4.2");
      expect(pkg.dependencies.react).toBe("~19.3.1");
      expect(pkg.dependencies["react-dom"]).toBe("~19.3.1");
      expect(pkg.devDependencies["eslint-config-next"]).toBe("~16.4.2");
      expect(frameworkRequests(fetch)).toEqual([]);
    }
  );

  it("gives a plugin the reviewed versions to develop on and the supported ranges as peers", async () => {
    const fetch = registryWithLatest("17.0.0");
    const { generatePackageJson } = await import("../utils/template");

    const pkg = JSON.parse(
      await generatePackageJson("my-plugin", sqlite, undefined, "plugin")
    );

    expect(pkg.devDependencies.next).toBe("~16.4.2");
    expect(pkg.devDependencies.react).toBe("~19.3.1");
    expect(pkg.devDependencies["react-dom"]).toBe("~19.3.1");
    // A plugin's peers say what it works with, which is every supported
    // release, not only the one it was developed on.
    expect(pkg.peerDependencies.react).toBe("^19.3.0");
    expect(pkg.peerDependencies["react-dom"]).toBe("^19.3.0");
    expect(frameworkRequests(fetch)).toEqual([]);
  });
});
