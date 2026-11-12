/**
 * The "signed in here" record: one key under the admin's storage prefix, set,
 * read and removed, and every access guarded, since a private window or
 * blocked site data makes storage throw rather than return nothing.
 *
 * Its value is the only thing read, so the separating property for a read is
 * the KEY and the value together: a stray value under the key is not a
 * record, and nothing under another key is either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetSignedInHere,
  hasSignedInHere,
  rememberSignedInHere,
  SIGNED_IN_HERE_KEY,
} from "../signed-in-here";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the signed-in-here record", () => {
  it("is kept under the admin's own storage prefix", () => {
    expect(SIGNED_IN_HERE_KEY.startsWith("nextly:admin:")).toBe(true);
  });

  it("is absent in a browser that never signed in here", () => {
    expect(hasSignedInHere()).toBe(false);
  });

  it("is present once remembered, and absent again once forgotten", () => {
    rememberSignedInHere();
    expect(window.localStorage.getItem(SIGNED_IN_HERE_KEY)).toBe("1");
    expect(hasSignedInHere()).toBe(true);

    forgetSignedInHere();
    expect(window.localStorage.getItem(SIGNED_IN_HERE_KEY)).toBeNull();
    expect(hasSignedInHere()).toBe(false);
  });

  it("reads only its own value as a record", () => {
    window.localStorage.setItem(SIGNED_IN_HERE_KEY, "true");
    expect(hasSignedInHere()).toBe(false);
    window.localStorage.clear();
    window.localStorage.setItem("nextly:admin:other", "1");
    expect(hasSignedInHere()).toBe(false);
  });

  it("reads storage that throws as no record, and never throws itself", () => {
    const refused = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refused);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refused);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(refused);

    expect(() => rememberSignedInHere()).not.toThrow();
    expect(hasSignedInHere()).toBe(false);
    expect(() => forgetSignedInHere()).not.toThrow();
  });
});
