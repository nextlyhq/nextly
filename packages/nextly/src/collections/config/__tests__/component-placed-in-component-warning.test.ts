/**
 * A component placed in another component's fields is defined without a warning, wherever it sits.
 *
 * Placed directly, its instances are rows of their own table; held in a group or a repeater, they
 * are stored in that container's value. Either way it is stored, so the config has nothing to say.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { consoleLogger } from "../../../shared/types";
import { defineConfig } from "../define-config";

const badge = {
  slug: "badge",
  label: { singular: "badge" },
  fields: [{ type: "text" as const, name: "label" }],
};

function defineWith(fields: unknown[]) {
  return defineConfig({
    collections: [],
    fieldGroups: [badge, { slug: "card", label: { singular: "card" }, fields }],
  } as never);
}

afterEach(() => vi.restoreAllMocks());

describe("a component placed in another component's fields", () => {
  it("is defined without a warning when placed directly", () => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});

    expect(() =>
      defineWith([
        { type: "text", name: "title" },
        { type: "fieldGroup", name: "badge", fieldGroup: "badge" },
      ])
    ).not.toThrow();

    expect(warn).not.toHaveBeenCalled();
  });

  it("is not warned about when held in a group or a repeater", () => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});

    defineWith([
      {
        type: "group",
        name: "meta",
        fields: [{ type: "fieldGroup", name: "badge", fieldGroup: "badge" }],
      },
      {
        type: "repeater",
        name: "chips",
        fields: [{ type: "fieldGroup", name: "badge", fieldGroup: "badge" }],
      },
    ]);

    expect(warn).not.toHaveBeenCalled();
  });
});
