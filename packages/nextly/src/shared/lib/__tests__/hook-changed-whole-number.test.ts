/**
 * Guards the post-hook whole-number walk: the beforeChange hooks run after
 * the validation gate and may transform any value in the document, so the
 * walk judges the document the write will store — over exactly the fields
 * whose value the gate judged as a number, wherever a hook could reach.
 */
import { describe, expect, it } from "vitest";

import {
  hookChangedWholeNumberIssues,
  type ValidatableField,
} from "../entry-validation";

describe("hookChangedWholeNumberIssues", () => {
  it("judges a whole-number field's fraction", () => {
    const fields: ValidatableField[] = [
      { name: "quantity", type: "number", label: "Quantity" },
    ];
    expect(hookChangedWholeNumberIssues({ quantity: 2.5 }, fields)).toEqual([
      {
        path: "quantity",
        code: "INVALID_TYPE",
        message: "Quantity must be a whole number.",
      },
    ]);
  });

  it("leaves a json field's bare fraction alone — the gate accepted it", () => {
    const fields: ValidatableField[] = [{ name: "payload", type: "json" }];
    expect(hookChangedWholeNumberIssues({ payload: 2.5 }, fields)).toEqual([]);
    expect(
      hookChangedWholeNumberIssues({ payload: { nested: 2.5 } }, fields)
    ).toEqual([]);
  });

  it("leaves a text field alone — the gate never judged its value as a number", () => {
    const fields: ValidatableField[] = [{ name: "bio", type: "text" }];
    expect(hookChangedWholeNumberIssues({ bio: 2.5 }, fields)).toEqual([]);
  });

  it("keeps a decimal field's fraction", () => {
    const fields: ValidatableField[] = [
      { name: "price", type: "number", dbType: "decimal" },
    ];
    expect(hookChangedWholeNumberIssues({ price: 2.5 }, fields)).toEqual([]);
  });

  it("keeps a float-format field's fraction", () => {
    const fields: ValidatableField[] = [
      { name: "ratio", type: "number", options: { format: "float" } },
    ];
    expect(hookChangedWholeNumberIssues({ ratio: 2.5 }, fields)).toEqual([]);
  });

  it("judges a named group's child where the row stores it", () => {
    const fields: ValidatableField[] = [
      {
        name: "meta",
        type: "group",
        fields: [{ name: "rating", type: "number", label: "Rating" }],
      },
    ];
    const issues = hookChangedWholeNumberIssues(
      { meta: { rating: 2.5 } },
      fields
    );
    expect(issues).toEqual([
      {
        path: "meta.rating",
        code: "INVALID_TYPE",
        message: "Rating must be a whole number.",
      },
    ]);
  });

  it("judges a child of an unnamed group, which stores it at its own level", () => {
    // An unnamed group is layout: the data side stores its child at the
    // level the group sits in, and the hook registry files the child's
    // rules under the same name, so the walk resolves the child there too —
    // a hook's fraction under it is judged, not dropped with the group.
    const fields: ValidatableField[] = [
      {
        type: "group",
        fields: [{ name: "quantity", type: "number", label: "Quantity" }],
      },
    ];
    const issues = hookChangedWholeNumberIssues({ quantity: 2.5 }, fields);
    expect(issues).toEqual([
      {
        path: "quantity",
        code: "INVALID_TYPE",
        message: "Quantity must be a whole number.",
      },
    ]);
  });

  it("skips an unnamed repeater whole — its children are stored per row, not at this level", () => {
    const fields: ValidatableField[] = [
      {
        type: "repeater",
        fields: [{ name: "quantity", type: "number" }],
      },
    ];
    expect(hookChangedWholeNumberIssues({ quantity: 2.5 }, fields)).toEqual([]);
  });

  it("judges a whole-number field inside a component a container stores, by the component's own fields", () => {
    const fields: ValidatableField[] = [
      { name: "banner", type: "component", component: "cta" },
    ];
    const componentFields: ValidatableField[] = [
      { name: "weight", type: "number", label: "Weight" },
    ];
    const issues = hookChangedWholeNumberIssues(
      { banner: { weight: 1.5 } },
      fields,
      "",
      slug => (slug === "cta" ? componentFields : undefined)
    );
    expect(issues).toEqual([
      {
        path: "banner.weight",
        code: "INVALID_TYPE",
        message: "Weight must be a whole number.",
      },
    ]);
  });

  it("leaves a component alone when no resolver is handed, as the gate left it unjudged", () => {
    const fields: ValidatableField[] = [
      { name: "banner", type: "component", component: "cta" },
    ];
    expect(
      hookChangedWholeNumberIssues({ banner: { weight: 1.5 } }, fields)
    ).toEqual([]);
  });
});
