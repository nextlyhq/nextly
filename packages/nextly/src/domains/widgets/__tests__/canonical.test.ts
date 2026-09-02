/**
 * One answer to "which widgets exist", across two channels that do not share a
 * shape.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { canonicalWidgets, type CanonicalWidget } from "../canonical";
import type { WidgetDefinition } from "../definition";
import { clearWidgets, registerWidget } from "../registry";

function registered(patch: Partial<WidgetDefinition>): WidgetDefinition {
  return {
    id: "core/a",
    title: "A",
    archetype: "custom",
    defaultSize: "full",
    component: "core#A",
    ...patch,
  } as WidgetDefinition;
}

beforeEach(() => clearWidgets());

describe("the canonical widget set", () => {
  it("includes a widget that only CONTRIBUTED", () => {
    // 🔴 The defect. `listWidgets()` answers the imperative registry alone, so
    // a plugin using the documented `contributes.admin.widgets` surface was
    // absent from the default arrangement and from `available`, and every write
    // naming it was refused as unavailable — a card that renders and can never
    // be arranged.
    const contributed: CanonicalWidget[] = [{ id: "forms/latest" }];
    expect(canonicalWidgets(contributed).map(w => w.id)).toEqual([
      "forms/latest",
    ]);
  });

  it("includes widgets from both channels", () => {
    registerWidget(registered({ id: "core/team" }));
    expect(
      canonicalWidgets([{ id: "forms/latest" }])
        .map(w => w.id)
        .sort()
    ).toEqual(["core/team", "forms/latest"]);
  });

  it("lets a REGISTRATION win a collision, matching the admin's resolver", () => {
    // The two must agree. If the server ordered a card by the contribution
    // while the admin drew it from the registration, the arrangement would
    // order one declaration and render another, and nothing would look wrong.
    registerWidget(registered({ id: "dup/one", defaultOrder: 5 }));
    const merged = canonicalWidgets([{ id: "dup/one", defaultOrder: 99 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultOrder).toBe(5);
  });

  it("keeps a CONTRIBUTED order the registration did not state", () => {
    // 🔴 A collision was resolved by wholesale replacement, which the admin
    // does not do: `resolve-widgets.ts` reads
    // `registration.defaultOrder ?? contribution.defaultOrder`. So a
    // registration that stated no order dropped the contributed one here and
    // kept it there -- the server building the default arrangement from one
    // declaration while the grid drew it from another, with a card sorted into
    // a position the reader never sees.
    registerWidget(registered({ id: "dup/one" }));
    const merged = canonicalWidgets([{ id: "dup/one", defaultOrder: 99 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultOrder).toBe(99);
  });

  it("keeps a CONTRIBUTED height the registration did not state", () => {
    registerWidget(registered({ id: "dup/one" }));
    expect(
      canonicalWidgets([{ id: "dup/one", defaultHeight: "tall" }])[0]
    ).toHaveProperty("defaultHeight", "tall");
  });

  it("does NOT inherit a contributed permission, matching the admin", () => {
    // The asymmetry is deliberate. The registry is the override channel, so a
    // registration that states no permission has stated that, and
    // `mergeCollision` reads it exactly that way. Falling back here would gate
    // a card the admin renders ungated -- the reader sees it and every write
    // naming it is refused, which is the same disagreement inverted.
    registerWidget(registered({ id: "dup/one" }));
    const merged = canonicalWidgets([
      { id: "dup/one", requiredPermission: "read-forms" },
    ]);
    expect(merged[0]).not.toHaveProperty("requiredPermission");
  });

  it("keeps the FIRST of two contributions sharing an id", () => {
    // 🔴 Widget ids are plugin-local, so two enabled plugins can ship the same
    // one. `resolveDashboardWidgets` walks declarations in order and keeps the
    // first renderable; this kept the LAST, so the layout endpoint placed one
    // plugin's widget while the grid drew the other's -- a card wearing another
    // plugin's geometry, or filtered away by a permission it never declared.
    const merged = canonicalWidgets([
      { id: "dup/two", defaultOrder: 1, requiredPermission: "read-a" },
      { id: "dup/two", defaultOrder: 99, requiredPermission: "read-b" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultOrder).toBe(1);
    expect(merged[0].requiredPermission).toBe("read-a");
  });

  it("carries the fields placement reads, from a registration", () => {
    registerWidget(
      registered({
        id: "core/team",
        requiredPermission: "read-users",
        defaultSize: "md",
        defaultHeight: "tall",
        defaultOrder: 20,
      })
    );
    expect(canonicalWidgets([])[0]).toEqual({
      id: "core/team",
      requiredPermission: "read-users",
      defaultSize: "md",
      defaultHeight: "tall",
      defaultOrder: 20,
    });
  });

  it("omits what a declaration did not state", () => {
    registerWidget(registered({ id: "core/team" }));
    const [widget] = canonicalWidgets([]);
    expect(widget).not.toHaveProperty("requiredPermission");
    expect(widget).not.toHaveProperty("defaultOrder");
  });

  it("keeps a contributed size this core has never heard of", () => {
    // A contribution crosses a version boundary. Refusing an unknown size here
    // would drop the whole card from the arrangement over a value the admin
    // already survives by falling back.
    expect(canonicalWidgets([{ id: "p/w", defaultSize: "xxl" }])[0]).toEqual({
      id: "p/w",
      defaultSize: "xxl",
    });
  });

  it("drops a contribution with no usable id", () => {
    expect(canonicalWidgets([{ id: "" }])).toEqual([]);
  });

  it("is empty when neither channel has anything", () => {
    expect(canonicalWidgets([])).toEqual([]);
  });
});
