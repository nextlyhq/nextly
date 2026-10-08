import { describe, it, expect } from "vitest";
import { NextlyError } from "../errors/nextly-error";
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

describe("a plugin challenge under core's reserved id", () => {
  const challenge = (id: string) =>
    p("@t/2fa", {
      contributes: {
        auth: { challenges: [{ id, resolve: async () => ({ ok: true }) }] },
      },
    } as never);

  it("fails resolution, rather than the first sign-in request", () => {
    expect(() =>
      assertPluginManifests([challenge("must-change-password")])
    ).toThrow(
      expect.objectContaining({
        logContext: expect.objectContaining({
          reason: "plugin-challenge-id-reserved",
        }),
      })
    );
  });

  it("accepts any other id", () => {
    expect(() => assertPluginManifests([challenge("totp")])).not.toThrow();
  });
});

describe("two plugin challenges under one id", () => {
  const declaring = (name: string, ids: string[], enabled?: boolean) =>
    p(name, {
      ...(enabled === undefined ? {} : { enabled }),
      contributes: {
        auth: {
          challenges: ids.map(id => ({
            id,
            resolve: async () => ({ ok: true }),
          })),
        },
      },
    } as never);

  it("fails resolution, naming both plugins, rather than every auth request", () => {
    expect(() =>
      assertPluginManifests([
        declaring("@t/2fa", ["totp"]),
        declaring("@t/other-2fa", ["totp"]),
      ])
    ).toThrow(
      expect.objectContaining({
        logContext: expect.objectContaining({
          reason: "plugin-challenge-id-duplicate",
          plugins: ["@t/2fa", "@t/other-2fa"],
          challengeId: "totp",
        }),
      })
    );
  });

  it("fails resolution when one plugin declares an id twice", () => {
    expect(() =>
      assertPluginManifests([declaring("@t/2fa", ["totp", "totp"])])
    ).toThrow(
      expect.objectContaining({
        logContext: expect.objectContaining({
          reason: "plugin-challenge-id-duplicate",
        }),
      })
    );
  });

  it("accepts distinct ids, and a duplicate from a disabled plugin", () => {
    // The control: refusing any second challenge would satisfy the cases
    // above. A disabled plugin registers nothing, so its ids collide with
    // nothing at runtime.
    expect(() =>
      assertPluginManifests([
        declaring("@t/2fa", ["totp"]),
        declaring("@t/webauthn", ["webauthn"]),
        declaring("@t/old-2fa", ["totp"], false),
      ])
    ).not.toThrow();
  });
});

describe("a plugin event under a reserved prefix", () => {
  const declaring = (name: string) =>
    p("@t/cache", { contributes: { events: [{ name }] } } as never);

  it("fails resolution, rather than every emit", () => {
    expect(() =>
      assertPluginManifests([declaring("plugin.cache.cleared")])
    ).toThrow(
      expect.objectContaining({
        logContext: expect.objectContaining({
          reason: "plugin-event-name-reserved",
        }),
      })
    );
  });

  it("fails resolution outside the plugin's own namespace", () => {
    // Another plugin's slug, and a bare name that is nobody's: both would be
    // refused on every emit.
    for (const name of ["acme-billing.charged", "cache.cleared"]) {
      expect(() => assertPluginManifests([declaring(name)])).toThrow(
        expect.objectContaining({
          logContext: expect.objectContaining({
            reason: "plugin-event-outside-namespace",
            expectedPrefix: "t-cache.",
          }),
        })
      );
    }
  });

  it("accepts the plugin's own namespace", () => {
    expect(() =>
      assertPluginManifests([declaring("t-cache.cleared")])
    ).not.toThrow();
  });
});

describe("resolvePlugins: schemaVersion declarations", () => {
  const opts = { coreVersion: "0.0.2-alpha.66" };

  it("refuses a schemaVersion with no migrations to reach it", () => {
    expect(() =>
      resolvePlugins(
        [p("stub", { schemaVersion: 2 } as Partial<PluginDefinition>)],
        opts
      )
    ).toThrow(NextlyError);
  });

  it("refuses a schemaVersion its newest migration does not equal", () => {
    expect(() =>
      resolvePlugins(
        [
          p("stub", {
            schemaVersion: 3,
            contributes: {
              schema: {
                migrations: [
                  {
                    name: "001",
                    schemaVersion: 1,
                    checksum: "a",
                    dialects: {} as never,
                    snapshot: {} as never,
                    before: {} as never,
                  },
                  {
                    name: "002",
                    schemaVersion: 2,
                    checksum: "b",
                    dialects: {} as never,
                    snapshot: {} as never,
                    before: {} as never,
                  },
                ],
              },
            },
          } as Partial<PluginDefinition>),
        ],
        opts
      )
    ).toThrow(NextlyError);
  });

  it("accepts a declaration its newest migration reaches", () => {
    expect(
      resolvePlugins(
        [
          p("stub", {
            schemaVersion: 2,
            contributes: {
              schema: {
                migrations: [
                  {
                    name: "002",
                    schemaVersion: 2,
                    checksum: "b",
                    dialects: {} as never,
                    snapshot: {} as never,
                    before: {} as never,
                  },
                ],
              },
            },
          } as Partial<PluginDefinition>),
        ],
        opts
      )
    ).toHaveLength(1);
  });

  /** A plugin declaring `schemaVersion` with modules of these names and versions. */
  const shipping = (
    declared: number,
    modules: Array<[name: string, version: number]>
  ) =>
    p("stub", {
      schemaVersion: declared,
      contributes: {
        schema: {
          migrations: modules.map(([name, schemaVersion]) => ({
            name,
            schemaVersion,
            checksum: name,
            dialects: {} as never,
            snapshot: {} as never,
            before: {} as never,
          })),
        },
      },
    } as Partial<PluginDefinition>);

  it("reads the versions in the order the modules run, not as listed", () => {
    // Listed `002` (v1) then `001` (v2): highest 2, as declared, but `002`
    // runs last and leaves the database at 1.
    expect(() =>
      resolvePlugins(
        [
          shipping(2, [
            ["002_backfill", 1],
            ["001_init", 2],
          ]),
        ],
        opts
      )
    ).toThrow(NextlyError);
    // The control: the same modules whose run order raises the version.
    expect(
      resolvePlugins(
        [
          shipping(2, [
            ["002_more", 2],
            ["001_init", 1],
          ]),
        ],
        opts
      )
    ).toHaveLength(1);
  });

  it("refuses a migration whose name holds a slash", () => {
    // The ledger key is `plugin:<plugin>/<module>`, split at the last slash:
    // `data/backfill` would be filed under the plugin `stub/data`.
    let refusal: unknown;
    try {
      resolvePlugins([shipping(1, [["data/backfill", 1]])], opts);
    } catch (error) {
      refusal = error;
    }
    expect(NextlyError.is(refusal)).toBe(true);
    expect(JSON.stringify((refusal as NextlyError).publicData)).toMatch(
      /data\/backfill/
    );
    // The control: the same module named without one.
    expect(
      resolvePlugins([shipping(1, [["data-backfill", 1]])], opts)
    ).toHaveLength(1);
  });

  it("refuses modules that share a name, ignoring case", () => {
    // The name is the module's ledger key, so two alike are one migration to
    // the ledger; refused when the configuration loads, as the slash is.
    for (const second of ["001_init", "001_INIT"]) {
      let refusal: unknown;
      try {
        resolvePlugins(
          [
            shipping(2, [
              ["001_init", 1],
              [second, 2],
            ]),
          ],
          opts
        );
      } catch (error) {
        refusal = error;
      }
      expect(NextlyError.is(refusal), second).toBe(true);
      expect((refusal as NextlyError).publicMessage).toContain(
        `more than one migration named "${second}"`
      );
    }
    // The control: the same modules named apart.
    expect(
      resolvePlugins(
        [
          shipping(2, [
            ["001_init", 1],
            ["002_more", 2],
          ]),
        ],
        opts
      )
    ).toHaveLength(1);
  });
});
