import { describe, it, expect } from "vitest";

import { createTestNextly } from "../../../plugins/test-nextly";

// A fresh boot must create nextly_versions AND register it in the adapter's
// table resolver, so an adapter select against it succeeds (empty result).
describe("nextly_versions table (integration)", () => {
  it("is created on boot and resolvable by the adapter", async () => {
    const handle = await createTestNextly();
    try {
      const rows = await handle.adapter.select("nextly_versions");
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    } finally {
      await handle.destroy();
    }
  });
});
