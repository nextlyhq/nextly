/**
 * The release page loads in the browser without the server's schemas module.
 *
 * `nextly/schemas` is the server's barrel: loading it runs the server's
 * environment validation, which in a browser reports a missing database
 * setting on every admin page, since the admin is one client bundle. Its types
 * may be imported, and erase at build time; a value may not. Here the module
 * refuses to load at all, so any runtime import of it under the page fails
 * this file, while type-only imports pass.
 *
 * @module components/features/releases/__tests__/release-page-client-safe.test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("nextly/schemas", () => {
  throw new Error("nextly/schemas was loaded at runtime by the admin");
});

describe("the release page's modules", () => {
  it("load without the server's schemas module", async () => {
    await expect(import("../ReleaseDetail")).resolves.toHaveProperty(
      "ReleaseDetail"
    );
  });
});
