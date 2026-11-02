/**
 * A component instance judged as it goes live is judged as stored: without
 * defaults it never had, with its own value as the document a field type
 * compares against, and, outside a language whose component rules apply, not
 * at all where it sits inside a group.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { validateEntryData, type ValidatableField } from "../entry-validation";

afterEach(() => {
  clearFieldTypes();
});

const hero = { name: "hero", type: "component", component: "hero" };

function judge(
  data: Record<string, unknown>,
  fields: ValidatableField[],
  componentFields: ValidatableField[],
  options: Record<string, unknown>
) {
  return validateEntryData(data, fields, {
    mode: "update",
    componentFields: slug => (slug === "hero" ? componentFields : undefined),
    ...options,
  });
}

describe("a stored component instance going live", () => {
  it("is refused for a required field it never stored, whatever that field's default", async () => {
    const issues = await judge(
      { hero: { heading: "Saved" } },
      [hero as ValidatableField],
      [
        { name: "heading", type: "text" },
        { name: "code", type: "text", required: true, defaultValue: "added" },
      ] as ValidatableField[],
      { judgeComponentInstances: true }
    );

    expect(issues).toEqual([
      expect.objectContaining({ path: "hero.code", code: "REQUIRED" }),
    ]);
  });

  it("keeps the defaults a component inside a group was judged with when written", async () => {
    // A component held in a group is stored as sent: its write fills
    // defaults only to judge it, so they stand in when judged again.
    const issues = await judge(
      { box: { hero: { heading: "Saved" } } },
      [{ name: "box", type: "group", fields: [hero] }] as ValidatableField[],
      [
        { name: "heading", type: "text" },
        { name: "code", type: "text", required: true, defaultValue: "kept" },
      ] as ValidatableField[],
      { judgeComponentInstances: true }
    );

    expect(issues).toEqual([]);
  });

  it("judges a component placed directly in one held in a group, which is stored with it", async () => {
    const card = { name: "card", type: "component", component: "card" };
    const issues = await validateEntryData(
      { box: { hero: { heading: "Saved" } } },
      [{ name: "box", type: "group", fields: [hero] }] as ValidatableField[],
      {
        mode: "update",
        judgeComponentInstances: true,
        componentFields: slug =>
          slug === "hero"
            ? ([
                { name: "heading", type: "text" },
                { ...card, required: true },
              ] as ValidatableField[])
            : slug === "card"
              ? ([{ name: "label", type: "text" }] as ValidatableField[])
              : undefined,
      }
    );

    expect(issues).toEqual([
      expect.objectContaining({ path: "box.hero.card", code: "REQUIRED" }),
    ]);
  });

  it("hands a field type's validator no entry write, as the component's own pass does", async () => {
    registerFieldType({
      type: "standalone",
      storage: "json",
      component: "@acme/standalone/admin#StandaloneInput",
      validate: (_value, args) =>
        args.write === undefined || "judged with the entry's write",
    });

    const issues = await judge(
      { hero: { heading: "Saved", alone: {} } },
      [hero] as ValidatableField[],
      [
        { name: "heading", type: "text" },
        { name: "alone", type: "standalone" },
      ] as ValidatableField[],
      {
        judgeComponentInstances: true,
        write: {
          kind: "collection",
          slug: "pages",
          id: "p1",
          inTransaction: false,
          readStored: () => Promise.resolve({ kind: "absent" as const }),
        },
      }
    );

    expect(issues).toEqual([]);
  });

  it("hands a field type's validator the instance as the document it compares with", async () => {
    registerFieldType({
      type: "matching",
      storage: "json",
      component: "@acme/match/admin#MatchInput",
      validate: (_value, args) =>
        (args.data as { heading?: unknown }).heading === "Saved" ||
        "the heading beside it is not the one it matches",
    });

    const issues = await judge(
      { title: "Page", hero: { heading: "Saved", match: {} } },
      [{ name: "title", type: "text" }, hero] as ValidatableField[],
      [
        { name: "heading", type: "text" },
        { name: "match", type: "matching" },
      ] as ValidatableField[],
      { judgeComponentInstances: true }
    );

    expect(issues).toEqual([]);
  });

  it("leaves a component held in a group unjudged where component rules do not apply", async () => {
    const boxed = [
      { name: "box", type: "group", fields: [hero] },
    ] as ValidatableField[];
    const strict = [
      { name: "heading", type: "text", required: true },
    ] as ValidatableField[];
    const data = { box: { hero: { heading: "" } } };

    expect(
      await judge(data, boxed, strict, { judgeContainedComponents: false })
    ).toEqual([]);
    // CONTROL: an ordinary write judges it.
    expect(await judge(data, boxed, strict, {})).toEqual([
      expect.objectContaining({ path: "box.hero.heading", code: "REQUIRED" }),
    ]);
  });
});
