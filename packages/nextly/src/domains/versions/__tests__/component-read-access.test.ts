/**
 * Component read rules in history: which instances are judged, and which
 * top-level fields carry a rule when the rules cannot be evaluated.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import {
  applyComponentReadAccess,
  fieldsCarryingReadRules,
} from "../component-read-access";

afterEach(() => clearFieldFunctions());

const denied = { read: () => false };

function fields(...defs: Record<string, unknown>[]): FieldConfig[] {
  return defs as unknown as FieldConfig[];
}

const caller = {
  user: { id: "reader" },
  grants: () => Promise.resolve({ permissions: [], roles: [] }),
};

describe("applyComponentReadAccess", () => {
  it("judges a dynamic-zone block under either type key", async () => {
    registerFieldFunctions("fieldGroup", "card", [
      { name: "title", type: "text" },
      { name: "secret", type: "text", access: denied },
    ]);
    const entry = {
      blocks: [
        { _componentType: "card", title: "a", secret: "S-1" },
        // The spelling a migrated definition stores.
        { _fieldGroupType: "card", title: "b", secret: "S-2" },
      ],
    };

    await applyComponentReadAccess(
      entry,
      fields({ name: "blocks", type: "component", components: ["card"] }),
      new Map(),
      caller
    );

    expect(JSON.stringify(entry)).not.toMatch(/S-\d/);
    expect(JSON.stringify(entry)).toContain('"b"');
  });
});

describe("fieldsCarryingReadRules", () => {
  it("finds a rule in a component nested in another component's group", () => {
    registerFieldFunctions("fieldGroup", "inner", [
      { name: "secret", type: "text", access: denied },
    ]);
    const components = new Map<string, FieldConfig[]>([
      [
        "outer",
        fields({
          name: "box",
          type: "group",
          fields: [{ name: "inside", type: "component", component: "inner" }],
        }),
      ],
      ["inner", fields({ name: "secret", type: "text" })],
    ]);

    expect(
      fieldsCarryingReadRules(
        "collection",
        fields(
          { name: "title", type: "text" },
          { name: "hero", type: "component", component: "outer" }
        ),
        components,
        "posts"
      )
    ).toEqual(["hero"]);
  });

  it("finds a rule in a component held by the entity's own group", () => {
    registerFieldFunctions("fieldGroup", "inner", [
      { name: "secret", type: "text", access: denied },
    ]);
    const components = new Map<string, FieldConfig[]>([
      ["inner", fields({ name: "secret", type: "text" })],
    ]);

    expect(
      fieldsCarryingReadRules(
        "collection",
        fields(
          { name: "title", type: "text" },
          {
            name: "meta",
            type: "group",
            fields: [{ name: "card", type: "component", component: "inner" }],
          }
        ),
        components,
        "posts"
      )
    ).toEqual(["meta"]);
  });
});
