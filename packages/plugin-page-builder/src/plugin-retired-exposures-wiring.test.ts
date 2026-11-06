/**
 * Whether installing the plugin wires the retirement of removed component
 * fields, and leaves it out where no collection stands for the components a
 * page renders.
 *
 * `retired-exposure-hooks.test.ts` drives the hooks directly, so all of it
 * passes with the registration deleted from `init`, or left in where a host
 * draws components from its own source and the plugin's store would strip
 * fields that source still exposes.
 *
 * @module plugin-retired-exposures-wiring.test
 */
import { describe, expect, it, vi } from "vitest";

import { COMPONENTS_SLUG } from "./collections/components";
import { pageBuilder, type PageBuilderOptions } from "./plugin";

/** The registrations `init` makes, as `phase collection` pairs. */
async function registrations(options?: PageBuilderOptions): Promise<string[]> {
  const on = vi.fn();
  await pageBuilder(options).init?.({
    self: {
      collections: {},
      singles: {},
      name: "@nextlyhq/plugin-page-builder",
    },
    hooks: {
      on,
      off: vi.fn(),
      onBeforeOperation: vi.fn(),
      offBeforeOperation: vi.fn(),
      onInTransaction: vi.fn(),
      offInTransaction: vi.fn(),
    },
    services: {
      collections: { getCollection: vi.fn(async () => ({})) },
      plugins: {},
    },
    config: {},
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  } as never);
  return on.mock.calls.map(([phase, collection]) => `${phase} ${collection}`);
}

describe("the retirement of removed component fields, as installed", () => {
  it("records on the component store and strips on every write", async () => {
    const wired = await registrations();

    expect(wired).toContain(`afterUpdate ${COMPONENTS_SLUG}`);
    expect(wired).toContain("beforeCreate *");
    expect(wired).toContain("beforeUpdate *");
  });

  it("follows a host that keeps components in another collection", async () => {
    const wired = await registrations({
      componentReadiness: { collection: "blocks_library" },
    });

    expect(wired).toContain("afterUpdate blocks_library");
  });

  it("is not wired where the host renders components from its own source", async () => {
    const wired = await registrations({ componentReadiness: false });

    expect(wired).not.toContain(`afterUpdate ${COMPONENTS_SLUG}`);
    expect(wired).not.toContain("beforeCreate *");
    expect(wired).not.toContain("beforeUpdate *");
  });
});
