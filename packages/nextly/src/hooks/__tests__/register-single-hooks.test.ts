/**
 * `registerSingleHooks` must bridge a code-first Single's declared hook phases to
 * the HookRegistry under the `single:<slug>` namespace the single services read,
 * mapping the update-only lifecycle correctly (a Single has no create/delete).
 */

import { describe, it, expect } from "vitest";

import type { SingleConfig } from "../../singles/config/types";
import { HookRegistry } from "../hook-registry";
import { registerSingleHooks } from "../register-single-hooks";

const noop = async () => undefined;

describe("registerSingleHooks", () => {
  it("registers each phase under single:<slug> with the update-only mapping", () => {
    const registry = new HookRegistry();
    const singles = [
      {
        slug: "branding",
        fields: [],
        hooks: {
          beforeRead: [noop],
          afterRead: [noop],
          beforeChange: [noop],
          afterChange: [noop],
        },
      },
    ] as unknown as SingleConfig[];

    const result = registerSingleHooks(singles, registry);

    const ns = "single:branding";
    expect(registry.getHookCount("beforeRead", ns)).toBe(1);
    expect(registry.getHookCount("afterRead", ns)).toBe(1);
    // beforeChange/afterChange map to the update registry types only — a Single
    // is auto-created and update-only, so no create hooks are registered.
    expect(registry.getHookCount("beforeUpdate", ns)).toBe(1);
    expect(registry.getHookCount("afterUpdate", ns)).toBe(1);
    expect(registry.getHookCount("beforeCreate", ns)).toBe(0);
    expect(registry.getHookCount("afterCreate", ns)).toBe(0);

    expect(result.totalHooks).toBe(4);
    expect(result.singles).toEqual(["branding"]);
  });

  it("registers every handler in a phase and skips singles without hooks", () => {
    const registry = new HookRegistry();
    const singles = [
      { slug: "with-hooks", fields: [], hooks: { afterRead: [noop, noop] } },
      { slug: "plain", fields: [] },
    ] as unknown as SingleConfig[];

    const result = registerSingleHooks(singles, registry);

    expect(registry.getHookCount("afterRead", "single:with-hooks")).toBe(2);
    expect(result.singles).toEqual(["with-hooks"]);
    expect(result.totalHooks).toBe(2);
  });

  it("discards an afterChange handler's return so it cannot rewrite the response", async () => {
    // afterChange is side-effect-only for Singles, but it maps to the shared
    // afterUpdate type whose runner applies a returned value; the registered
    // handler must therefore leave the stored document unchanged.
    const registry = new HookRegistry();
    const singles = [
      {
        slug: "branding",
        fields: [],
        hooks: {
          afterChange: [
            async ({ data }: { data: Record<string, unknown> }) => ({
              ...data,
              injected: true,
            }),
          ],
        },
      },
    ] as unknown as SingleConfig[];

    registerSingleHooks(singles, registry);

    const stored = { title: "Site" };
    const result = await registry.execute("afterUpdate", {
      collection: "single:branding",
      operation: "update",
      data: stored,
    });

    // The handler ran but its returned `injected` field was discarded.
    expect(result).toEqual({ title: "Site" });
    expect(result).not.toHaveProperty("injected");
  });

  it("keeps a beforeChange handler's return so it can transform the write data", async () => {
    // beforeChange legitimately transforms the data before the write, so its
    // return must survive (only afterChange is side-effect-only).
    const registry = new HookRegistry();
    const singles = [
      {
        slug: "branding",
        fields: [],
        hooks: {
          beforeChange: [
            async ({ data }: { data: Record<string, unknown> }) => ({
              ...data,
              normalized: true,
            }),
          ],
        },
      },
    ] as unknown as SingleConfig[];

    registerSingleHooks(singles, registry);

    const result = await registry.execute("beforeUpdate", {
      collection: "single:branding",
      operation: "update",
      data: { title: "Site" },
    });

    expect(result).toMatchObject({ title: "Site", normalized: true });
  });
});
