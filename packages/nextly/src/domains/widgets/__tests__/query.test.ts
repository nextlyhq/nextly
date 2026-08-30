import { beforeEach, describe, expect, it } from "vitest";

import { MAX_WIDGET_LIMIT, validateWidgetQuery } from "../query";
import { clearSources, registerSource } from "../sources";

beforeEach(() => {
  clearSources();
  registerSource({
    id: "collection:posts",
    label: "Posts",
    kind: "collection",
    supports: ["count", "list"],
    fields: [
      { name: "title", type: "string" },
      { name: "status", type: "string" },
      { name: "updatedAt", type: "date" },
    ],
  });
});

describe("validateWidgetQuery", () => {
  it("accepts a query naming a registered source and declared fields", () => {
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "list",
      select: ["title"],
      sort: "-updatedAt",
      where: { status: { equals: "draft" } },
      limit: 5,
    });
    expect(q.limit).toBe(5);
  });

  it("refuses an unregistered source", () => {
    // The source id is resolved against the registry, so no caller-invented
    // table name can ever reach the compiler.
    expect(() =>
      validateWidgetQuery({ source: "collection:secrets", op: "count" })
    ).toThrow(/collection:secrets/);
  });

  it("refuses an op the source does not support", () => {
    expect(() =>
      validateWidgetQuery({ source: "collection:posts", op: "timeseries" })
    ).toThrow(/timeseries/);
  });

  it("refuses a where clause naming an undeclared field", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "count",
        where: { secretScore: { equals: 1 } },
      })
    ).toThrow(/secretScore/);
  });

  it("refuses a select naming an undeclared field", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        select: ["title", "secretScore"],
      })
    ).toThrow(/secretScore/);
  });

  it("refuses a sort naming an undeclared field, with or without the minus", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        sort: "-secretScore",
      })
    ).toThrow(/secretScore/);
  });

  it("clamps the limit rather than trusting it", () => {
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "list",
      limit: 100000,
    });
    expect(q.limit).toBe(MAX_WIDGET_LIMIT);
  });

  it("refuses a where clause nested past the depth cap", () => {
    // Unbounded nesting is a cheap way to make validation itself the
    // expensive operation.
    let deep: Record<string, unknown> = { status: { equals: "draft" } };
    for (let i = 0; i < 12; i++) deep = { and: [deep] };
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "count",
        where: deep,
      })
    ).toThrow(/nested too deeply/);
  });
});
