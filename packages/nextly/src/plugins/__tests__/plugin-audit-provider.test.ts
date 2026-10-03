/**
 * `ctx.audit.write` never throws: the plugin is in the middle of doing the
 * thing the row describes, and a failed record must not fail that.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../observability/logger", () => ({
  getNextlyLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { createPluginAudit } from "../plugin-audit-provider";

const audit = createPluginAudit({
  name: "acme-auth",
  contributes: { audit: { kinds: [{ kind: "acme-auth.linked" }] } },
} as never);

describe("ctx.audit.write", () => {
  it("resolves when handed no event at all", async () => {
    // A JavaScript plugin has no types to stop this; the projection ran
    // outside the guard and rejected.
    await expect(audit.write(undefined as never)).resolves.toBeUndefined();
  });

  it("resolves for an event whose metadata is not an object", async () => {
    await expect(
      audit.write({ kind: "acme-auth.linked", metadata: 5 } as never)
    ).resolves.toBeUndefined();
  });
});
