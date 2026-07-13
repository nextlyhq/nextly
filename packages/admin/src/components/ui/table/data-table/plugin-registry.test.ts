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
});
