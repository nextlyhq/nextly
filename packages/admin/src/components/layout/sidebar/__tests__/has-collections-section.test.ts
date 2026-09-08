import { describe, expect, it } from "vitest";

import type { ApiCollection } from "@admin/types/entities";

import {
  belongsInCollectionsSection,
  hasCollectionsSection,
} from "../lib/has-collections-section";
import { hasVisiblePluginCollection } from "../lib/has-plugins-section";

const collection = (
  name: string,
  admin?: ApiCollection["admin"]
): ApiCollection => ({ name, admin }) as ApiCollection;

const ordinary = collection("posts");
const hidden = collection("secrets", { hidden: true });
const pluginOwned = collection("forms", { isPlugin: true });

/** No plugin claims a placement, which is the common case. */
const noPlacement = () => undefined;

const SETTLED = {
  isPending: false,
  isError: false,
  placementOf: noPlacement,
};

describe("belongsInCollectionsSection", () => {
  it("counts an ordinary collection", () => {
    expect(belongsInCollectionsSection(ordinary, noPlacement)).toBe(true);
  });

  it("never counts a hidden collection", () => {
    expect(belongsInCollectionsSection(hidden, noPlacement)).toBe(false);
  });

  /**
   * A plugin that has not claimed a placement leaves its collection here, so
   * the section is the default home rather than something a plugin opts into.
   */
  it("counts a plugin collection that claims no placement", () => {
    expect(belongsInCollectionsSection(pluginOwned, noPlacement)).toBe(true);
  });

  it("counts a plugin collection placed here explicitly", () => {
    expect(belongsInCollectionsSection(pluginOwned, () => "collections")).toBe(
      true
    );
  });

  /**
   * The rule this predicate exists for. A plugin that moved its collection
   * elsewhere must not keep the Collections section alive, or the rail offers
   * a section whose destinations have all gone.
   */
  it("does not count a plugin collection placed elsewhere", () => {
    expect(belongsInCollectionsSection(pluginOwned, () => "plugins")).toBe(
      false
    );
  });

  it("ignores placement entirely for a hidden plugin collection", () => {
    const hiddenPlugin = collection("forms", { isPlugin: true, hidden: true });
    expect(belongsInCollectionsSection(hiddenPlugin, () => "collections")).toBe(
      false
    );
  });
});

describe("hasCollectionsSection", () => {
  it("hides the entry from a reader who may not view collections", () => {
    expect(
      hasCollectionsSection(
        { canViewCollections: false },
        { ...SETTLED, permittedCollections: [ordinary] }
      )
    ).toBe(false);
  });

  it("shows the entry once a visible collection has resolved", () => {
    expect(
      hasCollectionsSection(
        { canViewCollections: true },
        { ...SETTLED, permittedCollections: [ordinary] }
      )
    ).toBe(true);
  });

  it("hides it when every permitted collection is hidden or placed away", () => {
    expect(
      hasCollectionsSection(
        { canViewCollections: true },
        { ...SETTLED, permittedCollections: [hidden] }
      )
    ).toBe(false);
  });

  it("shows it while the answer is still loading", () => {
    expect(
      hasCollectionsSection(
        { canViewCollections: true },
        { ...SETTLED, isPending: true, permittedCollections: [] }
      )
    ).toBe(true);
  });

  /**
   * The arm that differs from the plugins section beside it. A FAILED query
   * cannot tell the rail whether this reader has collections, and hiding the
   * section would remove their only route to content they may see. The plugins
   * panel has a second destination for a settings manager and can afford to
   * decide; this one cannot.
   */
  it("shows it when the collections query failed", () => {
    expect(
      hasCollectionsSection(
        { canViewCollections: true },
        { ...SETTLED, isError: true, permittedCollections: [] }
      )
    ).toBe(true);
  });
});

describe("hasVisiblePluginCollection", () => {
  it("ignores a collection no plugin owns", () => {
    expect(hasVisiblePluginCollection([ordinary], noPlacement)).toBe(false);
  });

  it("counts a plugin collection that claims no placement", () => {
    expect(hasVisiblePluginCollection([pluginOwned], noPlacement)).toBe(true);
  });

  it("counts one placed in the plugins panel", () => {
    expect(hasVisiblePluginCollection([pluginOwned], () => "plugins")).toBe(
      true
    );
  });

  it("does not count one placed in the collections section", () => {
    expect(hasVisiblePluginCollection([pluginOwned], () => "collections")).toBe(
      false
    );
  });

  it("never counts a hidden plugin collection", () => {
    const hiddenPlugin = collection("forms", { isPlugin: true, hidden: true });
    expect(hasVisiblePluginCollection([hiddenPlugin], noPlacement)).toBe(false);
  });

  /**
   * The two sections partition the same set: a placement-less plugin
   * collection is offered by both, and one that named a panel is offered by
   * exactly that panel.
   */
  it("partitions plugin collections with the collections section", () => {
    for (const placement of [undefined, "collections", "plugins"] as const) {
      const placementOf = () => placement;
      const inPlugins = hasVisiblePluginCollection([pluginOwned], placementOf);
      const inCollections = belongsInCollectionsSection(
        pluginOwned,
        placementOf
      );
      expect(inPlugins || inCollections).toBe(true);
    }
  });
});
