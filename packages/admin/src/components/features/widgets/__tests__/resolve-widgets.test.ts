/**
 * Which DEFINITION a widget is drawn from when both channels declare its id.
 *
 * Covered here rather than through `WidgetGrid`, because the question is about
 * the resolver's answer and a grid test can only see it through whatever the
 * archetype happened to render. The permission case in particular has no
 * visible difference to assert on: both outcomes draw nothing, and only the
 * returned list says whether that was the tightened rule being honoured or the
 * widget being absent for some other reason.
 */
import { describe, expect, it } from "vitest";

import type {
  PluginMetadata,
  RegisteredWidgetMeta,
} from "@admin/types/branding";

import { resolveDashboardWidgets } from "../resolve-widgets";

const allow = () => true;
const deny = () => false;

function contributing(widgets: unknown[]): PluginMetadata[] {
  return [
    { name: "@acme", collections: [], widgets },
  ] as unknown as PluginMetadata[];
}

const REGISTERED_SHARED = {
  id: "shared",
  title: "From the registry",
  archetype: "metric",
  defaultSize: "sm",
  query: { source: "collection:posts", op: "count" },
} as unknown as RegisteredWidgetMeta;

describe("resolveDashboardWidgets", () => {
  it("draws a colliding id from the registered definition, not the contribution", () => {
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "shared", title: "From the contribution", archetype: "metric" },
      ]),
      [REGISTERED_SHARED],
      allow
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0].title).toBe("From the registry");
    // The registry's query is what reaches the batch. The contribution above
    // declares none, so a resolver that preferred it would put no request in
    // flight at all and the card would sit loading forever.
    expect(widgets[0].query).toEqual({
      source: "collection:posts",
      op: "count",
    });
  });

  it("keeps the contribution's POSITION while taking the registry's definition", () => {
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "shared", title: "From the contribution", archetype: "metric" },
        { id: "second", title: "Second", archetype: "metric" },
      ]),
      [REGISTERED_SHARED],
      allow
    );

    expect(widgets.map(w => w.id)).toEqual(["shared", "second"]);
  });

  it("honours a permission the registry TIGHTENED on a contributed id", () => {
    // The security shape: an operator restricts a widget through
    // `extendWidget`/`overrideWidget`, and the contributed copy carries no
    // permission at all. Preferring the contribution draws the card and puts
    // its query in the batch for a user the running configuration says may not
    // see it.
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "shared", title: "From the contribution", archetype: "metric" },
      ]),
      [
        {
          ...REGISTERED_SHARED,
          requiredPermission: "read-secrets",
        } as unknown as RegisteredWidgetMeta,
      ],
      deny
    );

    expect(widgets).toEqual([]);
  });

  it("still renders a contribution the registry knows nothing about", () => {
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "only-contributed", title: "Contributed", archetype: "metric" },
      ]),
      [REGISTERED_SHARED],
      allow
    );

    expect(widgets.map(w => w.id)).toEqual(["only-contributed", "shared"]);
  });

  it("drops a duplicate id inside the registry payload itself", () => {
    // The registry is a map and cannot hold two, but this list crossed the
    // wire. Two cells for one id would hand both the same batch slot.
    const widgets = resolveDashboardWidgets(
      undefined,
      [
        REGISTERED_SHARED,
        { ...REGISTERED_SHARED, title: "Second copy" },
      ] as unknown as RegisteredWidgetMeta[],
      allow
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0].title).toBe("From the registry");
  });
});
