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
});
