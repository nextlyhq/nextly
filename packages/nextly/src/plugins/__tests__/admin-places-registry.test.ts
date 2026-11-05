/**
 * The places plugins declare on admin pages, checked at start: a plugin names
 * places only under its own namespace, never under core's or another
 * plugin's, and a contribution names only a place that exists. Each refusal
 * names the plugin, the place and the rule broken.
 */
import { describe, expect, it } from "vitest";

import { toCliError } from "../../cli/errors";
import { CORE_ADMIN_PLACES } from "../admin-places";
import {
  assertPlacesExist,
  collectAdminPlaces,
} from "../admin-places-registry";
import type { PluginDefinition } from "../plugin-context";
import { resolveDeclaredPlugins, resolveTransformedPlugins } from "../resolve";

/** A plugin declaring `places`, as an author writes it. */
function plugin(
  name: string,
  places: string[],
  over: Partial<PluginDefinition> = {}
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    contributes: { admin: { places: places.map(place => ({ name: place })) } },
    ...over,
  };
}

interface Refusal {
  code?: string;
  reason?: string;
  logMessage?: string;
  logContext?: Record<string, unknown>;
}

/** What `fn` refused with, or "not refused". */
function refusalOf(fn: () => unknown): Refusal | "not refused" {
  try {
    fn();
  } catch (error) {
    const { code, logMessage, logContext } = error as {
      code?: string;
      logMessage?: string;
      logContext?: Record<string, unknown>;
    };
    return {
      code,
      reason: logContext?.reason as string | undefined,
      logMessage,
      logContext,
    };
  }
  return "not refused";
}

const CORE_IDS = Object.keys(CORE_ADMIN_PLACES);

describe("collecting the places plugins declare", () => {
  it("adds a plugin's place under its own namespace, owned by it, beside core's", () => {
    const places = collectAdminPlaces([
      plugin("@acme/billing", ["acme-billing.invoice"]),
    ]);
    expect(places.get("acme-billing.invoice")).toMatchObject({
      name: "acme-billing.invoice",
      owner: "@acme/billing",
    });
    for (const id of CORE_IDS) {
      // Core's own: no owner.
      expect(places.get(id), id).toEqual({ name: id });
    }
    expect(places.size).toBe(CORE_IDS.length + 1);
  });

  it("holds core's places alone when no plugin declares any", () => {
    for (const plugins of [
      [],
      [{ name: "@acme/quiet", version: "1.0.0", nextly: "*" }],
    ] satisfies PluginDefinition[][]) {
      expect([...collectAdminPlaces(plugins).keys()].sort()).toEqual(
        [...CORE_IDS].sort()
      );
    }
  });

  it("refuses a place outside the plugin's namespace, naming the prefix it must start with", () => {
    const refused = refusalOf(() =>
      collectAdminPlaces([plugin("@acme/billing", ["other-plugin.invoice"])])
    );
    expect(refused).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "admin-place-outside-namespace",
      logContext: {
        plugin: "@acme/billing",
        place: "other-plugin.invoice",
        expectedPrefix: "acme-billing.",
      },
    });
    expect((refused as Refusal).logMessage).toContain("other-plugin.invoice");
    expect((refused as Refusal).logMessage).toContain('"acme-billing."');
  });

  it("refuses a place under a segment core reserves, whatever the plugin's own slug", () => {
    for (const place of [
      "collection.list",
      "collection.badge",
      "login.extra",
    ]) {
      const refused = refusalOf(() =>
        collectAdminPlaces([plugin("@acme/billing", [place])])
      );
      expect(refused, place).toMatchObject({
        reason: "admin-place-reserved",
        logContext: {
          plugin: "@acme/billing",
          place,
          reservedSegment: place.split(".")[0],
        },
      });
    }
  });

  it("refuses a plugin whose own slug is a segment core reserves, saying the slug collides", () => {
    for (const [name, slug] of [
      ["settings", "settings"],
      ["User", "user"],
    ]) {
      const refused = refusalOf(() =>
        collectAdminPlaces([plugin(name, [`${slug}.panel`])])
      );
      expect(refused, name).toMatchObject({
        reason: "admin-place-reserved-slug",
        logContext: { plugin: name, place: `${slug}.panel`, slug },
      });
      expect((refused as Refusal).logMessage).toMatch(
        new RegExp(`slug "${slug}"`)
      );
    }
  });

  it("lets a plugin whose slug is reserved start when it declares no places", () => {
    expect(
      refusalOf(() =>
        collectAdminPlaces([
          { name: "settings", version: "1.0.0", nextly: "*" },
        ])
      )
    ).toBe("not refused");
  });

  it.each([
    "acme-billing.",
    "acme-billing.Invoice",
    "acme-billing..invoice",
    "acme-billing.in voice",
    "",
  ])("refuses the malformed place %j", place => {
    expect(
      refusalOf(() => collectAdminPlaces([plugin("@acme/billing", [place])]))
    ).toMatchObject({
      reason: "admin-place-malformed",
      logContext: { plugin: "@acme/billing", place },
    });
  });

  it("refuses a place that is not a string, as a plugin in plain JavaScript may give one", () => {
    const refused = refusalOf(() =>
      collectAdminPlaces([
        {
          name: "@acme/billing",
          version: "1.0.0",
          nextly: "*",
          contributes: {
            admin: { places: ["acme-billing.invoice"] as never },
          },
        },
      ])
    );
    expect(refused).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "admin-place-malformed",
      logContext: { plugin: "@acme/billing", place: undefined },
    });
  });

  it("refuses a name no serialization can quote, as a bigint, without failing on it", () => {
    expect(
      refusalOf(() =>
        collectAdminPlaces([
          {
            name: "@acme/billing",
            version: "1.0.0",
            nextly: "*",
            contributes: { admin: { places: [{ name: 10n }] as never } },
          },
        ])
      )
    ).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "admin-place-malformed",
      logContext: { plugin: "@acme/billing" },
    });
  });

  it("refuses places that are not a list, as a plugin in plain JavaScript may give them", () => {
    expect(
      refusalOf(() =>
        collectAdminPlaces([
          {
            name: "@acme/billing",
            version: "1.0.0",
            nextly: "*",
            contributes: {
              admin: { places: { name: "acme-billing.invoice" } as never },
            },
          },
        ])
      )
    ).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "admin-place-malformed",
      logContext: { plugin: "@acme/billing" },
    });
  });

  it("refuses a place two plugins both declare, naming both", () => {
    // `@acme/billing` and `acme-billing` share the slug `acme-billing`, so
    // each passes the namespace rule with the same name.
    expect(
      refusalOf(() =>
        collectAdminPlaces([
          plugin("@acme/billing", ["acme-billing.invoice"]),
          plugin("acme-billing", ["acme-billing.invoice"]),
        ])
      )
    ).toMatchObject({
      reason: "admin-place-collision",
      logContext: {
        place: "acme-billing.invoice",
        owners: ["@acme/billing", "acme-billing"],
      },
    });
  });

  it("refuses a place one plugin declares twice", () => {
    expect(
      refusalOf(() =>
        collectAdminPlaces([
          plugin("@acme/billing", [
            "acme-billing.invoice",
            "acme-billing.invoice",
          ]),
        ])
      )
    ).toMatchObject({
      reason: "admin-place-collision",
      logContext: {
        place: "acme-billing.invoice",
        owners: ["@acme/billing", "@acme/billing"],
      },
    });
  });

  it("ignores a disabled plugin's places, which then don't exist", () => {
    const places = collectAdminPlaces([
      plugin("@acme/billing", ["elsewhere.invoice"], { enabled: false }),
    ]);
    expect(places.has("elsewhere.invoice")).toBe(false);
    expect(places.size).toBe(CORE_IDS.length);
  });
});

describe("a contribution's place", () => {
  const places = collectAdminPlaces([
    plugin("@acme/billing", ["acme-billing.invoice"]),
    plugin("@acme/docs", ["acme-docs.panel"], { enabled: false }),
  ]);
  const ref = (place: string) => ({
    plugin: "@acme/reports",
    place,
    what: 'block "totals"',
  });

  it("accepts a core place, the plugin's own, and another enabled plugin's", () => {
    expect(
      refusalOf(() =>
        assertPlacesExist(places, [
          ref("collection.list"),
          { ...ref("acme-billing.invoice"), plugin: "@acme/billing" },
          ref("acme-billing.invoice"),
        ])
      )
    ).toBe("not refused");
  });

  it("refuses a place that doesn't exist, naming the plugin, the contribution and the place", () => {
    const refused = refusalOf(() =>
      assertPlacesExist(places, [ref("collection.list"), ref("colection.list")])
    );
    expect(refused).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "admin-place-unknown",
      logContext: {
        plugin: "@acme/reports",
        contribution: 'block "totals"',
        place: "colection.list",
      },
    });
    expect((refused as Refusal).logMessage).toContain('block "totals"');
    expect((refused as Refusal).logMessage).toContain('"colection.list"');
  });

  it("refuses a place whose owner is disabled or absent, naming its namespace and pointing to `dependsOn`", () => {
    for (const [place, prefix] of [
      ["acme-docs.panel", "acme-docs"],
      ["acme-crm.contact", "acme-crm"],
    ]) {
      const refused = refusalOf(() => assertPlacesExist(places, [ref(place)]));
      expect(refused, place).toMatchObject({
        reason: "admin-place-unknown",
        logContext: { place, owningPrefix: prefix },
      });
      expect((refused as Refusal).logMessage).toContain(`"${prefix}"`);
      expect((refused as Refusal).logMessage).toContain("`dependsOn`");
    }
  });
});

/**
 * A config load as the boot runs it: the declared list resolved, then the list
 * the `setup` transformers return (`transformed`, the declared one unless
 * given) resolved again.
 */
function load(
  declared: PluginDefinition[],
  transformed?: PluginDefinition[]
): void {
  const first = resolveDeclaredPlugins(declared, { coreVersion: "1.0.0" });
  resolveTransformedPlugins(
    { plugins: transformed ?? first.plugins },
    { coreVersion: "1.0.0", declared: first.preSetup }
  );
}

describe("at start", () => {
  it("refuses to start on a place outside the plugin's namespace", () => {
    expect(
      refusalOf(() =>
        resolveDeclaredPlugins(
          [plugin("@acme/billing", ["other-plugin.invoice"])],
          { coreVersion: "1.0.0" }
        )
      )
    ).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "admin-place-outside-namespace",
    });
  });

  it("refuses two plugins sharing a slug for the slug, before their places could collide", () => {
    expect(
      refusalOf(() =>
        load([
          plugin("@acme/billing", ["acme-billing.invoice"]),
          plugin("acme-billing", ["acme-billing.invoice"]),
        ])
      )
    ).toMatchObject({ reason: "duplicate-admin-slug" });
  });

  it("refuses a bad place in the list a setup transformer returns", () => {
    // The declared list passes; the transformed one, which adds a plugin
    // under core's segment, is checked again and refused.
    expect(
      refusalOf(() =>
        load(
          [plugin("@acme/crm", ["acme-crm.contact"])],
          [
            plugin("@acme/crm", ["acme-crm.contact"]),
            plugin("@acme/bad", ["collection.badge"]),
          ]
        )
      )
    ).toMatchObject({ reason: "admin-place-reserved" });
  });

  it("starts with good places in both the declared and the transformed list", () => {
    expect(
      refusalOf(() => load([plugin("@acme/billing", ["acme-billing.invoice"])]))
    ).toBe("not refused");
  });
});

describe("in the CLI", () => {
  it("tells a plugin whose places are not a list to declare a list, not to rename a place", () => {
    let thrown: unknown;
    try {
      collectAdminPlaces([
        {
          name: "@acme/billing",
          version: "1.0.0",
          nextly: "*",
          contributes: {
            admin: { places: { name: "acme-billing.x" } as never },
          },
        },
      ]);
    } catch (error) {
      thrown = error;
    }
    const cli = toCliError(thrown);
    expect(cli.code).toBe("PLUGIN_RESOLUTION_ERROR");
    expect(cli.next).toContain("as a list of places");
    expect(cli.next).not.toMatch(/rename/i);
  });

  it.each<[string, () => unknown]>([
    [
      "admin-place-malformed",
      () => collectAdminPlaces([plugin("@acme/billing", ["Bad"])]),
    ],
    [
      "admin-place-reserved-slug",
      () => collectAdminPlaces([plugin("settings", ["settings.panel"])]),
    ],
    [
      "admin-place-reserved",
      () => collectAdminPlaces([plugin("@acme/billing", ["collection.badge"])]),
    ],
    [
      "admin-place-outside-namespace",
      () => collectAdminPlaces([plugin("@acme/billing", ["other.invoice"])]),
    ],
    [
      "admin-place-collision",
      () =>
        collectAdminPlaces([
          plugin("@acme/billing", [
            "acme-billing.invoice",
            "acme-billing.invoice",
          ]),
        ]),
    ],
    [
      "admin-place-unknown",
      () =>
        assertPlacesExist(collectAdminPlaces([]), [
          {
            plugin: "@acme/reports",
            place: "acme-crm.contact",
            what: 'block "totals"',
          },
        ]),
    ],
  ])(
    "reads %s as a plugin resolution error, saying what to do",
    (reason, refuse) => {
      let thrown: unknown;
      try {
        refuse();
      } catch (error) {
        thrown = error;
      }
      expect(
        (thrown as { logContext?: { reason?: string } }).logContext?.reason
      ).toBe(reason);
      const cli = toCliError(thrown);
      expect(cli.code).toBe("PLUGIN_RESOLUTION_ERROR");
      expect(cli.what).toBe((thrown as { logMessage?: string }).logMessage);
      expect(cli.next.trim()).not.toBe("");
    }
  );
});
