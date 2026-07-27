/**
 * Unit tests for the prebuilt-hook registry.
 *
 * Guards the retirement of the insecure `webhook-notification` prebuilt hook:
 * it shipped a bare (unsigned, non-SSRF-guarded) fetch and must not be
 * selectable. The signed webhook engine (admin Webhooks + delivery service) is
 * the sanctioned path for outbound notifications.
 */

import { describe, it, expect } from "vitest";

import type { StoredHookConfig } from "../../schemas/dynamic-collections/types";
import { prebuiltHooks, getPrebuiltHook } from "../prebuilt";
import { StoredHookExecutor } from "../stored-hook-executor";

describe("prebuilt hooks registry", () => {
  it("does not expose the retired webhook-notification hook", () => {
    expect(getPrebuiltHook("webhook-notification")).toBeUndefined();
    expect(prebuiltHooks.some(hook => hook.id === "webhook-notification")).toBe(
      false
    );
  });

  it("still exposes the safe prebuilt hooks", () => {
    const ids = prebuiltHooks.map(hook => hook.id);
    expect(ids).toEqual(
      expect.arrayContaining(["auto-slug", "audit-fields", "unique-validation"])
    );
  });

  it("skips a stored config that references the retired hook without firing or throwing", async () => {
    // A collection created before the retirement may still carry a stored
    // webhook-notification hook. It must degrade to a no-op, not crash the
    // write path, so existing data keeps saving after upgrade.
    const storedHooks: StoredHookConfig[] = [
      {
        hookId: "webhook-notification",
        hookType: "afterChange",
        enabled: true,
        config: { url: "https://example.com/hook" },
        order: 0,
      },
    ];

    const executor = new StoredHookExecutor();
    const result = await executor.execute("afterCreate", storedHooks, {
      collection: "posts",
      operation: "create",
      data: { title: "My Post" },
      context: {},
    });

    expect(result.skippedHookIds).toContain("webhook-notification");
    expect(result.executedCount).toBe(0);
    expect(result.data).toEqual({ title: "My Post" });
  });
});
