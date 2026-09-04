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

import { CORE_WIDGETS } from "../../domains/widgets/core-widgets";

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
      defaultSize: "sm",
      query: { source: "plugin:stripe/revenue", op: "count" },
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
    expect(listSources().map(source => source.id)).toEqual([
      RELEASES_SOURCE_ID,
    ]);
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
    expect(ids).toEqual(CORE_WIDGETS.map(widget => widget.id));
    expect(() => seedWidget("stripe/revenue")).not.toThrow();
  });

  it("registers core's cards without colliding across repeated boots", () => {
    // The hot-reload case, for the rows this function now writes itself: two
    // resets in a row must not report core's own ids as duplicates, which is
    // exactly what would happen if the registration ran anywhere but after the
    // clear in this one function.
    resetWidgetRegistries();
    expect(() => resetWidgetRegistries()).not.toThrow();
    expect(listWidgets()).toHaveLength(CORE_WIDGETS.length);
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
