/**
 * A plugin's admin slug is its address: the admin builds
 * `/admin/plugins/<slug>` from it, core namespaces plugin admin routes with
 * it, and host `pluginOverrides` are keyed by it. Two plugins reaching the
 * same slug therefore share one address, and nothing downstream can notice —
 * which is why this is checked at registration.
 */
import { describe, expect, it } from "vitest";

import { buildPluginAdminMeta } from "./admin-meta";
import type { PluginDefinition } from "./plugin-context";
import { validatePluginSlugs } from "./validate-slugs";

function plugin(name: string): PluginDefinition {
  return { name, version: "1.0.0", nextly: "*" } as PluginDefinition;
}

/**
 * The thrown `NextlyError` carries a deliberately generic `message`
 * ("Plugin configuration is invalid.") for the client; the specific failure
 * lives in `logContext.reason`. Matching on `message` would pass for every
 * plugin-resolution failure alike — an incompatible version included — so
 * these assert the reason instead.
 */
function collisionReason(names: string[]): string | undefined {
  try {
    validatePluginSlugs(names.map(plugin));
  } catch (error) {
    return (error as { logContext?: { reason?: string } }).logContext?.reason;
  }
  return undefined;
}

describe("validatePluginSlugs", () => {
  it("accepts plugins whose slugs differ", () => {
    expect(() =>
      validatePluginSlugs([plugin("@acme/one"), plugin("@acme/two")])
    ).not.toThrow();
    // The control on `collisionReason` itself: it must report undefined when
    // nothing collides, or every assertion above would pass on a helper that
    // always returned the reason it was looking for.
    expect(collisionReason(["@acme/one", "@acme/two"])).toBeUndefined();
  });

  it("accepts an empty plugin list", () => {
    expect(() => validatePluginSlugs([])).not.toThrow();
  });

  /**
   * The separating cases, and the reason a check on the NAMES would not do.
   * `pluginAdminSlug` lowercases and collapses each non-alphanumeric run to a
   * single dash, so every pair below is two distinct, legal package names that
   * produce one address.
   */
  it.each([
    ["scope separator", "@acme/plugin-seo", "acme-plugin-seo"],
    ["a dot for a dash", "@acme/plugin-seo", "@acme/plugin.seo"],
    ["case", "@acme/plugin-seo", "@ACME/Plugin-SEO"],
    ["underscores", "@acme/plugin-seo", "acme_plugin_seo"],
    ["a doubled separator", "@acme/plugin-seo", "@acme//plugin--seo"],
  ])("rejects two plugins colliding by %s", (_why, first, second) => {
    expect(collisionReason([first, second])).toBe("duplicate-admin-slug");
  });

  /**
   * The message is the entire remedy — the reader has to rename one package,
   * and this is the only place the pair is ever stated together. Asserting it
   * throws would pass on an error naming neither.
   */
  it("names both plugins and the slug they collide on", () => {
    let caught: unknown;
    try {
      validatePluginSlugs([
        plugin("@acme/plugin.seo"),
        plugin("acme_plugin_seo"),
      ]);
    } catch (error) {
      caught = error;
    }

    const message = (caught as { logMessage?: string })?.logMessage ?? "";
    expect(message).toContain("@acme/plugin.seo");
    expect(message).toContain("acme_plugin_seo");
    expect(message).toContain("acme-plugin-seo");
    expect(
      (caught as { logContext?: { reason?: string } })?.logContext?.reason
    ).toBe("duplicate-admin-slug");
  });

  /**
   * The same package listed twice is the same collision as far as addressing
   * goes, and it is the likelier mistake — a plugin registered by both the app
   * and a preset. It must not be waved through as "identical, so harmless".
   */
  it("rejects the exact same name registered twice", () => {
    expect(collisionReason(["@acme/one", "@acme/one"])).toBe(
      "duplicate-admin-slug"
    );
  });
});

/**
 * The seam, as distinct from the boot check.
 *
 * `buildPluginAdminMeta` is the one place in core that turns a plugin list
 * into addresses — the slug it derives is the admin's URL for that plugin and
 * the key its host override is read by. Two paths reach it without the boot
 * check having run on the list it receives: `createDynamicHandlers`
 * initializes services lazily and serves the public admin-meta endpoint first,
 * and a `setup` transformer can rewrite `config.plugins` after
 * `resolvePlugins` has already validated the original.
 */
describe("buildPluginAdminMeta", () => {
  it("addresses plugins whose slugs differ", () => {
    const meta = buildPluginAdminMeta(
      [plugin("@acme/one"), plugin("@acme/two")],
      undefined,
      []
    );

    // The positive control: it really does produce metadata for both, so the
    // rejection below is about the collision rather than about a function that
    // refuses everything.
    expect(meta.map(m => m.name)).toEqual(["@acme/one", "@acme/two"]);
  });

  it("refuses to address two plugins that share a slug", () => {
    let reason: string | undefined;
    try {
      buildPluginAdminMeta(
        [plugin("@acme/plugin-seo"), plugin("acme_plugin_seo")],
        undefined,
        []
      );
    } catch (error) {
      reason = (error as { logContext?: { reason?: string } }).logContext
        ?.reason;
    }

    expect(reason).toBe("duplicate-admin-slug");
  });
});
