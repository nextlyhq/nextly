import { describe, it, expect, beforeEach } from "vitest";

import {
  registerColumns,
  transformColumns,
  registerRowAction,
  registerBulkAction,
  resolvePluginColumns,
  getPluginRowActions,
  getPluginBulkActions,
  clearDataTablePlugins,
  dataTablePluginRegistrations,
  pluginColumnsDeciding,
  subscribeToDataTablePlugins,
} from "./plugin-registry";
import type { NextlyColumn } from "./types";

const base: NextlyColumn[] = [{ name: "title", header: "Title" }];

describe("data-table plugin-registry", () => {
  beforeEach(() => {
    clearDataTablePlugins();
  });

  it("appends columns registered for a target", () => {
    registerColumns("posts", () => [{ name: "seo", header: "SEO" }]);
    const cols = resolvePluginColumns("posts", base);
    expect(cols.map(c => c.name)).toEqual(["title", "seo"]);
  });

  it("applies wildcard '*' columns to every target", () => {
    registerColumns("*", () => [{ name: "global", header: "Global" }]);
    expect(resolvePluginColumns("users", base).map(c => c.name)).toContain(
      "global"
    );
    expect(resolvePluginColumns("media", base).map(c => c.name)).toContain(
      "global"
    );
  });

  it("does not leak scoped columns to other targets", () => {
    registerColumns("posts", () => [{ name: "seo", header: "SEO" }]);
    expect(resolvePluginColumns("users", base).map(c => c.name)).not.toContain(
      "seo"
    );
  });

  it("runs transforms after appends, in registration order", () => {
    registerColumns("posts", () => [{ name: "seo", header: "SEO" }]);
    transformColumns("posts", cols => cols.filter(c => c.name !== "title"));
    transformColumns("posts", cols => [...cols].reverse());
    const cols = resolvePluginColumns("posts", base);
    expect(cols.map(c => c.name)).toEqual(["seo"]);
  });

  it("isolates a throwing provider without dropping others", () => {
    registerColumns("posts", () => {
      throw new Error("boom");
    });
    registerColumns("posts", () => [{ name: "ok", header: "Ok" }]);
    const cols = resolvePluginColumns("posts", base);
    expect(cols.map(c => c.name)).toEqual(["title", "ok"]);
  });

  it("collects row actions for a target plus the wildcard", () => {
    registerRowAction("*", { id: "a", label: "A", onSelect: () => {} });
    registerRowAction("users", { id: "b", label: "B", onSelect: () => {} });
    expect(getPluginRowActions("users").map(a => a.id)).toEqual(["a", "b"]);
    expect(getPluginRowActions("media").map(a => a.id)).toEqual(["a"]);
  });

  it("collects bulk actions for a target plus the wildcard", () => {
    registerBulkAction("*", { id: "x", label: "X", onSelect: () => {} });
    registerBulkAction("users", { id: "y", label: "Y", onSelect: () => {} });
    expect(getPluginBulkActions("users").map(a => a.id)).toEqual(["x", "y"]);
  });

  it("clearDataTablePlugins removes all registrations", () => {
    registerColumns("posts", () => [{ name: "seo", header: "SEO" }]);
    registerRowAction("posts", { id: "a", label: "A", onSelect: () => {} });
    clearDataTablePlugins();
    expect(resolvePluginColumns("posts", base).map(c => c.name)).toEqual([
      "title",
    ]);
    expect(getPluginRowActions("posts")).toEqual([]);
  });

  it("takes back one registration, leaving the rest, and only once", () => {
    const seo = () => [{ name: "seo", header: "SEO" }];
    const removeSeo = registerColumns("posts", seo);
    registerColumns("posts", () => [{ name: "design", header: "Design" }]);
    // The same provider registered again is a second registration.
    registerColumns("posts", seo);
    const removeMove = transformColumns("posts", columns => [
      ...columns.slice(1),
      ...columns.slice(0, 1),
    ]);

    removeSeo();
    removeMove();
    expect(resolvePluginColumns("posts", base).map(c => c.name)).toEqual([
      "title",
      "design",
      "seo",
    ]);
    // A second call does not take back the provider's other registration.
    removeSeo();
    expect(resolvePluginColumns("posts", base).map(c => c.name)).toEqual([
      "title",
      "design",
      "seo",
    ]);
  });

  it("takes back row and bulk actions", () => {
    const removeRow = registerRowAction("users", {
      id: "a",
      label: "A",
      onSelect: () => {},
    });
    const removeBulk = registerBulkAction("users", {
      id: "x",
      label: "X",
      onSelect: () => {},
    });
    registerBulkAction("users", { id: "y", label: "Y", onSelect: () => {} });
    removeRow();
    removeBulk();
    expect(getPluginRowActions("users")).toEqual([]);
    expect(getPluginBulkActions("users").map(a => a.id)).toEqual(["y"]);
  });

  // A provider whose columns rest on a read of its own says so, and a list
  // holds its rows a moment for it; the property separating this from a
  // plausible broken registry is that the lists are asked again once the
  // read settles even when it adds no column, or a list would wait out its
  // whole hold for every collection without one.
  it("says a list's columns are still being decided while a provider waits on a read", async () => {
    let answer = () => {};
    const read = new Promise<void>(resolve => {
      answer = resolve;
    });
    let out = true;
    registerColumns("*", ctx =>
      out && ctx.deciding !== undefined ? ctx.deciding(read) : []
    );
    registerColumns("posts", () => [{ name: "seo", header: "SEO" }]);
    expect(pluginColumnsDeciding("posts")).toBe(true);
    // Deciding adds no column of its own.
    expect(resolvePluginColumns("posts", base).map(c => c.name)).toEqual([
      "title",
      "seo",
    ]);

    const before = dataTablePluginRegistrations();
    let told = 0;
    const stop = subscribeToDataTablePlugins(() => {
      told += 1;
    });
    out = false;
    answer();
    await read;
    await Promise.resolve();
    stop();
    // Told once, though nothing was registered, and decided now.
    expect(told).toBe(1);
    expect(dataTablePluginRegistrations()).not.toBe(before);
    expect(pluginColumnsDeciding("posts")).toBe(false);
  });

  // Whether a list holds its rows and the columns it draws come from one ask
  // of its providers, which may start a read when asked: two asks could see
  // that read in two states. And a list drawn anew asks anew, since a
  // provider's answer can follow time as well as the registrations (a "no
  // column" that stands only a while): an ask kept by snapshot alone would
  // answer a list reopened later from a stale decision.
  it("asks a list's providers once per drawn list for its columns and whether it is deciding", () => {
    let asked = 0;
    registerColumns("posts", () => {
      asked += 1;
      return [{ name: "seo", header: "SEO" }];
    });
    const drawn = {};
    expect(pluginColumnsDeciding("posts", undefined, drawn)).toBe(false);
    resolvePluginColumns("posts", base, undefined, drawn);
    resolvePluginColumns("posts", [...base], undefined, drawn);
    expect(asked).toBe(1);
    // The same list in a new snapshot asks again.
    registerColumns("tags", () => []);
    resolvePluginColumns("posts", base, undefined, drawn);
    expect(asked).toBe(2);
    // A list drawn anew, in the same snapshot, asks again.
    resolvePluginColumns("posts", base, undefined, {});
    expect(asked).toBe(3);
  });

  it("is deciding nothing where no provider says so, or one throws", () => {
    registerColumns("*", () => {
      throw new Error("broken provider");
    });
    registerColumns("posts", () => [{ name: "seo", header: "SEO" }]);
    expect(pluginColumnsDeciding("posts")).toBe(false);
  });
});
