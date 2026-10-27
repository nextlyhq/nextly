/**
 * A route handler's request-path boot is refused on an unsupported Next.js
 * like `getNextly()` is: an app that never calls `getNextly()` reaches
 * services through `createDynamicHandlers`, and the gate sits where both
 * register them. The installed versions are the one thing faked.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

import { ensureServicesInitialized } from "../route-handler/auth-handler";
import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

vi.mock("../shared/lib/installed-package-version", () => ({
  installedPackageVersion: (_appRoot: string, name: string) =>
    name === "next" ? "15.5.0" : "19.3.1",
}));

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;
// sqlite is the one dialect that needs no connection string.
process.env.DB_DIALECT = "sqlite";

afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

describe("a cold request-path boot on an unsupported Next.js", () => {
  it("is refused, naming the installed version and its range", async () => {
    createDynamicHandlers({ config: sanitizeConfig({ collections: [] }) });

    await expect(ensureServicesInitialized()).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
      logContext: {
        problems: [
          { name: "next", installed: "15.5.0", supported: expect.any(String) },
        ],
      },
    });
  });
});
