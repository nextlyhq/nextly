import { describe, expect, it } from "vitest";

import { effectiveStatus, validationRequest } from "../effective-status";

describe("effectiveStatus", () => {
  it("takes the status the write names", () => {
    expect(effectiveStatus({ status: "published" }, { status: "draft" })).toBe(
      "published"
    );
  });

  it("inherits the stored status when the write names none", () => {
    // The case the whole helper exists for: editing a live entry without
    // mentioning status is still a write to published content.
    expect(effectiveStatus({ title: "edited" }, { status: "published" })).toBe(
      "published"
    );
  });

  it("resolves nothing when neither side has one", () => {
    expect(effectiveStatus({ title: "new" }, undefined)).toBeUndefined();
  });

  it("ignores an explicit undefined status the write carries", () => {
    // A hook can reintroduce `status: undefined`, which names no change. Read
    // as a status it would judge the write against a value the row never holds.
    expect(
      effectiveStatus({ status: undefined }, { status: "published" })
    ).toBe("published");
  });

  it("ignores a non-string status on either side", () => {
    expect(effectiveStatus({ status: 3 }, { status: null })).toBeUndefined();
  });
});

describe("validationRequest", () => {
  it("omits both keys rather than setting them undefined", () => {
    // Absence is what tells a field type that no status was forwarded, which is
    // how untouched call sites keep their existing behaviour.
    expect(validationRequest(undefined, undefined)).toEqual({});
  });

  it("carries the user and the status when both are present", () => {
    const user = { id: "u1" };
    expect(validationRequest(user, "published")).toEqual({
      user,
      status: "published",
    });
  });

  it("carries a status with no user", () => {
    expect(validationRequest(undefined, "draft")).toEqual({ status: "draft" });
  });
});
