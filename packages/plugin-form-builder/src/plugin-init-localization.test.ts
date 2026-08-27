import { describe, expect, it, vi } from "vitest";

import { formBuilder } from "./plugin";

/**
 * A plugin context with just the surface `init` touches.
 *
 * `getCollection` is supplied per boot so a lookup can succeed once and fail
 * the next time, which is the sequence the reset exists for.
 */
function bootContext(getCollection: (slug: string) => Promise<unknown>) {
  return {
    self: { collections: {} as Record<string, string> },
    services: { collections: { getCollection } },
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    // `init` also subscribes the submission-notification hook. Stubbed
    // because this file is about what it RECORDS, not what it subscribes.
    hooks: { on: vi.fn(), off: vi.fn() },
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  } as never;
}

describe("what init records about each redirect target", () => {
  it("records the collection's own localized setting", async () => {
    const { plugin, config } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });

    await plugin.init?.(bootContext(async () => ({ localized: true })));

    expect(config.redirectTargetLocalization).toEqual({ pages: true });
  });

  it("leaves a slug it could not read ABSENT rather than false", async () => {
    // Absent means undecided, which reports as `"unknown"` and refuses
    // nothing. A `false` here would claim the collection is not localized and
    // mark a reachable translation as a draft.
    const { plugin, config } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });

    await plugin.init?.(
      bootContext(async () => {
        throw new Error("registry unavailable");
      })
    );

    expect(config.redirectTargetLocalization).toEqual({});
  });

  it("forgets the previous boot's answer when the next lookup fails", async () => {
    // `init` runs again on HMR against the SAME config object. Without a reset
    // the old value stands while the catch believes it left the slug absent —
    // a stale `false` drops a localized target's redirect, a stale `true` lets
    // a plain draft target through.
    const { plugin, config } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });

    await plugin.init?.(bootContext(async () => ({ localized: true })));
    expect(config.redirectTargetLocalization).toEqual({ pages: true });

    await plugin.init?.(
      bootContext(async () => {
        throw new Error("registry unavailable on this boot");
      })
    );
    expect(config.redirectTargetLocalization).toEqual({});
  });
});
