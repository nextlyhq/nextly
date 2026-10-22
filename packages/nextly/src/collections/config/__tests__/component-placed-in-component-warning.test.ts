/**
 * A component placed directly in another component's fields is named when the config is defined.
 *
 * Its value is not stored there, and a write that carries one is refused, so the config says so
 * up front rather than leaving it to the first save. A warning rather than a refusal: a config
 * already shipped with the placement still boots, and the outer component's other fields work.
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
  it("is named in a warning when placed directly, and the config still defines", () => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});

    expect(() =>
      defineWith([
        { type: "text", name: "title" },
        { type: "fieldGroup", name: "badge", fieldGroup: "badge" },
      ])
    ).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"card"');
    expect(String(warn.mock.calls[0]?.[0])).toContain('"badge"');
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
