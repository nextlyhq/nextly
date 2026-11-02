/**
 * The widget-registry boot reset.
 *
 * Both stores are `globalThis`-pinned, so they survive a dev-server hot reload
 * that re-executes every registration. Without a reset at the one choke point
 * both boot paths funnel through, the second boot's `registerWidget` and
 * `registerSource` calls collide with the first boot's own rows and a reload
 * fails on ids the app itself put there.
 *
 * The reset is deliberately all this does. Collection sources are derived from
 * the collection registry at the point a query needs them
 * (`domains/widgets/collection-sources.ts`), not snapshotted here: the registry
 * is not populated this early in boot, and it keeps changing afterwards.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { allWidgets } from "../../domains/widgets/canonical";
import { CORE_WIDGET_IDS } from "../../domains/widgets/core-widgets";
import {
  deferredEntities,
  setDeferredEntities,
} from "../../domains/widgets/deferred-entities";

import {
  clearWidgets,
  listWidgets,
  registerWidget,
} from "../../domains/widgets/registry";
import {
  clearSources,
  getSource,
  listSources,
  registerSource,
} from "../../domains/widgets/sources";
import {
  registerSystemSource,
  systemResolver,
} from "../../domains/widgets/system-sources";
import { RELEASES_SOURCE_ID } from "../../domains/releases/releases-widget-source";
import { VERSIONS_SOURCE_ID } from "../../domains/versions/versions-widget-source";
import {
  ACTIVITY_SOURCE_ID,
  ATTENTION_SOURCE_ID,
  CONTENT_SOURCE_ID,
  CONTINUE_SOURCE_ID,
  TEAM_SOURCE_ID,
} from "../../domains/widgets/system-source-ids";
import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { resetWidgetRegistries } from "../registrations/register-widgets";

beforeEach(() => {
  clearSources();
  clearWidgets();
});

function seedSource(id: string): void {
  registerSource({
    id,
    label: id,
    kind: "plugin",
    supports: ["count"],
    fields: [{ name: "total", type: "number" }],
  });
}

function seedWidget(id: string): void {
  registerWidget(
    {
      id,
      title: id,
      archetype: "metric",
      size: { default: { w: 3, h: 2 } },
    },
    { source: "@acme/stripe" }
  );
}

describe("resetWidgetRegistries", () => {
  it("drops the previous boot's sources so a reload cannot collide with itself", () => {
    seedSource("plugin:stripe/revenue");
    expect(listSources()).toHaveLength(1);

    resetWidgetRegistries();

    // The property is that nothing SURVIVES a boot, not that the store ends
    // empty -- core publishes its own system source in this same function, so
    // an emptiness assertion would only have held while it published none.
    expect(getSource("plugin:stripe/revenue")).toBeUndefined();
    expect(
      listSources()
        .map(source => source.id)
        .sort()
    ).toEqual(
      [
        ACTIVITY_SOURCE_ID,
        ATTENTION_SOURCE_ID,
        CONTENT_SOURCE_ID,
        CONTINUE_SOURCE_ID,
        RELEASES_SOURCE_ID,
        TEAM_SOURCE_ID,
        VERSIONS_SOURCE_ID,
      ].sort()
    );
    // The proof that the clear is what made room: the same id registers again
    // without the conflict `registerSource` raises for a duplicate.
    expect(() => seedSource("plugin:stripe/revenue")).not.toThrow();
  });

  it("drops a resolver whose source did not survive the boot", () => {
    // 🔴 The discriminating case, and it is NOT the reset republishing its own
    // source: that id is written again either way, so a resolver store left
    // uncleared is simply overwritten and nothing observable changes. What only
    // a cleared store gets right is an id the new boot does NOT republish --
    // a source removed or renamed between reloads. Its resolver is addressable
    // for the lifetime of the process, holding every service its closure
    // captured, and republishing that id through the generic `registerSource`
    // door makes the stale one executable again.
    registerSystemSource(
      {
        id: "system:from-previous-boot",
        label: "Gone",
        kind: "system",
        supports: ["list"],
        fields: [{ name: "title", type: "string" }],
      },
      () => Promise.resolve({ op: "list" as const, items: [] })
    );
    expect(systemResolver("system:from-previous-boot")).toBeDefined();

    resetWidgetRegistries();

    expect(systemResolver("system:from-previous-boot")).toBeUndefined();
    // The control: the source core DOES republish is still answerable, so this
    // cannot pass by clearing everything and registering nothing.
    expect(systemResolver(RELEASES_SOURCE_ID)).toBeDefined();
  });

  it("registers nothing a plugin carries under contributes.widgetSources", () => {
    // Nextly no longer reads the key: plugin resolution refuses a plugin that
    // carries it before this reset runs, and nothing here registers what it
    // holds, so a plugin reaching here around that refusal still adds no
    // source.
    resetWidgetRegistries([
      {
        name: "@acme/stripe",
        contributes: {
          widgetSources: [
            {
              source: {
                id: "plugin:stripe/revenue",
                label: "Revenue",
                kind: "plugin",
                supports: ["count"],
                fields: [{ name: "total", type: "number" }],
              },
              resolve: () =>
                Promise.resolve({ op: "count" as const, total: 3 }),
            },
          ],
        },
      } as never,
    ]);

    expect(getSource("plugin:stripe/revenue")).toBeUndefined();
    // The control: core's own sources DID register in the same call, so this
    // cannot pass by registering nothing at all.
    expect(getSource(RELEASES_SOURCE_ID)).toBeDefined();
  });

  it("lists a plugin's declared widget under that plugin, by its name", () => {
    // The add panel lists a plugin's widgets under the plugin that declared
    // them: the name travels from the plugin, through its dashboard, to the
    // widget's summary.
    resetWidgetRegistries([
      {
        name: "@acme/forms",
        version: "1.0.0",
        nextly: "*",
        contributes: {
          dashboard: {
            widgets: [
              defineWidget({
                id: "forms/latest",
                title: "Latest",
                description: "The newest submissions.",
                size: { default: { w: 6, h: 4 } },
                load: () => Promise.resolve({ items: [] }),
                view: { component: "@acme/forms/admin#Latest" },
                isEmpty: () => false,
              }),
            ],
          },
        },
      } as never,
    ]);
    const byId = new Map(allWidgets().map(card => [card.id, card]));
    expect(byId.get("forms/latest")?.plugin).toBe("@acme/forms");
    // The control: core's own widgets name no plugin.
    expect(byId.get(CORE_WIDGET_IDS[0])).toBeDefined();
    expect(byId.get(CORE_WIDGET_IDS[0])).not.toHaveProperty("plugin");
  });

  it("leaves the deferral store alone, because it has not synced anything yet", () => {
    // 🔴 The reset runs BEFORE the boot syncs any metadata, so clearing here
    // would publish "nothing is withheld" on the strength of work that has not
    // happened -- and the boot's own sync can then fail and be CAUGHT, leaving
    // the registry exactly as stale as the previous reload found it while the
    // set says otherwise.
    //
    // Each kind replaces its own set from its own sync path instead, once that
    // sync has succeeded (`publishBootDeferrals` in `di/register`), which
    // clears a previous boot's refusal on the pass that earns the right to and
    // retains it when the sync throws.
    setDeferredEntities("collection", ["posts"]);
    setDeferredEntities("single", ["settings"]);

    resetWidgetRegistries();

    expect([...deferredEntities("collection")]).toEqual(["posts"]);
    expect([...deferredEntities("single")]).toEqual(["settings"]);
  });

  it("drops the previous boot's widgets and leaves core's own", () => {
    // The property is that nothing SURVIVES a boot, not that the store ends
    // empty -- core registers its dashboard cards in this same function, so
    // empty stopped being the right assertion when it gained its first
    // definition. Asserted by identity rather than by count: a reset that
    // dropped a core card while leaving the plugin's would match any total.
    seedWidget("stripe/revenue");

    resetWidgetRegistries();

    const ids = listWidgets().map(widget => widget.id);
    expect(ids).not.toContain("stripe/revenue");
    // Every one of core's, its definitions and its declarations alike.
    expect([...ids].sort()).toEqual([...CORE_WIDGET_IDS].sort());
    expect(() => seedWidget("stripe/revenue")).not.toThrow();
  });

  it("registers core's cards without colliding across repeated boots", () => {
    // The hot-reload case, for the rows this function now writes itself: two
    // resets in a row must not report core's own ids as duplicates, which is
    // exactly what would happen if the registration ran anywhere but after the
    // clear in this one function.
    resetWidgetRegistries();
    expect(() => resetWidgetRegistries()).not.toThrow();
    expect(listWidgets()).toHaveLength(CORE_WIDGET_IDS.length);
  });

  it("answers every source core's own cards read in their load", () => {
    // 🔴 A card's `load` reads its `system:` source through the resolver
    // registered for it, so a source registered under another id, or not at
    // all, would fail that card for every reader. Core's cards and their
    // sources name each id by one shared constant, and this is what makes that
    // CHECKED: each is answered once boot has run.
    resetWidgetRegistries();
    for (const id of [
      CONTENT_SOURCE_ID,
      TEAM_SOURCE_ID,
      CONTINUE_SOURCE_ID,
      RELEASES_SOURCE_ID,
      ACTIVITY_SOURCE_ID,
    ]) {
      expect([id, systemResolver(id) !== undefined]).toEqual([id, true]);
    }
    // The control: an id nothing registers has no resolver.
    expect(systemResolver("system:nothing-serves-this")).toBeUndefined();
  });

  it("still refuses a genuine duplicate WITHIN one boot", () => {
    // The negative control for both cases above. Clearing between boots must
    // not turn into clearing between registrations: two plugins claiming one
    // id inside a single boot is a real collision and has to be reported.
    resetWidgetRegistries();
    seedSource("plugin:stripe/revenue");
    expect(() => seedSource("plugin:stripe/revenue")).toThrow(
      /already registered/
    );

    seedWidget("stripe/revenue");
    expect(() => seedWidget("stripe/revenue")).toThrow(/already registered/);
  });
});
