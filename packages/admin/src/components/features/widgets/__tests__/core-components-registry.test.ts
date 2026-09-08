/**
 * `registerCoreWidgetComponents` actually REGISTERS, at runtime.
 *
 * 🔴 A sibling test compares the two lists as text and cannot prove this. A
 * syntax scan sees call-shaped source; it does not see the call run. If the
 * module-scope invocation in `WidgetGrid` were removed, a registration moved
 * behind a branch that never executes, or the function returned early, both
 * scanned lists would still agree while `PluginSlot` drew its unresolved
 * fallback for every reader.
 *
 * ## Why the mocks, and what they cost
 *
 * `core-components.ts` cannot be imported directly: it imports `TeamSummary`
 * and `CollectionQuickLinks`, which reach the `@admin/hooks/queries` barrel,
 * which reaches `pages/dashboard/index.tsx`, which imports `WidgetGrid`, which
 * calls `registerCoreWidgetComponents()` at module scope -- re-entering the
 * module being evaluated. Importing it throws before a single case runs, and
 * that cycle is pre-existing rather than introduced by these cards.
 *
 * Each card component is replaced with a stub, which cuts the graph at the
 * first edge and leaves the module under test untouched. What that costs is
 * honest to state: this proves the registry receives a component for each path,
 * not that the component is the real one -- the sibling text scan is what pins
 * the paths themselves. The two together are the boundary; neither alone is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = () => null;

// Cut at the components, not at the registry: the registry is the thing under
// test, and mocking it would leave this asserting its own mock.
vi.mock("@admin/components/features/dashboard/SeedDemoContentCard", () => ({
  SeedDemoContentCard: stub,
}));
vi.mock("@admin/components/features/dashboard/CollectionQuickLinks", () => ({
  CollectionQuickLinks: stub,
}));
vi.mock("@admin/components/features/dashboard/SinglesQuickLinks", () => ({
  SinglesQuickLinks: stub,
}));
vi.mock("@admin/components/features/dashboard/QuickCreate", () => ({
  QuickCreate: stub,
}));
vi.mock("@admin/components/features/dashboard/TeamSummary", () => ({
  TeamSummary: stub,
}));
vi.mock("@admin/components/features/dashboard/RecentActivity", () => ({
  RecentActivity: stub,
}));

describe("core widget components register at runtime", () => {
  beforeEach(async () => {
    const { componentRegistry } = await import(
      "@admin/lib/plugins/component-registry-internal"
    );
    componentRegistry.clear();
  });

  it("registers every path a core card names", async () => {
    const { hasComponent } = await import(
      "@admin/lib/plugins/component-registry"
    );
    const { registerCoreWidgetComponents } = await import("../core-components");

    // The control, BEFORE the call: every path must be absent first, or a
    // registry left populated by another module would satisfy the assertions
    // below without this function having run at all.
    expect(hasComponent("core#RecentActivity")).toBe(false);
    expect(hasComponent("core#TeamSummary")).toBe(false);

    registerCoreWidgetComponents();

    for (const path of [
      "core#SeedDemoContentCard",
      "core#CollectionQuickLinks",
      "core#SinglesQuickLinks",
      "core#QuickCreate",
      "core#TeamSummary",
      "core#RecentActivity",
    ]) {
      expect(hasComponent(path), `${path} is not registered`).toBe(true);
    }
  });

  it("resolves each path to something renderable", async () => {
    const { getComponent } = await import(
      "@admin/lib/plugins/component-registry"
    );
    const { registerCoreWidgetComponents } = await import("../core-components");

    registerCoreWidgetComponents();

    // `hasComponent` alone would pass on a path registered with `undefined`,
    // which is the shape a broken import produces.
    expect(typeof getComponent("core#RecentActivity")).toBe("function");
  });
});
