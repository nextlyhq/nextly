/**
 * The handler store is populated when the route module is imported, before any
 * `setup` transformer has run, and the public admin-meta endpoint reads it
 * without initializing services. Boot therefore has to correct it — but only
 * the part boot actually recomputed.
 */
import { describe, expect, it } from "vitest";

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import type { PluginDefinition } from "../plugins/plugin-context";

import {
  getHandlerConfig,
  setHandlerConfig,
  setHandlerPlugins,
} from "./auth-handler";

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

describe("setHandlerPlugins", () => {
  it("replaces the plugin list", () => {
    setHandlerConfig(stored);

    setHandlerPlugins(plugins("@acme/transformed"));

    expect(getHandlerConfig()?.plugins?.map(p => p.name)).toEqual([
      "@acme/transformed",
    ]);
  });

  /**
   * The separating assertion, and the hazard that motivated a targeted setter:
   * the transformed config carries no `typescript`, `db` or `storage`, so
   * writing it wholesale would silently drop three fields this store holds and
   * the admin-meta endpoint reads.
   */
  it("leaves every other field of the stored config intact", () => {
    setHandlerConfig(stored);

    setHandlerPlugins(plugins("@acme/transformed"));

    const after = getHandlerConfig();
    expect(after?.typescript).toEqual({ enabled: true });
    expect(after?.db).toEqual({ provider: "sqlite" });
    expect(after?.storage).toEqual({ provider: "local" });
    expect(after?.admin?.branding?.logoText).toBe("Acme");
  });
});
