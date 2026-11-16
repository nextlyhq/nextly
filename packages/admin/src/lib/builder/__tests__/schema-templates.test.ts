/**
 * Templates offered in the new-entity dialog: the built-in ones first, then
 * each plugin's under its name, for the kind asked, and gone again once a
 * plugin takes its registration back.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BUILT_IN_TEMPLATES } from "../builtin-templates";
import {
  offeredTemplates,
  registerSchemaTemplates,
  useSchemaTemplates,
  type SchemaTemplate,
} from "../schema-templates";

const acmeArticles: SchemaTemplate = {
  id: "articles",
  kind: "collection",
  category: "Content",
  name: "Acme articles",
  description: "",
  fields: [{ name: "lede", type: "text" }],
};

describe("templates offered", () => {
  it("built in first, then a plugin's under its name, and gone once removed", () => {
    const remove = registerSchemaTemplates("Acme", [acmeArticles]);
    const all = offeredTemplates();
    expect(all.slice(0, BUILT_IN_TEMPLATES.length).map(e => e.source)).toEqual(
      BUILT_IN_TEMPLATES.map(() => null)
    );
    expect(all.at(-1)).toEqual({ template: acmeArticles, source: "Acme" });
    remove();
    expect(offeredTemplates().some(e => e.source === "Acme")).toBe(false);
    // Taking it back twice takes back nothing more.
    remove();
    expect(offeredTemplates()).toHaveLength(BUILT_IN_TEMPLATES.length);
  });

  it("for one kind, following a registration made while drawn", () => {
    const { result } = renderHook(() => useSchemaTemplates("collection"));
    const before = result.current.length;
    expect(result.current.every(e => e.template.kind === "collection")).toBe(
      true
    );
    let remove = () => {};
    act(() => {
      remove = registerSchemaTemplates("Acme", [
        acmeArticles,
        { ...acmeArticles, id: "settings", kind: "single" },
      ]);
    });
    expect(result.current).toHaveLength(before + 1);
    act(() => remove());
    expect(result.current).toHaveLength(before);
  });
});
