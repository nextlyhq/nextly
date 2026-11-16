/**
 * The site-wide spacing switch is gone from the plugin: its route is not
 * served, and a host that still passes `siteStyle.spacingMode` starts with one
 * warning naming the removed option, its value ignored.
 *
 * @module plugin-spacing-removal.test
 */
import { describe, expect, it, vi } from "vitest";

import { SITE_STYLE_ROUTE_PATH } from "./library-contract";
import { pageBuilder } from "./plugin";

/** The path the owner's spacing choice was saved through, before it went. */
const REMOVED_ROUTE_PATH = "/site/style/spacing-mode";

/** The parts of a plugin context `init` reaches for, with a logger to read. */
function initContext() {
  const warn = vi.fn();
  return {
    warn,
    context: {
      self: {
        collections: {},
        singles: {},
        name: "@nextlyhq/plugin-page-builder",
      },
      hooks: {
        on: vi.fn(),
        off: vi.fn(),
        onBeforeOperation: vi.fn(),
        offBeforeOperation: vi.fn(),
        onInTransaction: vi.fn(),
        offInTransaction: vi.fn(),
        onCollectionDelete: vi.fn(),
      },
      services: {
        collections: { getCollection: vi.fn(async () => ({})) },
        plugins: {},
      },
      config: {},
      logger: { error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() },
      dialect: "sqlite",
      db: { select: () => emptyRead, table: () => ({}) },
    },
  };
}

/** A read of the plugin's table, however it is narrowed: no rows. */
const emptyRead = {
  all: async () => [],
  where: () => emptyRead,
};

/** The warnings `init` logged that name the removed option. */
async function spacingWarnings(siteStyle: unknown): Promise<unknown[]> {
  const { warn, context } = initContext();
  // An untyped host: the option is no longer in the type.
  const plugin = pageBuilder({ siteStyle } as never);
  await plugin.init?.(context as never);
  return warn.mock.calls
    .map(call => call[0])
    .filter(
      message =>
        typeof message === "string" && message.includes("siteStyle.spacingMode")
    );
}

describe("the spacing switch, removed", () => {
  it("serves no route to change it, beside the site style's own route", () => {
    const paths = (pageBuilder().contributes?.routes ?? []).map(
      route => route.path
    );
    expect(paths).not.toContain(REMOVED_ROUTE_PATH);
    // The control: the routes were read, and the site style's is among them.
    expect(paths).toContain(SITE_STYLE_ROUTE_PATH);
  });

  it("warns once, naming the option and saying it was removed, when a host still passes it", async () => {
    const warnings = await spacingWarnings({ spacingMode: "classic" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/siteStyle\.spacingMode.*removed/);
  });

  it("says nothing when the option is absent, which is the control", async () => {
    expect(await spacingWarnings({ tokens: { tokens: [] } })).toEqual([]);
    expect(await spacingWarnings(undefined)).toEqual([]);
  });
});
