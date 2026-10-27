/**
 * `getNextly()` is where nextly starts, so it is where an app on an unsupported
 * Next.js, React or React DOM is refused: through the real entry, not the
 * check alone. The installed versions are the one thing faked, so the refusal
 * observed is the one an app on Next.js 15 would see.
 */
import { describe, expect, it, vi } from "vitest";

import { defineConfig } from "../collections/config/define-config";

vi.mock("../shared/lib/installed-package-version", () => ({
  installedPackageVersion: (_appRoot: string, name: string) =>
    name === "next" ? "15.5.0" : "19.3.1",
}));

const { getNextly } = await import("../init");

describe("getNextly on an unsupported Next.js", () => {
  it("refuses to start, naming the installed version and its range", async () => {
    await expect(getNextly({ config: defineConfig({}) })).rejects.toMatchObject(
      {
        code: "CONFIGURATION_ERROR",
        logContext: {
          problems: [
            {
              name: "next",
              installed: "15.5.0",
              supported: expect.any(String),
            },
          ],
        },
      }
    );
  });
});
