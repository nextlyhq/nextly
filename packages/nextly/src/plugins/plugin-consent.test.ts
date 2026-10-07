/**
 * A plugin holds a capability that needs the app's consent only when it
 * declares it AND the app lists it; an enabled plugin that declares it
 * unlisted refuses the boot, naming itself and the config line to add.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";
import { buildServiceConfig } from "../init/build-service-config";
import type { SanitizedNextlyConfig } from "../shared/types/config";
import { sanitizeConfig } from "../shared/types/config";

import {
  assertPluginConsent,
  NO_PLUGIN_CONSENT,
  pluginConsentFromConfig,
} from "./plugin-consent";
import type { PluginDefinition } from "./plugin-context";
import { resolvePlugins } from "./resolve";

const plugin = (
  name: string,
  over: Partial<PluginDefinition> = {}
): PluginDefinition => ({ name, version: "1.0.0", nextly: "*", ...over });

const rawSql = (name: string, over: Partial<PluginDefinition> = {}) =>
  plugin(name, { capabilities: { db: { rawSql: true } }, ...over });

/** The refusal `run` throws, or undefined when it throws nothing. */
function refusal(run: () => unknown): NextlyError | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  return undefined;
}

describe("assertPluginConsent for capabilities.db.rawSql", () => {
  it("accepts a plugin that declares it and is listed", () => {
    expect(() =>
      assertPluginConsent([rawSql("@acme/reports")], {
        rawSql: ["@acme/reports"],
      })
    ).not.toThrow();
  });

  it("refuses an unlisted plugin, naming it and the line to add", () => {
    const error = refusal(() =>
      assertPluginConsent([rawSql("@acme/reports")], NO_PLUGIN_CONSENT)
    );

    expect(error?.code).toBe("PLUGIN_RESOLUTION_ERROR");
    expect(error?.logContext).toMatchObject({
      reason: "capability-not-listed",
      plugins: ["@acme/reports"],
      capability: "capabilities.db.rawSql",
      configLine: 'db: { rawSqlPlugins: ["@acme/reports"] }',
    });
    expect(error?.logMessage).toContain('Plugin "@acme/reports" declares');
    expect(error?.logMessage).toContain(
      'nextly.config.ts: db: { rawSqlPlugins: ["@acme/reports"] }'
    );
  });

  it("names every unlisted plugin, in a line that keeps the listed ones", () => {
    const error = refusal(() =>
      assertPluginConsent(
        [rawSql("@acme/listed"), rawSql("@acme/a"), rawSql("@acme/b")],
        { rawSql: ["@acme/listed"] }
      )
    );

    expect(error?.logContext).toMatchObject({
      plugins: ["@acme/a", "@acme/b"],
      configLine:
        'db: { rawSqlPlugins: ["@acme/listed", "@acme/a", "@acme/b"] }',
    });
    expect(error?.logMessage).toContain('Plugins "@acme/a", "@acme/b" declare');
  });

  it("does not refuse a plugin that does not declare it", () => {
    expect(() =>
      assertPluginConsent(
        [
          plugin("@acme/plain"),
          plugin("@acme/explicit-off", {
            capabilities: { db: { rawSql: false } },
          }),
        ],
        NO_PLUGIN_CONSENT
      )
    ).not.toThrow();
  });

  it("does not check a disabled plugin", () => {
    expect(() =>
      assertPluginConsent(
        [rawSql("@acme/off", { enabled: false })],
        NO_PLUGIN_CONSENT
      )
    ).not.toThrow();
  });

  it("does not let one plugin's listing cover another", () => {
    const error = refusal(() =>
      assertPluginConsent([rawSql("@acme/reports")], {
        rawSql: ["@acme/other"],
      })
    );
    expect(error?.logContext).toMatchObject({ plugins: ["@acme/reports"] });
  });
});

describe("resolvePlugins and the app's consent", () => {
  // The wiring: the boot and the CLI both reach the check through here.
  it("refuses an unlisted rawSql plugin when no consent is passed", () => {
    expect(
      refusal(() =>
        resolvePlugins([rawSql("@acme/reports")], { coreVersion: "1.0.0" })
      )?.logContext
    ).toMatchObject({ reason: "capability-not-listed" });
  });

  it("accepts it when the consent lists it", () => {
    expect(() =>
      resolvePlugins([rawSql("@acme/reports")], {
        coreVersion: "1.0.0",
        consent: { rawSql: ["@acme/reports"] },
      })
    ).not.toThrow();
  });
});

describe("the consent an app's config makes", () => {
  it("is a copy nothing can push onto, nor is the empty consent", () => {
    const listed = ["@acme/reports"];
    const consent = pluginConsentFromConfig({ db: { rawSqlPlugins: listed } });

    expect(() => (consent.rawSql as string[]).push("@evil/p")).toThrow(
      TypeError
    );
    expect(() =>
      (NO_PLUGIN_CONSENT.rawSql as string[]).push("@evil/p")
    ).toThrow(TypeError);
    // A later change to the app's own list does not reach the copy either.
    listed.push("@evil/p");
    expect(consent.rawSql).toEqual(["@acme/reports"]);
    expect(Object.isFrozen(consent)).toBe(true);
  });

  it("is read from db.rawSqlPlugins, and is empty without it", () => {
    expect(
      pluginConsentFromConfig({ db: { rawSqlPlugins: ["@acme/reports"] } })
    ).toEqual({ rawSql: ["@acme/reports"] });
    expect(pluginConsentFromConfig({})).toEqual({ rawSql: [] });
  });

  it("survives sanitizing the config", () => {
    const sanitized = sanitizeConfig({
      db: { rawSqlPlugins: ["@acme/reports"] },
    });
    expect(sanitized.db.rawSqlPlugins).toEqual(["@acme/reports"]);
    expect(sanitizeConfig({}).db.rawSqlPlugins).toEqual([]);
  });

  it("reaches the service config the boot resolves plugins with", () => {
    const result = buildServiceConfig({
      config: {
        db: { rawSqlPlugins: ["@acme/reports"] },
      } as unknown as SanitizedNextlyConfig,
    } as Parameters<typeof buildServiceConfig>[0]);
    expect(result.pluginConsent).toEqual({ rawSql: ["@acme/reports"] });
  });
});
