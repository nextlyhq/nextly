/**
 * Task 1 — ground the boot-safe Builder column apply.
 *
 * The flagged risk for plugin-access-to-UI-Builder-entities was whether the
 * Builder's column apply can be driven outside an admin request. It resolved
 * to: the boot-safe apply already exists as `addMissingColumnsForFields` (the
 * util dev-push already uses, dev-server.ts:589) — non-request-coupled,
 * add-only, idempotent. This test pins that it materialises a plugin-style
 * field onto an existing UI-Builder (`dc_*`) table and is a no-op on re-run.
 */
import { describe, expect, it, afterEach } from "vitest";

import { addMissingColumnsForFields } from "../../domains/schema/utils/missing-columns";
import type { FieldConfig } from "../../collections/fields/types";
import type { Logger } from "../../services/shared";
import { createTestNextly, type TestNextly } from "../test-nextly";

import { seedBuilderCollection } from "./seed-builder-entity";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("boot-safe column apply for UI-Builder tables (Task 1)", () => {
  it("materialises a plugin field onto an existing dynamic table; idempotent re-run", async () => {
    current = await createTestNextly(); // real boot → adapter has system tables
    const { tableName } = await seedBuilderCollection(current.adapter, {
      slug: "articles",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });

    const desired = [
      { name: "body", type: "text" },
      { name: "meta_title", type: "text" },
    ] as unknown as FieldConfig[];

    const added = await addMissingColumnsForFields(
      current.adapter,
      silentLogger,
      tableName,
      desired,
      { timestamps: true }
    );
    expect(added).toContain("meta_title");

    // Re-run with the same desired set → nothing left to add (idempotent).
    const again = await addMissingColumnsForFields(
      current.adapter,
      silentLogger,
      tableName,
      desired,
      { timestamps: true }
    );
    expect(again).toHaveLength(0);
  });
});
