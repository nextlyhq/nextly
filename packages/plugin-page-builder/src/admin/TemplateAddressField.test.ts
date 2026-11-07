/**
 * When the template form offers the address for editing: only once the
 * server has said the caller holds the routing permission. An address
 * offered to anyone else would look saved and be dropped by the field's
 * rules, so every other state draws it read-only and says why.
 */
import { describe, expect, it } from "vitest";

import { addressFieldView } from "./TemplateAddressField";

describe("the template address control", () => {
  it("is editable for a caller holding the routing permission", () => {
    expect(
      addressFieldView({}, { state: "answered", mayManageRouting: true })
    ).toEqual({ editable: true, note: null, locked: false });
  });

  it("is read-only, saying why, for a caller without it", () => {
    const view = addressFieldView(
      {},
      { state: "answered", mayManageRouting: false }
    );
    expect(view.editable).toBe(false);
    expect(view.locked).toBe(true);
    expect(view.note).toMatch(/manage template routing/);
  });

  it("is read-only while the answer is coming, and when it failed", () => {
    expect(addressFieldView({}, { state: "pending" }).editable).toBe(false);
    const failed = addressFieldView({}, { state: "failed" });
    expect(failed.editable).toBe(false);
    expect(failed.note).toMatch(/Couldn't check/);
  });

  it("is read-only in a version being read, whatever the caller holds", () => {
    expect(
      addressFieldView(
        { readOnly: true },
        { state: "answered", mayManageRouting: true }
      ).editable
    ).toBe(false);
    expect(
      addressFieldView(
        { disabled: true },
        { state: "answered", mayManageRouting: true }
      ).editable
    ).toBe(false);
  });
});
