import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { Nextly, nextly } from "../nextly";

// The namespace was renamed rather than aliased, so an untyped caller upgrading
// from `nextly.components` must be told what to rename instead of hitting a
// TypeError on an undefined property. Both entry points are covered because a
// caller can reach field groups through either one.
describe("the pre-rename field groups namespace", () => {
  it("rejects instance access with the rename instruction", () => {
    const instance = new Nextly();

    expect(
      () => (instance as unknown as { components: unknown }).components
    ).toThrowError(NextlyError);
    expect(
      () => (instance as unknown as { components: unknown }).components
    ).toThrowError(/'nextly\.components' is now 'nextly\.fieldGroups'/);
  });

  it("rejects facade access with the rename instruction", () => {
    expect(
      () => (nextly as unknown as { components: unknown }).components
    ).toThrowError(/'nextly\.components' is now 'nextly\.fieldGroups'/);
  });

  it("serves field groups under the current name", () => {
    const instance = new Nextly();

    expect(typeof instance.fieldGroups.find).toBe("function");
    expect(typeof nextly.fieldGroups.find).toBe("function");
  });

  // The accessor is non-enumerable so that merely copying either surface does
  // not trigger it; a throwing enumerable property would break every spread.
  it("stays invisible to enumeration and copying", () => {
    const instance = new Nextly();

    expect(Object.keys(nextly)).not.toContain("components");
    expect(() => ({ ...nextly })).not.toThrow();
    expect(() => ({ ...instance })).not.toThrow();
    expect(() => JSON.stringify(nextly)).not.toThrow();
  });
});
