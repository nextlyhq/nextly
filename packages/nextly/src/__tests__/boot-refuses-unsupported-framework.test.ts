/**
 * Every way nextly starts refuses an unsupported Next.js, because the gate sits
 * in `registerServices()`, which both boots reach: `getNextly()`, and a route
 * handler's request-path boot for an app that never calls it. The installed
 * versions are the one thing faked, and the app directory they are read from
 * is the one the boot names. One file for both, since each boot loads
 * the whole service registry.
 */
import { resolve } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../collections/config/define-config";
import { sanitizeConfig } from "../shared/types/config";

// Which app directory each version read asked about.
const judgedRoots = vi.hoisted(() => [] as string[]);
// The one app that installs a supported Next.js.
const SUPPORTED_ROOT = vi.hoisted(() => "/projects/supported");

vi.mock("../shared/lib/installed-package-version", () => ({
  installedPackageVersion: (appRoot: string, name: string) => {
    judgedRoots.push(appRoot);
    // One app on a supported Next.js; every other on Next.js 15. Compared as
    // the boot hands it over, resolved: on Windows that adds the drive.
    if (name === "next") {
      return appRoot === resolve(SUPPORTED_ROOT) ? "16.4.2" : "15.5.0";
    }
    return "19.3.1";
  },
}));

const { getNextly } = await import("../init");
const { createDynamicHandlers } = await import("../routeHandler");
const { registerServices } = await import("../di/register");
const { getImageProcessor } = await import("../storage/image-processor");
const { ensureSupportedFrameworkVersions } = await import(
  "../runtime/framework-versions"
);

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;
// sqlite is the one dialect that needs no connection string.
process.env.DB_DIALECT = "sqlite";

afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

const REFUSAL = {
  code: "CONFIGURATION_ERROR",
  logContext: {
    problems: [
      { name: "next", installed: "15.5.0", supported: expect.any(String) },
    ],
  },
};

describe("starting nextly on an unsupported Next.js", () => {
  it("is refused through getNextly, naming the installed version and its range", async () => {
    await expect(getNextly({ config: defineConfig({}) })).rejects.toMatchObject(
      REFUSAL
    );
  });

  it("is refused through a cold request-path boot, by a generated handler", async () => {
    // A generated handler, not the boot function it calls, so a dispatcher
    // that stopped booting services would leave this red.
    const { GET } = createDynamicHandlers({
      config: sanitizeConfig({ collections: [] }),
    });

    // A request carrying a credential boots services before it is judged; an
    // anonymous one is refused without booting, by design. A boot that fails
    // is thrown from the handler, for Next.js to answer.
    await expect(
      GET(
        new Request("http://localhost/api/webhooks", {
          method: "GET",
          headers: { authorization: "Bearer any-key" },
        }),
        { params: Promise.resolve({ params: ["webhooks"] }) }
      )
    ).rejects.toMatchObject(REFUSAL);
  });

  it("judges the app the boot names, not the process's directory", async () => {
    // As the CLI boots for `--cwd apps/site`: the app is not where it runs.
    judgedRoots.length = 0;

    await expect(
      registerServices({
        appRoot: "/projects/site",
        imageProcessor: getImageProcessor(),
      })
    ).rejects.toMatchObject(REFUSAL);
    // Resolved, as the boot resolves it: `D:\projects\site` on Windows.
    expect(new Set(judgedRoots)).toEqual(new Set([resolve("/projects/site")]));
  });

  it("judges each app root on its own, so one that passed vouches for no other", async () => {
    // The check `registerServices()` makes, for an app that passes, as a
    // process that booted it first would have made it.
    expect(() =>
      ensureSupportedFrameworkVersions(SUPPORTED_ROOT)
    ).not.toThrow();

    await expect(
      registerServices({
        appRoot: "/projects/other",
        imageProcessor: getImageProcessor(),
      })
    ).rejects.toMatchObject(REFUSAL);
  });

  it("resolves a relative app root against the process's directory", async () => {
    judgedRoots.length = 0;

    await expect(
      registerServices({
        appRoot: "apps/site",
        imageProcessor: getImageProcessor(),
      })
    ).rejects.toMatchObject(REFUSAL);
    expect(new Set(judgedRoots)).toEqual(
      new Set([resolve(process.cwd(), "apps/site")])
    );
  });

  it("tears down the previous app's plugins before refusing the next", async () => {
    // What `clearServices()` leaves after app A: its plugins still running,
    // for the next registration to destroy.
    const destroyed: string[] = [];
    const registry = globalThis as unknown as {
      __nextly_pluginTeardown?: Array<{ plugin: unknown; context: unknown }>;
    };
    registry.__nextly_pluginTeardown = [
      {
        plugin: {
          name: "@acme/app-a",
          version: "1.0.0",
          destroy: () => {
            destroyed.push("@acme/app-a");
          },
        },
        context: {},
      },
    ];

    await expect(
      registerServices({
        appRoot: "/projects/app-b",
        imageProcessor: getImageProcessor(),
      })
    ).rejects.toMatchObject(REFUSAL);
    expect(destroyed).toEqual(["@acme/app-a"]);
  });
});
