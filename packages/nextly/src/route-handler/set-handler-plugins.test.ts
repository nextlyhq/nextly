/**
 * The handler store is populated when the route module is imported, before any
 * `setup` transformer has run, and the public admin-meta endpoint reads it
 * without initializing services. Boot therefore has to correct it — but only
 * the part boot actually recomputed, and without depending on whether boot or
 * the route module got there first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import type { PluginDefinition } from "../plugins/plugin-context";

// The store is module state and nothing here reaches the service layer, so the
// module's heavier imports are stubbed. Each test re-imports the module to get
// a fresh store, and without this that re-import pulls the whole dependency
// graph six times — measured at 10.07s against vitest's 10s default, which is
// a timeout waiting for a loaded CI machine rather than a real failure.
vi.mock("../di", () => ({
  registerServices: vi.fn(),
  isServicesRegistered: () => true,
  shutdownServices: vi.fn(),
  getService: () => undefined,
}));
vi.mock("../auth/handlers/deps-bridge", () => ({
  buildAuthRouterDeps: vi.fn(),
}));
vi.mock("../auth/handlers/router", () => ({ routeAuthRequest: vi.fn() }));
vi.mock("../runtime/hmr-listener", () => ({ ensureHmrListener: vi.fn() }));
vi.mock("../storage/image-processor", () => ({
  getImageProcessor: () => undefined,
}));

type HandlerStore = typeof import("./auth-handler");

const stored = {
  typescript: { enabled: true },
  db: { provider: "sqlite" },
  storage: { provider: "local" },
  admin: { branding: { logoText: "Acme" } },
  plugins: [{ name: "@acme/raw", version: "1.0.0" }],
} as unknown as SanitizedNextlyConfig;

function plugins(...names: string[]): PluginDefinition[] {
  return names.map(
    name => ({ name, version: "1.0.0" }) as unknown as PluginDefinition
  );
}

function names(store: HandlerStore): string[] | undefined {
  return store.getHandlerConfig()?.plugins?.map(p => p.name);
}

describe("the handler config store", () => {
  let store: HandlerStore;

  /**
   * A fresh module per test. Both values this store folds together live in
   * module scope and neither has a reset seam in production, so a test that
   * reused the module would inherit the previous one's boot list — and the
   * ordering assertions below turn on that list being absent to begin with.
   */
  beforeEach(async () => {
    vi.resetModules();
    delete (globalThis as { __nextly_bootPlugins?: unknown })
      .__nextly_bootPlugins;
    store = await import("./auth-handler");
  });

  it("replaces the plugin list when boot runs after the route module", () => {
    store.setHandlerConfig(stored);

    store.setHandlerPlugins(plugins("@acme/transformed"));

    expect(names(store)).toEqual(["@acme/transformed"]);
  });

  /**
   * The separating assertion, and the hazard that motivated a targeted setter:
   * the transformed config carries no `typescript`, `db` or `storage`, so
   * writing it wholesale would silently drop three fields this store holds and
   * the admin-meta endpoint reads.
   */
  it("leaves every other field of the stored config intact", () => {
    store.setHandlerConfig(stored);

    store.setHandlerPlugins(plugins("@acme/transformed"));

    const after = store.getHandlerConfig();
    expect(after?.typescript).toEqual({ enabled: true });
    expect(after?.db).toEqual({ provider: "sqlite" });
    expect(after?.storage).toEqual({ provider: "local" });
    expect(after?.admin?.branding?.logoText).toBe("Acme");
  });

  /**
   * The reversed order, which a boot through `getNextly()` or instrumentation
   * produces: services register before the route module is ever imported, so
   * there is no stored config to correct at the moment boot reports its list.
   */
  it("applies a plugin list recorded before any config was stored", () => {
    store.setHandlerPlugins(plugins("@acme/transformed"));

    store.setHandlerConfig(stored);

    expect(names(store)).toEqual(["@acme/transformed"]);
  });

  /**
   * Route-module HMR re-evaluates the module and stores the raw config again
   * without re-running boot. The booted list has to survive that.
   */
  it("keeps the booted list when the raw config is stored again", () => {
    store.setHandlerConfig(stored);
    store.setHandlerPlugins(plugins("@acme/transformed"));

    store.setHandlerConfig(stored);

    expect(names(store)).toEqual(["@acme/transformed"]);
  });

  /**
   * An empty list is what a transformer that removes every plugin produces.
   * Treating it as "boot reported nothing" would leave the author's declared
   * plugins on display, and admin-meta would advertise routes that never
   * mounted.
   */
  it("clears the declared plugins when boot produced none", () => {
    store.setHandlerConfig(stored);

    store.setHandlerPlugins([]);

    expect(names(store)).toEqual([]);
  });

  /**
   * The same fact arriving in the config's other spelling. `plugins` is
   * optional, so a boot that registered none hands over `undefined` rather than
   * an empty list, and reading that as "boot reported nothing" would leave the
   * declared plugins on display exactly as an empty list would.
   */
  it("clears the declared plugins when boot reported no list at all", () => {
    store.setHandlerConfig(stored);

    store.setHandlerPlugins(undefined);

    expect(names(store)).toEqual([]);
  });

  /**
   * The store answers for the route config's existence, not boot's: a process
   * that booted services without ever importing the route module has no
   * branding, no `db` and no `storage` to report, and a plugin list alone must
   * not be dressed up as a config.
   */
  it("reports no config when only a plugin list has been recorded", () => {
    store.setHandlerPlugins(plugins("@acme/transformed"));

    expect(store.getHandlerConfig()).toBeNull();
  });

  /**
   * Next.js and Turbopack can evaluate this module in more than one server
   * module graph, so instrumentation's boot may report its list to one copy
   * while `/admin-meta` reads another. A module-local value is null in the
   * reading copy and the endpoint falls back to the raw, pre-`setup` list —
   * the exact defect this seam removes, reappearing under a bundler.
   *
   * Two independently imported instances stand in for the two graphs.
   */
  it("shares the booted list across duplicate copies of the module", async () => {
    const booting = store;
    booting.setHandlerPlugins(plugins("@acme/transformed"));

    vi.resetModules();
    const serving: HandlerStore = await import("./auth-handler");
    serving.setHandlerConfig(stored);

    expect(serving.getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/transformed",
    ]);
  });

  /**
   * The memo is per-copy because one of its inputs is, so it cannot be cleared
   * by a writer that may be running in a different copy. Identity of both
   * inputs decides instead, and a second boot must be visible to a reader that
   * already built a view.
   */
  it("re-derives the view when a later boot replaces the list", () => {
    store.setHandlerConfig(stored);
    store.setHandlerPlugins(plugins("@acme/first"));
    expect(store.getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/first",
    ]);

    store.setHandlerPlugins(plugins("@acme/second"));

    expect(store.getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/second",
    ]);
  });
});
