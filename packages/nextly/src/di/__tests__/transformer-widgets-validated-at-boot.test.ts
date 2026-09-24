/**
 * A widget a `setup` transformer introduced is validated too.
 *
 * `resolvePlugins` runs `assertAdminWidgets` over the plugin list the CALLER
 * supplied, and `registerServices` calls it BEFORE `applyPluginConfigTransformers`.
 * A transformer that adds or replaces `contributes.admin.widgets` therefore
 * produced widgets nothing had checked -- and the transformed list is the one
 * `setBootedConfig` publishes and `buildPluginAdminMeta` serializes, so a bigint
 * introduced there reached `JSON.stringify` and failed
 * `/api/admin-meta/workspace` for every admin. The same 500 through a second
 * door.
 *
 * Asserted through `registerServices` rather than through `resolvePlugins`,
 * because the gap is an ORDERING one: a check on the resolver's argument is
 * correct and still cannot see the list the boot goes on to publish.
 *
 * The adapter here cannot connect, which is what makes the positive control
 * necessary: registration fails either way, so a test asserting only that it
 * rejects would pass with the validation deleted entirely.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../../plugins/plugin-context";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");

/** An adapter that fails LATER than the plugin validation under test. */
const failingAdapter = { connect: () => undefined };

/** A widget whose `query.where` carries a bigint, which JSON cannot encode. */
const bigintWidget = {
  id: "acme/revenue",
  component: "@acme/p/admin#Revenue",
  query: { source: "collection:posts", op: "count", where: { id: 1n } },
};

/** A widget that survives the round trip unchanged. */
const validWidget = {
  id: "acme/posts",
  component: "@acme/p/admin#Posts",
  query: { source: "collection:posts", op: "count" },
};

/**
 * A plugin whose `setup` REPLACES the plugin list with one carrying `widget`.
 *
 * The transformer speaks for a plugin other than itself, which is the shape the
 * API permits and the shape the original check cannot see: the widgets it
 * validated belong to the list the caller passed, and this list did not exist
 * then.
 */
function pluginContributing(widget: unknown): PluginDefinition[] {
  const contributor = {
    name: "@acme/p",
    version: "1.0.0",
    nextly: "*",
    contributes: { admin: { widgets: [widget] } },
  };
  return [
    {
      name: "@acme/transformer",
      version: "1.0.0",
      nextly: "*",
      setup: (config: Record<string, unknown>) => ({
        ...config,
        plugins: [...(config.plugins as unknown[]), contributor],
      }),
    },
  ] as unknown as PluginDefinition[];
}

/** Whatever the boot rejected with, or `undefined` when it got past the adapter. */
async function bootError(plugins: PluginDefinition[]): Promise<unknown> {
  try {
    await registerServices({
      adapter: failingAdapter,
      plugins,
    } as unknown as Parameters<typeof registerServices>[0]);
  } catch (error) {
    return error;
  }
  return undefined;
}

/** The failure's code, or the string it turned out to be. */
function codeOf(error: unknown): string {
  return NextlyError.is(error) ? error.code : String(error);
}

describe("widgets a setup transformer introduces", () => {
  it("refuses a bigint the transformer added, at boot", async () => {
    expect(codeOf(await bootError(pluginContributing(bigintWidget)))).toBe(
      "NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID"
    );
  });

  // The positive control. Boot fails on the adapter either way, so without this
  // the refusal above is satisfied by any rejection at all -- including one that
  // refuses every transformed widget.
  it("carries a valid widget the transformer added past the check", async () => {
    expect(codeOf(await bootError(pluginContributing(validWidget)))).not.toBe(
      "NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID"
    );
  });
});

/**
 * A plugin whose `setup` REPLACES the list with one declaring `secretPath`.
 *
 * The same shape as above, aimed at the check that matters most: a secret path
 * matching nothing in the settings schema is not inert. `ctx.settings` then
 * stores the credential it names as ordinary text and returns it verbatim, and
 * nothing at runtime says so — the manifest simply promised encryption it does
 * not perform.
 */
function pluginDeclaringSecret(secretPath: string): PluginDefinition[] {
  const contributor = {
    name: "@acme/secrets",
    version: "1.0.0",
    nextly: "*",
    capabilities: { secrets: [secretPath] },
    contributes: {
      settings: z.object({ clientSecret: z.string().default("") }),
    },
  };
  return [
    {
      name: "@acme/transformer",
      version: "1.0.0",
      nextly: "*",
      setup: (config: Record<string, unknown>) => ({
        ...config,
        plugins: [...(config.plugins as unknown[]), contributor],
      }),
    },
  ] as unknown as PluginDefinition[];
}

describe("capabilities a setup transformer introduces", () => {
  it("refuses a secret path the schema does not have, at boot", async () => {
    // `resolvePlugins` validated the list the CALLER passed. This declaration
    // did not exist then, so the typo reached a running `ctx.settings`.
    expect(
      codeOf(await bootError(pluginDeclaringSecret("clientSecrets")))
    ).toBe("PLUGIN_RESOLUTION_ERROR");
  });

  it("carries a valid secret path past the check", async () => {
    // The positive control, and it is not optional here: boot fails on the
    // adapter either way, so the refusal above is satisfied by ANY rejection —
    // including one that refuses every transformed manifest.
    expect(
      codeOf(await bootError(pluginDeclaringSecret("clientSecret")))
    ).not.toBe("PLUGIN_RESOLUTION_ERROR");
  });
});

describe("a plugin a setup transformer ADDS", () => {
  /** The boot failure's resolution reason, when it is one. */
  function reasonOf(error: unknown): string | undefined {
    return NextlyError.is(error)
      ? (error.logContext as { reason?: string } | undefined)?.reason
      : undefined;
  }

  it("is version-checked like a declared plugin", async () => {
    // Re-running only the manifest checks let a transformer-introduced plugin
    // declare any core range it liked — the whole resolver is what carries
    // the version gate, and the list that initializes is the transformed one.
    const incompatible = {
      name: "@acme/added",
      version: "1.0.0",
      nextly: "^99.0.0",
    };
    const plugins = [
      {
        name: "@acme/transformer",
        version: "1.0.0",
        nextly: "*",
        setup: (config: Record<string, unknown>) => ({
          ...config,
          plugins: [...(config.plugins as unknown[]), incompatible],
        }),
      },
    ] as unknown as PluginDefinition[];

    expect(reasonOf(await bootError(plugins))).toBe("core-incompatible");
  });

  it("is dependency-checked like a declared plugin", async () => {
    // The same hole on the dependency side: an addition naming a capability
    // nothing provides would have initialized unresolved.
    const needsGhost = {
      name: "@acme/added",
      version: "1.0.0",
      nextly: "*",
      requires: { "ghost-capability": ">=1.0.0" },
    };
    const plugins = [
      {
        name: "@acme/transformer",
        version: "1.0.0",
        nextly: "*",
        setup: (config: Record<string, unknown>) => ({
          ...config,
          plugins: [...(config.plugins as unknown[]), needsGhost],
        }),
      },
    ] as unknown as PluginDefinition[];

    expect(reasonOf(await bootError(plugins))).toBe("missing-capability");
  });
});
