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

import {
  clearWidgets,
  listWidgets,
  registerWidget,
} from "../../domains/widgets/registry";
import {
  clearSources,
  listSources,
  registerSource,
} from "../../domains/widgets/sources";
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
  it("empties the source registry so a reload cannot collide with itself", () => {
    seedSource("plugin:stripe/revenue");
    expect(listSources()).toHaveLength(1);

    resetWidgetRegistries();

    expect(listSources()).toHaveLength(0);
    // The proof that the clear is what made room: the same id registers again
    // without the conflict `registerSource` raises for a duplicate.
    expect(() => seedSource("plugin:stripe/revenue")).not.toThrow();
  });

  it("empties the widget registry for the same reason", () => {
    seedWidget("stripe/revenue");
    expect(listWidgets()).toHaveLength(1);

    resetWidgetRegistries();

    expect(listWidgets()).toHaveLength(0);
    expect(() => seedWidget("stripe/revenue")).not.toThrow();
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
