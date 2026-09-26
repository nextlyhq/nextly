import { describe, it, expect } from "vitest";
import type { PluginDefinition } from "./plugin-context";
import { z } from "zod";

import { assertPluginManifests, resolvePlugins } from "./resolve";

const p = (
  name: string,
  over: Partial<PluginDefinition> = {}
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: "*",
  ...over,
});

describe("resolvePlugins", () => {
  it("validates versions then returns dependency order", () => {
    const out = resolvePlugins(
      [p("a", { dependsOn: { b: "^1.0.0" } }), p("b")],
      { coreVersion: "1.0.0" }
    );
    expect(out.map(x => x.name)).toEqual(["b", "a"]);
  });

  /**
   * The wiring, not the check. `validatePluginSlugs` has its own suite; this
   * asserts `resolvePlugins` actually calls it — without this, removing the
   * call leaves every slug test green while nothing at boot runs it.
   *
   * The two names differ only by separators, which is the whole point: they
   * are distinct legal packages that produce one admin address.
   */
  it("rejects two plugins that resolve to the same admin slug", () => {
    let reason: string | undefined;
    try {
      resolvePlugins([p("@acme/plugin-seo"), p("acme_plugin_seo")], {
        coreVersion: "1.0.0",
      });
    } catch (error) {
      reason = (error as { logContext?: { reason?: string } }).logContext
        ?.reason;
    }
    expect(reason).toBe("duplicate-admin-slug");
  });

  it("surfaces a version error even when the graph is otherwise orderable", () => {
    expect(() =>
      resolvePlugins([p("a", { nextly: ">=2.0.0" }), p("b")], {
        coreVersion: "1.0.0",
      })
    ).toThrow(/Plugin configuration is invalid/i);
  });

  /**
   * The wiring again, and the disabled case beside it, because the two
   * together are what make the refusal safe to have at boot.
   */
  describe("audit kinds", () => {
    const withAuditKind = (name: string, kind: string, enabled?: boolean) =>
      p(name, {
        ...(enabled === undefined ? {} : { enabled }),
        contributes: { audit: { kinds: [{ kind }] } },
      } as Partial<PluginDefinition>);

    it("refuses a kind outside the declaring plugin's prefix", () => {
      // Asserts `resolvePlugins` actually performs the check: without this,
      // removing the call leaves the collector's own suite green while
      // nothing at boot runs it.
      expect(() =>
        resolvePlugins([withAuditKind("@acme/auth", "other-plugin.thing")], {
          coreVersion: "1.0.0",
        })
      ).toThrow(/Plugin configuration is invalid/i);
    });

    it("ignores a DISABLED plugin's declarations", () => {
      // A plugin that is off contributes no `ctx.audit`, so there is no trail
      // for a bad declaration to be missing from — and refusing it would let
      // something nobody is running stop the application from starting.
      // `collectHookPoints` skips disabled plugins for the same reason.
      expect(() =>
        resolvePlugins(
          [withAuditKind("@acme/auth", "other-plugin.thing", false)],
          { coreVersion: "1.0.0" }
        )
      ).not.toThrow();
    });

    it("accepts a correctly prefixed kind on an ENABLED plugin", () => {
      // The control: skipping every plugin would satisfy the disabled case
      // above while making the refusal unreachable.
      expect(() =>
        resolvePlugins([withAuditKind("@acme/auth", "acme-auth.thing")], {
          coreVersion: "1.0.0",
        })
      ).not.toThrow();
    });
  });
});

describe("assertPluginManifests", () => {
  /**
   * The checks a boot must apply to the list it USES, not the list it was
   * handed. A `setup` transformer can add, rename or replace plugins, so
   * `register.ts` calls this again on the transformed config.
   */
  const withSecretPath = (path: string) =>
    ({
      name: "@acme/thing",
      version: "1.0.0",
      nextly: ">=0.0.1",
      capabilities: { secrets: [path] },
      contributes: {
        settings: z.object({ clientSecret: z.string().default("") }),
      },
    }) as unknown as PluginDefinition;

  it("REFUSES a secret path the settings schema does not have", () => {
    // The reason this set is re-run after transforms. A path that matches
    // nothing is not inert: `ctx.settings` then stores the credential it names
    // as ordinary text and hands it back verbatim, and nothing at runtime says
    // so. A typo introduced by a transformer used to reach exactly that.
    expect(() =>
      assertPluginManifests([withSecretPath("clientSecrets")])
    ).toThrow(/Plugin configuration is invalid/i);
  });

  it("accepts a secret path the schema does have", () => {
    // The control: refusing every declaration would satisfy the test above
    // while making encrypted settings undeclarable.
    expect(() =>
      assertPluginManifests([withSecretPath("clientSecret")])
    ).not.toThrow();
  });

  it("is idempotent, so running it twice changes nothing", () => {
    // `resolvePlugins` calls it and `register.ts` calls it again on the
    // transformed list. A second pass that threw — on a hook point already
    // published, say — would make the re-check impossible to add.
    const plugins = [withSecretPath("clientSecret")];
    assertPluginManifests(plugins);
    expect(() => assertPluginManifests(plugins)).not.toThrow();
  });
});
