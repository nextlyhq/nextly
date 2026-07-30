/**
 * What `validateFieldValues` promises to check, pinned so the contract and the
 * behaviour cannot drift apart again.
 */
import { describe, expect, it } from "vitest";

import { validateFieldValues } from "../validate-field-values";

describe("validateFieldValues scope", () => {
  it("walks a group's declared children", async () => {
    const issues = await validateFieldValues({ meta: {} }, [
      {
        name: "meta",
        type: "group",
        fields: [{ name: "title", type: "text", required: true }],
      },
    ]);

    expect(issues.some(i => i.path.includes("title"))).toBe(true);
  });

  it("walks a repeater's declared children", async () => {
    const issues = await validateFieldValues({ rows: [{}] }, [
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "label", type: "text", required: true }],
      },
    ]);

    expect(issues.some(i => i.path.includes("label"))).toBe(true);
  });

  it("does not descend into a component declaration", async () => {
    // Its rows are written and checked by FieldGroupDataService, against the
    // stored schema rather than a declaration handed in here. Pinned so the
    // documented contract stays honest about what this API does not do.
    const issues = await validateFieldValues({ card: {} }, [
      {
        name: "card",
        type: "component",
        fields: [{ name: "title", type: "text", required: true }],
      },
    ]);

    expect(issues).toEqual([]);
  });

  it("refuses a declaration whose type nothing knows", async () => {
    // The internal validator assumes its declarations were already
    // config-validated, so an unknown token reaches its default branch and any
    // value passes. A caller writing declarations by hand has had nothing check
    // them, so a typo would read as a clean pass.
    const issues = await validateFieldValues({ score: "anything" }, [
      { name: "score", type: "numbre" },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("score");
  });

  it("refuses an unknown type nested in a container", async () => {
    // The validator descends into a repeater, so a misspelled child reached its
    // default branch and reported arbitrary nested values as valid — the same
    // hole the top-level check closed.
    const issues = await validateFieldValues({ rows: [{ n: 1 }] }, [
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "n", type: "numbre" }],
      },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("n");
  });

  it("does not descend into an option a plugin type calls fields", async () => {
    // Only the containers the validator itself walks. A plugin type's own
    // `fields` option is configuration, not declarations.
    const issues = await validateFieldValues({ layout: {} }, [
      {
        name: "layout",
        type: "json",
        fields: [{ name: "slot", type: "not-a-type" }],
      },
    ]);

    expect(issues).toEqual([]);
  });
});
