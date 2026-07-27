/**
 * A Single's declared configuration must actually take effect end to end:
 * - its `hooks` run on the read and update paths (they were never registered), and
 * - its field `defaultValue`s apply on the first-read auto-create (a function
 *   default was lost when field metadata is serialized to `dynamic_singles`).
 *
 * Both were documented config that silently did nothing; this pins them on a
 * real database through the full service wiring.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkbox, defineSingle, group, text } from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // Single hooks register into the global registry; clear it between tests.
  resetHookRegistry();
});

describe("single config honored — hooks + defaults (integration)", () => {
  it("runs declared hooks and applies function/structured defaults on first read", async () => {
    const beforeRead = vi.fn(async () => undefined);
    const afterRead = vi.fn(async (ctx: { data: unknown }) => ctx.data);
    const beforeChange = vi.fn(async (ctx: { data: unknown }) => ctx.data);
    const afterChange = vi.fn(async (ctx: { data: unknown }) => ctx.data);

    const branding = defineSingle({
      slug: "branding",
      status: true,
      hooks: {
        beforeRead: [beforeRead],
        afterRead: [afterRead],
        beforeChange: [beforeChange],
        afterChange: [afterChange],
      },
      fields: [
        text({ name: "siteName", defaultValue: () => "Acme" }),
        group({
          name: "settings",
          fields: [checkbox({ name: "private" })],
          defaultValue: () => ({ private: true }),
        }),
      ],
    });

    // Single hooks register automatically during framework boot
    // (registerServices), so no manual registration is needed — a Direct-API
    // consumer gets them the same way.
    current = await createTestNextly({ singles: [branding] });

    const service =
      current.getService<SingleEntryService>("singleEntryService");

    // First read auto-creates the row: its declared defaults apply (061) and the
    // read hooks run (060).
    const read = await service.get("branding", { overrideAccess: true });

    expect(read.success).toBe(true);
    // 061: function default resolved, structured default deserialized (not a
    // stringified function).
    expect(read.data?.siteName).toBe("Acme");
    expect(read.data?.settings).toEqual({ private: true });
    // 060: read hooks fired.
    expect(beforeRead).toHaveBeenCalled();
    expect(afterRead).toHaveBeenCalled();

    // An update runs the change hooks (060), mapped to the update lifecycle.
    const updated = await service.update(
      "branding",
      { siteName: "Beta" },
      { overrideAccess: true }
    );
    expect(updated.success).toBe(true);
    expect(beforeChange).toHaveBeenCalled();
    expect(afterChange).toHaveBeenCalled();
  });
});
