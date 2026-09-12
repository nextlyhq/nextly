/**
 * Whether installing the plugin actually installs the cycle guard.
 *
 * `component-cycle-guard.test.ts` exercises the guard directly, so all of it
 * passes with the registration call deleted from `init`. A host would then
 * install the plugin and get no write-time check at all, with nothing anywhere
 * reporting its absence — the failure is silent by construction, because a
 * guard that never runs refuses nothing and a library with no loops in it looks
 * exactly the same either way.
 *
 * This is the one assertion that fails when the wiring is absent.
 *
 * @module plugin-cycle-guard-wiring.test
 */
import { describe, expect, it, vi } from "vitest";

import { COMPONENTS_SLUG } from "./collections/components";
import { pageBuilder } from "./plugin";

/** The parts of a plugin context `init` reaches for, and nothing more. */
function initContext(renameMap: Record<string, string> = {}) {
  const registered: string[] = [];
  const ctx = {
    self: {
      collections: {
        ...renameMap,
      },
      singles: {},
      name: "@nextlyhq/plugin-page-builder",
    },
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

/** Every `beforeChange` registration the install made. */
const beforeChanges = (registered: readonly string[]) =>
  registered.filter(entry => entry.startsWith("beforeChange:"));

describe("the cycle guard is installed by the plugin", () => {
  it("registers on beforeChange for the components collection", async () => {
    const { ctx, registered } = initContext();

    await pageBuilder().init?.(ctx as never);

    expect(beforeChanges(registered)).toContain(
      `beforeChange:${COMPONENTS_SLUG}`
    );
  });

  it("follows a host's rename of that collection", async () => {
    // A guard holding the declared name would register on a collection nothing
    // writes to, and refuse nothing, silently.
    const { ctx, registered } = initContext({
      [COMPONENTS_SLUG]: "host_components",
    });

    await pageBuilder().init?.(ctx as never);

    expect(beforeChanges(registered)).toContain("beforeChange:host_components");
    expect(beforeChanges(registered)).not.toContain(
      `beforeChange:${COMPONENTS_SLUG}`
    );
  });

  it("registers on the store a host was told to keep components in", async () => {
    // The library reads that collection literally, so the guard watches the
    // one the writes actually land in.
    const { ctx, registered } = initContext({
      [COMPONENTS_SLUG]: "host_components",
    });

    await pageBuilder({
      componentReadiness: { collection: "site_components", field: "blocks" },
    }).init?.(ctx as never);

    expect(beforeChanges(registered)).toContain("beforeChange:site_components");
  });
});
