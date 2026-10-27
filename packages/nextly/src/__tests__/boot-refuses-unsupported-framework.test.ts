/**
 * Every way nextly starts refuses an unsupported Next.js, because the gate sits
 * in `registerServices()`, which both boots reach: `getNextly()`, and a route
 * handler's request-path boot for an app that never calls it. The installed
 * versions are the one thing faked. One file for both, since each boot loads
 * the whole service registry.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../collections/config/define-config";
import { sanitizeConfig } from "../shared/types/config";

vi.mock("../shared/lib/installed-package-version", () => ({
  installedPackageVersion: (_appRoot: string, name: string) =>
    name === "next" ? "15.5.0" : "19.3.1",
}));

const { getNextly } = await import("../init");
const { ensureServicesInitialized } = await import(
  "../route-handler/auth-handler"
);
const { createDynamicHandlers } = await import("../routeHandler");

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
});
