/**
 * The field settings the schema hash omits, as the registry services compare
 * a declared field list with a stored one. Each side is read as a snapshot
 * records it, so the declaration, the row a start stores from it and the row
 * `nextly migrate` writes from its snapshot all compare equal, and a real
 * change in any of these settings does not.
 */
import { describe, expect, it } from "vitest";

import { fieldSettingsChanged } from "../services/collection-registry-service";

describe("fieldSettingsChanged", () => {
  it("sees a help text, placeholder or hidden switch change", () => {
    const stored = [
      { name: "title", type: "text", admin: { placeholder: "A" } },
    ];
    expect(
      fieldSettingsChanged(
        [{ name: "title", type: "text", admin: { placeholder: "B" } }],
        stored
      )
    ).toBe(true);
    expect(
      fieldSettingsChanged(
        [
          {
            name: "title",
            type: "text",
            admin: { placeholder: "A", hidden: true },
          },
        ],
        stored
      )
    ).toBe(true);
  });

  // The hash leaves `components` out, yet a component field's allow-list is
  // stored with it and decides what an editor may pick.
  it("sees a component field's allowed components change", () => {
    expect(
      fieldSettingsChanged(
        [{ name: "body", type: "component", components: ["hero", "cta"] }],
        [{ name: "body", type: "component", components: ["hero"] }]
      )
    ).toBe(true);
  });

  // Singles and field groups compare no default otherwise.
  it("sees a declared default change, and not a computed one", () => {
    expect(
      fieldSettingsChanged(
        [{ name: "views", type: "number", defaultValue: 1 }],
        [{ name: "views", type: "number", defaultValue: 0 }]
      )
    ).toBe(true);
    expect(
      fieldSettingsChanged(
        [{ name: "views", type: "number", defaultValue: () => 1 }],
        [{ name: "views", type: "number" }]
      )
    ).toBe(false);
  });

  it("sees a nested field's setting change", () => {
    const group = (description: string) => [
      {
        name: "cta",
        type: "group",
        fields: [{ name: "label", type: "text", admin: { description } }],
      },
    ];
    expect(fieldSettingsChanged(group("New"), group("Old"))).toBe(true);
  });

  // An admin block holding only functions is stored as `{}` by a start and
  // left out of a snapshot: neither is a setting, so neither is a change.
  // Read naively, the two writers would undo each other's row on every run.
  it("reads functions, an emptied object and an absent one alike", () => {
    const declared = [
      { name: "title", type: "text", admin: { condition: () => true } },
    ];
    expect(
      fieldSettingsChanged(declared, [
        { name: "title", type: "text", admin: {} },
      ])
    ).toBe(false);
    expect(
      fieldSettingsChanged(declared, [{ name: "title", type: "text" }])
    ).toBe(false);
    expect(
      fieldSettingsChanged(
        [{ name: "title", type: "text", admin: { description: undefined } }],
        [{ name: "title", type: "text" }]
      )
    ).toBe(false);
  });

  it("does not read key order as a change", () => {
    expect(
      fieldSettingsChanged(
        [{ name: "t", type: "text", admin: { a: 1, b: 2 } }],
        [{ name: "t", type: "text", admin: { b: 2, a: 1 } }]
      )
    ).toBe(false);
  });
});
