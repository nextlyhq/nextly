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
