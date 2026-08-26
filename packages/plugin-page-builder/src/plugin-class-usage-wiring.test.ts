/**
 * Whether installing the plugin actually installs class-usage maintenance.
 *
 * Every other test in this area exercises the maintenance modules directly, so
 * all of them pass with the registration call deleted from `init` — measured:
 * removing it compiles and leaves the whole suite green. A host would then
 * install the plugin, get the index TABLE and nothing that writes to it, and
 * every class on the site would read as unused with no error anywhere.
 *
 * This is the one assertion that fails when the wiring is absent.
 *
 * @module plugin-class-usage-wiring.test
 */
import { describe, expect, it, vi } from "vitest";

import { pageBuilder } from "./plugin";

/** The parts of a plugin context `init` reaches for, and nothing more. */
function initContext() {
  const registered: string[] = [];
  const ctx = {
    hooks: {
      on: (type: string, collection: string) => {
        registered.push(`${type}:${collection}`);
      },
      off: vi.fn(),
      onBeforeOperation: vi.fn(),
      offBeforeOperation: vi.fn(),
    },
    services: {
      collections: { getCollection: vi.fn(async () => ({})) },
      plugins: {},
    },
    config: {},
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
  return { ctx, registered };
}

describe("installing the page-builder plugin", () => {
  it("registers class-usage maintenance on the after-phases", () => {
    const { ctx, registered } = initContext();

    // The plugin's own init, run the way a host runs it.
    (pageBuilder().init as (c: unknown) => void)(ctx);

    expect(registered).toContain("afterCreate:*");
    expect(registered).toContain("afterUpdate:*");
  });

  it("contributes the index table it maintains", () => {
    // The pair matters: a table with no maintenance silently records nothing,
    // and maintenance with no table fails every write it is called for. A host
    // installing the plugin is asking for both.
    const slugs = (pageBuilder().contributes?.collections ?? []).map(
      collection => (collection as { slug?: string }).slug
    );

    expect(slugs).toContain("nx_pb_class_usage");
  });
});
