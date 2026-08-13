/**
 * The handler store is populated when the route module is imported, before any
 * `setup` transformer has run, and the public admin-meta endpoint reads it
 * without initializing services. Boot therefore has to correct it — but only
 * the part boot actually recomputed, and without depending on whether boot or
 * the route module got there first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import type { NextlyServiceConfig } from "../di/register";
import type { PluginDefinition } from "../plugins/plugin-context";

// The store is module state and nothing here reaches the service layer, so the
// module's heavier imports are stubbed. Each test re-imports the module to get
// a fresh store, and without this that re-import pulls the whole dependency
// graph six times — measured at 10.07s against vitest's 10s default, which is
// a timeout waiting for a loaded CI machine rather than a real failure.
const servicesRegistered = vi.fn(() => true);
vi.mock("../di", () => ({
  registerServices: vi.fn(),
  isServicesRegistered: () => servicesRegistered(),
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

/**
 * A boot result in the shape `registerServices` publishes. Only the blocks the
 * store republishes matter here; the rest of `NextlyServiceConfig` is adapter
 * and processor wiring this seam never reads.
 */
function booted(config: Partial<NextlyServiceConfig>): NextlyServiceConfig {
  return config as NextlyServiceConfig;
}

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
    // BOTH, or a value left by an earlier test satisfies the next one's
    // assertion and the suite reports coverage it does not have.
    delete (globalThis as { __nextly_bootConfig?: unknown })
      .__nextly_bootConfig;
    servicesRegistered.mockReturnValue(true);
    store = await import("./auth-handler");
  });

  it("replaces the plugin list when boot runs after the route module", () => {
    store.setHandlerConfig(stored);

    store.setBootedConfig(booted({ plugins: plugins("@acme/transformed") }));

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

    store.setBootedConfig(booted({ plugins: plugins("@acme/transformed") }));

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
    store.setBootedConfig(booted({ plugins: plugins("@acme/transformed") }));

    store.setHandlerConfig(stored);

    expect(names(store)).toEqual(["@acme/transformed"]);
  });

  /**
   * Route-module HMR re-evaluates the module and stores the raw config again
   * without re-running boot. The booted list has to survive that.
   */
  it("keeps the booted list when the raw config is stored again", () => {
    store.setHandlerConfig(stored);
    store.setBootedConfig(booted({ plugins: plugins("@acme/transformed") }));

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

    store.setBootedConfig(booted({ plugins: [] }));

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

    store.setBootedConfig(booted({}));

    expect(names(store)).toEqual([]);
  });

  /**
   * The store answers for the route config's existence, not boot's: a process
   * that booted services without ever importing the route module has no
   * branding, no `db` and no `storage` to report, and a plugin list alone must
   * not be dressed up as a config.
   */
  /**
   * A `setup` transformer may ADD a top-level collection or single, and the
   * permission fold decides whether a `publish` declaration names an entity.
   * Publishing only the plugin half leaves the endpoint folding against the raw
   * route config, so a declaration on a transformer-added entity reads as a
   * plugin-owned custom permission that boot actually drops.
   */
  it("reports the entities boot registered, whole", () => {
    store.setHandlerConfig(stored);

    store.setBootedConfig(
      booted({
        plugins: plugins("@acme/transformed"),
        collections: [
          { slug: "reports", dbName: "acme_reports", fields: [] },
        ] as unknown as NextlyServiceConfig["collections"],
        singles: [
          { slug: "site", fields: [] },
        ] as unknown as NextlyServiceConfig["singles"],
      })
    );

    const view = store.getHandlerConfig();
    expect(view?.collections?.map(c => c.slug)).toEqual(["reports"]);
    expect(view?.singles?.map(s => s.slug)).toEqual(["site"]);
    // The DEFINITION, not a slug projection of it. `runProdMigrationsIfEnabled`
    // reads this store and passes it to `resolveDeclaredSchema`, which resolves
    // a table name from `dbName`; an earlier version rebuilt these entries as
    // `{ slug }` and made drift verification look for a table that never
    // existed. This assertion is what stops that returning.
    expect(view?.collections?.[0]).toMatchObject({ dbName: "acme_reports" });
  });

  /**
   * App-level `config.permissions` too, not just plugin declarations. A `setup`
   * transformer may remove or replace a top-level declaration that collides
   * with a plugin's — registration then validates the transformed config and
   * succeeds, but if the raw declaration is what this store keeps reporting,
   * `adminMetaPermissions()` sees a collision that no longer exists and
   * degrades to an empty set, hiding every seeded plugin permission from the
   * detail page.
   */
  it("reports the app permissions boot registered, not the declared ones", () => {
    store.setHandlerConfig({
      ...stored,
      permissions: [{ action: "purge", resource: "cache" }],
    } as unknown as SanitizedNextlyConfig);

    store.setBootedConfig(
      booted({
        plugins: plugins("@acme/transformed"),
        permissions: [{ action: "archive", resource: "reports" }],
      })
    );

    expect(store.getHandlerConfig()?.permissions?.map(p => p.action)).toEqual([
      "archive",
    ]);
  });

  it("reports no config when only a plugin list has been recorded", () => {
    store.setBootedConfig(booted({ plugins: plugins("@acme/transformed") }));

    expect(store.getHandlerConfig()).toBeNull();
  });

  /**
   * The list describes a RUNNING runtime. `shutdownServices()` and
   * `clearServices()` both reset the registration flag, and a re-boot that then
   * FAILS leaves no runtime at all — so continuing to substitute the previous
   * boot's plugins would report a plugin set and route state that nothing is
   * serving, indefinitely, since admin-meta never initializes services.
   */
  it("stops reporting the booted list once services are no longer registered", () => {
    store.setHandlerConfig(stored);
    store.setBootedConfig(booted({ plugins: plugins("@acme/transformed") }));
    expect(store.getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/transformed",
    ]);

    servicesRegistered.mockReturnValue(false);

    // Back to what the author declared, which is the honest answer when no
    // successful boot stands behind the store.
    expect(store.getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/raw",
    ]);
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
    booting.setBootedConfig(booted({ plugins: plugins("@acme/transformed") }));

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
    store.setBootedConfig(booted({ plugins: plugins("@acme/first") }));
    expect(store.getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/first",
    ]);

    store.setBootedConfig(booted({ plugins: plugins("@acme/second") }));

    expect(store.getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/second",
    ]);
  });
});
