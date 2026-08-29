/**
 * What the page builder publishes to the browser, and whether it can be.
 *
 * `clientConfig` is refused at BOOT unless it survives a JSON round trip
 * unchanged. That makes the check worth having here rather than trusting the
 * shape: the failure is not a wrong value in the admin, it is the whole plugin
 * failing to start.
 *
 * @module plugin-client-config.test
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { pageBuilder } from "./plugin";

/** The config as the boot-time validator sees it. */
function clientConfig(plugin: ReturnType<typeof pageBuilder>): unknown {
  return (
    plugin.contributes as { admin?: { clientConfig?: unknown } } | undefined
  )?.admin?.clientConfig;
}

describe("the limits published to the admin", () => {
  it("survives the round trip the boot check demands, with an INFINITE bound", () => {
    /*
     * The engine supports an infinite byte limit outright. `Infinity` is not a
     * JSON value though — it round-trips to `null` — so publishing it raw makes
     * the config differ from its own serialisation, which is exactly what the
     * validator refuses.
     */
    const config = clientConfig(
      pageBuilder({ limits: { ...DEFAULT_LIMITS, maxBytes: Infinity } })
    );
    expect(config).toBeDefined();
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });

  it("spells an infinite bound as null rather than dropping it", () => {
    // Dropping the key would have the admin fall back to the engine default,
    // which is a bound where the host asked for none.
    const config = clientConfig(
      pageBuilder({ limits: { ...DEFAULT_LIMITS, maxBytes: Infinity } })
    ) as { limits?: Record<string, unknown> };
    expect(config.limits).toBeDefined();
    expect(Object.keys(config.limits ?? {})).toContain("maxBytes");
    expect(config.limits?.maxBytes).toBeNull();
  });

  it("carries a finite bound through untouched", () => {
    // The control: a finite value must NOT be turned into null, or every
    // configured bound would read as "no bound" in the admin.
    const config = clientConfig(
      pageBuilder({ limits: { ...DEFAULT_LIMITS, maxNodes: 12 } })
    ) as { limits?: Record<string, unknown> };
    expect(config.limits?.maxNodes).toBe(12);
  });
});
