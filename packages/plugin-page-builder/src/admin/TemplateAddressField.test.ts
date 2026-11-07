/**
 * When the template form offers the address for editing: only once the
 * server has said the caller holds the routing permission. An address
 * offered to anyone else would look saved and be dropped by the field's
 * rules, so every other state draws it read-only and says why.
 */
import { describe, expect, it } from "vitest";

import { addressFieldView, routingAnswerOf } from "./TemplateAddressField";

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
    // Unexplained while pending, so no note appears and then goes.
    expect(addressFieldView({}, { state: "pending" })).toEqual({
      editable: false,
      note: null,
      locked: false,
    });
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

describe("the routing answer the control acts on", () => {
  it("is only a fresh one: a cached yes being refreshed is pending", () => {
    expect(
      routingAnswerOf({
        data: { mayManageRouting: true },
        error: null,
        fetching: true,
      })
    ).toEqual({ state: "pending" });
  });

  it("is a failure when the refresh failed, whatever was cached", () => {
    expect(
      routingAnswerOf({
        data: { mayManageRouting: true },
        error: new Error("offline"),
        fetching: false,
      })
    ).toEqual({ state: "failed" });
  });

  it("is the server's answer once it has come back", () => {
    expect(
      routingAnswerOf({
        data: { mayManageRouting: false },
        error: null,
        fetching: false,
      })
    ).toEqual({ state: "answered", mayManageRouting: false });
  });
});
