/**
 * The handler store answers two questions with one value, and only one of them
 * is a registration input.
 *
 * `getHandlerConfig()` reports the config as it BOOTED, so the admin-meta
 * endpoint describes plugins as they actually run. Service registration reads
 * the RAW route config, because boot runs every plugin's `setup` transformer
 * over whatever it is given — and the dev recovery path re-registers within the
 * same process. Feeding boot its own output there makes an append-style
 * transformer duplicate its plugins and fail slug or route validation.
 *
 * Asserted by observing the argument `registerServices` actually receives,
 * rather than by reading module state through a seam that exists only for this
 * test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { PluginDefinition } from "../../plugins/plugin-context";

const registerServices = vi.fn();
const isServicesRegistered = vi.fn(() => false);

vi.mock("../../di", () => ({
  registerServices: (config: unknown) => registerServices(config),
  isServicesRegistered: () => isServicesRegistered(),
  shutdownServices: vi.fn(),
  // A permissive stub, deliberately. The assertion below is about the argument
  // `registerServices` receives, which is decided BEFORE any of these post-
  // registration steps run — so what they resolve to cannot affect it, and a
  // stub that throws only stops the walk short of the steps that follow.
  getService: () => new Proxy({}, { get: () => () => undefined }),
}));

vi.mock("../../runtime/hmr-listener", () => ({ ensureHmrListener: vi.fn() }));
vi.mock("../../storage/image-processor", () => ({
  getImageProcessor: () => undefined,
}));

const { ensureServicesInitialized, setHandlerConfig, setHandlerPlugins } =
  await import("../auth-handler");

function plugins(...names: string[]): PluginDefinition[] {
  return names.map(
    name => ({ name, version: "1.0.0" }) as unknown as PluginDefinition
  );
}

const raw = {
  plugins: plugins("@acme/declared"),
} as unknown as SanitizedNextlyConfig;

beforeEach(() => {
  vi.clearAllMocks();
  isServicesRegistered.mockReturnValue(false);
});

describe("the request-path registration input", () => {
  it("registers the RAW plugin list, not the one boot produced", async () => {
    setHandlerConfig(raw);
    // A previous boot in this process reported its transformed list, exactly
    // as `registerServices` does at the end of a successful registration.
    setHandlerPlugins(plugins("@acme/declared", "@acme/added-by-setup"));

    await ensureServicesInitialized();

    expect(registerServices).toHaveBeenCalledTimes(1);
    const registered = registerServices.mock.calls[0][0] as {
      plugins?: PluginDefinition[];
    };
    expect(registered.plugins?.map(p => p.name)).toEqual(["@acme/declared"]);
  });

  /**
   * The other half of the same store, in the same state. Without this the
   * assertion above is satisfied by a store that simply never recorded the
   * booted list, which would be the old defect rather than the fix.
   */
  it("still reports the booted list to readers of the config", async () => {
    const { getHandlerConfig } = await import("../auth-handler");
    // The read is gated on a registered runtime, because the booted list
    // describes one. This half of the pair is about what the store RECORDS, so
    // it stands in the state where that gate is open.
    isServicesRegistered.mockReturnValue(true);

    setHandlerConfig(raw);
    setHandlerPlugins(plugins("@acme/declared", "@acme/added-by-setup"));

    expect(getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/declared",
      "@acme/added-by-setup",
    ]);
  });
});
