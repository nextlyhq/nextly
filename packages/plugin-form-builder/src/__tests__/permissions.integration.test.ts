/**
 * form-builder custom permissions (R4, D36).
 *
 * Proves the flagship plugin DECLARES a custom permission and that the
 * declaration passes the new boot-time permission validation (the canonical
 * example third-party authors copy). End-to-end seeding of custom permissions
 * is proven generically in the `nextly` package (seed-on-boot integration test);
 * the seed-path internals (`runPostInitTasks`, `collectCustomPermissions`) are
 * not part of the public surface a plugin package imports.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

let current: TestNextly | undefined;

beforeEach(() => {
  // form-builder's init guards against duplicate hook registration via a
  // globalThis flag; clear it so each boot re-registers cleanly.
  delete (globalThis as Record<string, unknown>)[
    "__formBuilder_afterCreate_form-submissions"
  ];
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("form-builder custom permissions (R4, D36)", () => {
  it("declares the export-submissions custom permission", () => {
    const { plugin } = formBuilder();
    expect(plugin.contributes?.permissions).toContainEqual(
      expect.objectContaining({ action: "export", resource: "submissions" })
    );
  });

  it("boots cleanly with the custom permission declared (passes boot validation)", async () => {
    current = await createTestNextly({ plugins: [formBuilder().plugin] });
    expect(current.nextly).toBeTruthy();
  });
});
