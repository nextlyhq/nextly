/**
 * A component's area hint is read as what the component is used as.
 *
 * The stored values stay `header`, `footer` and empty; only the words an
 * author reads change. Empty means the component suits anywhere on a page,
 * so the field says "Anywhere" while it holds nothing, and can be cleared
 * back to it.
 *
 * @module collections/components.test
 */
import { describe, expect, it } from "vitest";

import { layoutAreaOptions } from "./areas";
import { componentsCollection } from "./components";

function areaField(): Record<string, unknown> {
  const field = componentsCollection().fields.find(
    each => "name" in each && each.name === "area"
  );
  if (field === undefined) throw new Error("expected an area field");
  return field as unknown as Record<string, unknown>;
}

describe("a component's area hint", () => {
  it('is labelled "Use as", with Header, Footer and Anywhere', () => {
    const field = areaField();
    expect(field.label).toBe("Use as");
    expect(
      (field.options as { label: string }[]).map(option => option.label)
    ).toEqual(["Header", "Footer"]);
    expect(field.admin).toMatchObject({
      placeholder: "Anywhere",
      isClearable: true,
    });
  });

  it("keeps the stored values", () => {
    expect(layoutAreaOptions()).toEqual([
      { label: "Header", value: "header" },
      { label: "Footer", value: "footer" },
    ]);
  });
});
