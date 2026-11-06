/**
 * A plugin holds a capability that needs the app's consent only when it
 * declares it AND the app lists it; an enabled plugin that declares it
 * unlisted refuses the boot, naming itself and the config line to add.
 */
import { describe, expect, it, vi } from "vitest";

import {
  pluginField,
  pluginFieldBrand,
} from "../collections/fields/types/plugin-field";
import { NextlyError } from "../errors/nextly-error";
import { buildServiceConfig } from "../init/build-service-config";
import type { NextlyServiceConfig } from "../di/register";
import { resolveBootPlugins } from "../di/register";
import type { SanitizedNextlyConfig } from "../shared/types/config";
import { sanitizeConfig } from "../shared/types/config";

import {
  assertConsentDeclaredBeforeSetup,
  assertPluginConsent,
  decidePluginGrants,
  NO_PLUGIN_CONSENT,
  pluginConsentFromConfig,
  recordPreSetupPlugins,
  setupTransformerInput,
  snapshotPluginConsent,
  unmatchedConsentWarnings,
} from "./plugin-consent";
import type { PluginDefinition } from "./plugin-context";
import { resolvePlugins } from "./resolve";

const plugin = (
  name: string,
  over: Partial<PluginDefinition> = {}
): PluginDefinition => ({ name, version: "1.0.0", nextly: "*", ...over });

const rawSql = (name: string, over: Partial<PluginDefinition> = {}) =>
  plugin(name, { capabilities: { db: { rawSql: true } }, ...over });

const login = (name: string, over: Partial<PluginDefinition> = {}) =>
  plugin(name, { capabilities: { auth: { login: true } }, ...over });

/** A plugin whose `determineUser` hook decides who is signed in. */
const determineUser = (name: string, over: Partial<PluginDefinition> = {}) =>
  plugin(name, {
    contributes: { auth: { hooks: { determineUser: () => null } } },
    ...over,
  });

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

describe("assertPluginConsent for the login capability", () => {
  it("refuses an unlisted login plugin, naming it and the line to add", () => {
    const error = refusal(() =>
      assertPluginConsent([login("@acme/sso")], NO_PLUGIN_CONSENT)
    );

    expect(error?.code).toBe("PLUGIN_RESOLUTION_ERROR");
    expect(error?.logContext).toMatchObject({
      reason: "capability-not-listed",
      plugins: ["@acme/sso"],
      capability: "capabilities.auth.login or a determineUser auth hook",
      configLine: 'auth: { loginPlugins: ["@acme/sso"] }',
    });
    expect(error?.logMessage).toContain('Plugin "@acme/sso" declares');
    expect(error?.logMessage).toContain(
      'nextly.config.ts: auth: { loginPlugins: ["@acme/sso"] }'
    );
  });

  it("accepts a login plugin the app lists", () => {
    expect(() =>
      assertPluginConsent([login("@acme/sso")], {
        rawSql: [],
        login: ["@acme/sso"],
      })
    ).not.toThrow();
  });

  it("refuses a plugin whose determineUser hook decides who is signed in", () => {
    const error = refusal(() =>
      assertPluginConsent([determineUser("@acme/members")], NO_PLUGIN_CONSENT)
    );

    expect(error?.logContext).toMatchObject({
      reason: "capability-not-listed",
      plugins: ["@acme/members"],
      configLine: 'auth: { loginPlugins: ["@acme/members"] }',
    });
    expect(error?.logMessage).toContain('Plugin "@acme/members" declares');
    expect(error?.logMessage).toContain(
      'nextly.config.ts: auth: { loginPlugins: ["@acme/members"] }'
    );
  });

  it("does not refuse a plugin that declares neither spelling", () => {
    expect(() =>
      assertPluginConsent(
        [
          plugin("@acme/plain"),
          login("@acme/explicit-off", {
            capabilities: { auth: { login: false } },
          }),
        ],
        NO_PLUGIN_CONSENT
      )
    ).not.toThrow();
  });

  it("does not check a disabled plugin, in either spelling", () => {
    expect(() =>
      assertPluginConsent(
        [
          login("@acme/off", { enabled: false }),
          determineUser("@acme/hooks-off", { enabled: false }),
        ],
        NO_PLUGIN_CONSENT
      )
    ).not.toThrow();
  });

  it("names every login-capable plugin, in a line that keeps the listed ones", () => {
    const error = refusal(() =>
      assertPluginConsent(
        [login("@acme/listed"), login("@acme/a"), determineUser("@acme/b")],
        { rawSql: [], login: ["@acme/listed"] }
      )
    );

    expect(error?.logContext).toMatchObject({
      plugins: ["@acme/a", "@acme/b"],
      configLine:
        'auth: { loginPlugins: ["@acme/listed", "@acme/a", "@acme/b"] }',
    });
    expect(error?.logMessage).toContain('Plugins "@acme/a", "@acme/b" declare');
  });

  it("does not let one plugin's listing cover another", () => {
    const error = refusal(() =>
      assertPluginConsent([login("@acme/sso")], {
        rawSql: [],
        login: ["@acme/other"],
      })
    );
    expect(error?.logContext).toMatchObject({ plugins: ["@acme/sso"] });
  });
});

describe("resolvePlugins and the login listing", () => {
  it("refuses an unlisted login plugin when no consent is passed", () => {
    expect(
      refusal(() =>
        resolvePlugins([login("@acme/sso")], { coreVersion: "1.0.0" })
      )?.logContext
    ).toMatchObject({ reason: "capability-not-listed" });
  });

  it("accepts it when the consent lists it", () => {
    expect(() =>
      resolvePlugins([login("@acme/sso")], {
        coreVersion: "1.0.0",
        consent: { rawSql: [], login: ["@acme/sso"] },
      })
    ).not.toThrow();
  });
});

describe("a setup transformer and the login listing", () => {
  it("refuses the login capability a transformer adds", () => {
    const declared = recordPreSetupPlugins([plugin("@acme/reports")]);
    const transformed = [
      plugin("@acme/reports", { capabilities: { auth: { login: true } } }),
    ];

    expect(
      refusal(() => assertConsentDeclaredBeforeSetup(declared, transformed))
        ?.logContext
    ).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/reports",
    });
  });

  it("refuses a determineUser hook a transformer adds", () => {
    const declared = recordPreSetupPlugins([plugin("@acme/reports")]);
    const transformed = [determineUser("@acme/reports")];

    expect(
      refusal(() => assertConsentDeclaredBeforeSetup(declared, transformed))
        ?.logContext
    ).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/reports",
    });
  });
});

describe("decidePluginGrants for login", () => {
  it("grants the enabled plugins that declare either spelling", () => {
    const grants = decidePluginGrants([
      login("@acme/sso"),
      determineUser("@acme/members"),
      plugin("@acme/off", {
        enabled: false,
        capabilities: { auth: { login: true } },
      }),
    ]);

    expect(grants.login).toEqual(["@acme/sso", "@acme/members"]);
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
    ).toEqual({ rawSql: ["@acme/reports"], login: [] });
    expect(pluginConsentFromConfig({})).toEqual({ rawSql: [], login: [] });
  });

  it("is read from auth.loginPlugins alongside the rawSql listing", () => {
    expect(
      pluginConsentFromConfig({
        db: { rawSqlPlugins: ["@acme/reports"] },
        auth: { loginPlugins: ["@acme/sso"] },
      })
    ).toEqual({ rawSql: ["@acme/reports"], login: ["@acme/sso"] });
    expect(
      pluginConsentFromConfig({ auth: { loginPlugins: ["@acme/sso"] } })
    ).toEqual({ rawSql: [], login: ["@acme/sso"] });
  });

  it("survives sanitizing the config", () => {
    const sanitized = sanitizeConfig({
      db: { rawSqlPlugins: ["@acme/reports"] },
      auth: { loginPlugins: ["@acme/sso"] },
    });
    expect(sanitized.db.rawSqlPlugins).toEqual(["@acme/reports"]);
    expect(sanitized.auth.loginPlugins).toEqual(["@acme/sso"]);
    expect(sanitizeConfig({}).db.rawSqlPlugins).toEqual([]);
    expect(sanitizeConfig({}).auth.loginPlugins).toEqual([]);
  });

  it("reaches the service config the boot resolves plugins with", () => {
    const result = buildServiceConfig({
      config: {
        db: { rawSqlPlugins: ["@acme/reports"] },
        auth: { loginPlugins: ["@acme/sso"] },
      } as unknown as SanitizedNextlyConfig,
    } as Parameters<typeof buildServiceConfig>[0]);
    expect(result.pluginConsent).toEqual({
      rawSql: ["@acme/reports"],
      login: ["@acme/sso"],
    });
  });
});

describe("setupTransformerInput", () => {
  // A transformer's returned copy becomes the config the boot continues
  // with, so a field the copy loses its brand on is a field the rest of the
  // boot no longer recognises as a plugin field.
  it("keeps the brand pluginField() puts on a collection's field", () => {
    const score = pluginField({ name: "score", type: "star-rating" });
    const config = {
      collections: [{ slug: "pages", fields: [score] }],
    };

    const input = setupTransformerInput(config, []);
    const copied = input.collections[0].fields[0];

    expect(copied).not.toBe(score);
    expect(copied[pluginFieldBrand]).toBe(true);
    expect(copied).toEqual(score);
  });

  // The `auth` block is one a transformer receives (`setupConfigKeysOf`),
  // so its listing arrives frozen like the `db` block's: pushing onto the
  // app's list would otherwise grant a plugin on the next read.
  it("freezes auth.loginPlugins, so a transformer cannot push onto it", () => {
    const input = setupTransformerInput(
      { auth: { loginPlugins: ["@acme/sso"] } },
      []
    );

    expect(() => input.auth.loginPlugins.push("@evil/p")).toThrow(TypeError);
    expect(input.auth.loginPlugins).toEqual(["@acme/sso"]);
  });
});

describe("unmatchedConsentWarnings", () => {
  it("warns once for a name the app lists twice", () => {
    const warnings = unmatchedConsentWarnings(
      [plugin("@acme/reports")],
      snapshotPluginConsent({
        rawSql: ["@acme/removed", "@acme/reports", "@acme/removed"],
      })
    );

    expect(warnings).toEqual([
      'db.rawSqlPlugins lists "@acme/removed", which matches no configured plugin, so it grants nothing. Remove it, or correct the name if it is misspelt.',
    ]);
  });

  it("warns for a listed login name that matches no configured plugin", () => {
    const warnings = unmatchedConsentWarnings(
      [login("@acme/sso")],
      snapshotPluginConsent({
        rawSql: [],
        login: ["@acme/sso", "@acme/removed"],
      })
    );

    expect(warnings).toEqual([
      'auth.loginPlugins lists "@acme/removed", which matches no configured plugin, so it grants nothing. Remove it, or correct the name if it is misspelt.',
    ]);
  });
});

describe("the boot's stale-grant warnings and the transformed list", () => {
  function recording() {
    const warn = vi.fn();
    return {
      warn,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    };
  }

  /** The boot's resolution for `plugins` listing `login`, with `logger`. */
  async function boot(
    plugins: PluginDefinition[],
    login: string[],
    logger: ReturnType<typeof recording>["logger"]
  ): Promise<ReturnType<typeof resolveBootPlugins>> {
    const built = buildServiceConfig({
      config: sanitizeConfig({
        auth: { loginPlugins: login },
        plugins,
      }) as unknown as SanitizedNextlyConfig,
    } as Parameters<typeof buildServiceConfig>[0]) as NextlyServiceConfig;
    return resolveBootPlugins({ ...built, logger });
  }

  it("warns for a listed plugin a transformer removed", async () => {
    // The app lists and configures @acme/granted; a `setup` transformer
    // drops it. The transformed list is what runs and holds the grants, so
    // the stale grant must be named — judged on the pre-transform list, the
    // name still matched and nothing was said.
    const { warn, logger } = recording();
    const dropper = plugin("@acme/granted", {
      setup: config => ({ ...config, plugins: [] }),
    });

    await boot([dropper], ["@acme/granted", "@acme/removed"], logger);

    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(
      lines.some(line =>
        line.startsWith('auth.loginPlugins lists "@acme/granted", which')
      )
    ).toBe(true);
    expect(
      lines.some(line =>
        line.startsWith('auth.loginPlugins lists "@acme/removed", which')
      )
    ).toBe(true);
  });

  it("does not warn for an ordinary plugin a transformer adds under a listed name", async () => {
    // The pre-transform list matched nothing, so the name read as stale — a
    // false warning: the transformed list is the one that runs, and the
    // ordinary plugin the transformer added under that name is configured.
    const { warn, logger } = recording();
    const adder = plugin("@acme/adder", {
      setup: config => ({
        ...config,
        plugins: [...(config.plugins ?? []), plugin("@acme/listed")],
      }),
    });

    await boot([adder], ["@acme/listed"], logger);

    expect(warn).not.toHaveBeenCalled();
  });
});
