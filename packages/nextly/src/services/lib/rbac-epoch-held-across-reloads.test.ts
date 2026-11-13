/**
 * The role version's state survives a dev server's module reload on
 * `globalThis`, so the state an older build of this module made is still
 * there when the new one runs. Before the shared read moved onto `coalesce`,
 * that state held the read under way as `inFlight`, a promise or null; the
 * reloaded module reads its own field and must not trip over the old one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";

const holder = globalThis as unknown as Record<string, unknown>;
const KEY = "__nextly_rbacEpoch";

function chain(result: unknown) {
  const self: Record<string, unknown> = {
    from: () => self,
    where: () => self,
    set: () => self,
    values: () => self,
    limit: () => self,
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  return self;
}

let previous: unknown;
afterEach(() => {
  if (previous === undefined) delete holder[KEY];
  else holder[KEY] = previous;
  vi.resetModules();
});

describe("the role version across a module reload", () => {
  it("reads past the state an older build of the module left on globalThis", async () => {
    previous = holder[KEY];
    // The state as the module kept it before its read moved onto
    // `coalesce`: the read under way a promise or null.
    holder[KEY] = {
      revision: 0,
      generation: "",
      readAt: 0,
      inFlight: null,
      pendingBumps: 0,
      observed: true,
      retirements: 0,
      degraded: false,
      unannounced: 0,
    };
    vi.resetModules();
    const { refreshEpoch, currentEpoch } = await import("./rbac-epoch");
    container.register("adapter", () => ({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => ({
        select: () => chain([{ revision: 7, generation: "g" }]),
        update: () => chain([{ changes: 1 }]),
        insert: () => chain([{ changes: 1 }]),
      }),
    }));

    const read = await refreshEpoch({ force: true });

    expect(read).toBe(currentEpoch());
    expect(read).toContain("7");
  });
});
