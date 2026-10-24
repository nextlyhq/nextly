/**
 * The document-level field-group pass a promotion and a held draft run: which
 * operation each instance is judged by.
 *
 * An instance in its own table that the live document does not hold is new,
 * so the save will create it, and the field groups held inline inside it are
 * created with it: the pass must ask them the create question the save asks.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import { applyFieldGroupWriteAccessToDocument } from "../field-group-write-access";

afterEach(() => clearFieldFunctions());

function fields(...defs: Record<string, unknown>[]): FieldConfig[] {
  return defs as unknown as FieldConfig[];
}

const CHECKED = {
  overrideAccess: false,
  user: { id: "u1" },
  grants: () => Promise.resolve({ permissions: [], roles: [] }),
};

describe("applyFieldGroupWriteAccessToDocument", () => {
  it("judges a field group held inline in a new instance as created", async () => {
    // `secret` may be changed by any update but set by no create.
    registerFieldFunctions("fieldGroup", "innerx", [
      { name: "secret", access: { create: () => false } },
    ]);
    const schemas = new Map<string, readonly FieldConfig[]>([
      [
        "outerx",
        fields(
          { name: "heading", type: "text" },
          {
            name: "box",
            type: "group",
            fields: [{ name: "inner", type: "component", component: "innerx" }],
          }
        ),
      ],
      ["innerx", fields({ name: "secret", type: "text" })],
    ]);
    const document: Record<string, unknown> = {
      one: { heading: "h", box: { inner: { secret: "S" } } },
    };

    await applyFieldGroupWriteAccessToDocument({
      document,
      fields: fields({ name: "one", type: "component", component: "outerx" }),
      fieldGroupFields: schemas,
      access: CHECKED,
      // Live holds no instance, so `one` is new.
      live: {},
    });

    expect(document).toEqual({ one: { heading: "h", box: { inner: {} } } });
  });

  it("does not take an instance in one field for one stored in another", async () => {
    // Fields `a` and `b` hold the same field group. A new instance in `b`
    // sent with the id of `a`'s stored instance is still new: the save looks
    // for it among `b`'s own rows, finds none, and creates it.
    registerFieldFunctions("fieldGroup", "notey", [
      { name: "secret", access: { create: () => false } },
    ]);
    const schemas = new Map<string, readonly FieldConfig[]>([
      ["notey", fields({ name: "secret", type: "text" })],
    ]);
    const list = (name: string) => ({
      name,
      type: "component",
      component: "notey",
      repeatable: true,
    });
    const document: Record<string, unknown> = {
      a: [],
      b: [{ id: "x-1", secret: "S" }],
    };

    await applyFieldGroupWriteAccessToDocument({
      document,
      fields: fields(list("a"), list("b")),
      fieldGroupFields: schemas,
      access: CHECKED,
      live: { a: [{ id: "x-1", secret: "stored" }], b: [] },
    });

    expect(document.b).toEqual([{ id: "x-1" }]);
  });
});
