/**
 * How the handlers find Next's `unstable_rethrow`: from `next/navigation` when
 * it loads, from the errors' digests only when a module it needs is missing
 * from a traced bundle, and never by hiding any other failure.
 */
import { describe, expect, it } from "vitest";

import { unstableRethrowFrom } from "../next-runtime";

/** Node's error for a module that is not there, as a traced bundle throws it. */
function missingModule(specifier: string): Error {
  return Object.assign(new Error(`Cannot find module '${specifier}'`), {
    code: "MODULE_NOT_FOUND",
  });
}

describe("finding unstable_rethrow", () => {
  it("uses Next's own when next/navigation loads", () => {
    const own = () => undefined;
    expect(unstableRethrowFrom(() => ({ unstable_rethrow: own }))).toBe(own);
  });

  it("checks the digests itself when a module next/navigation needs is missing", () => {
    const rethrow = unstableRethrowFrom(() => {
      throw missingModule("next/dist/client/components/unstable-rethrow");
    });
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    expect(() => rethrow(redirect)).toThrow(redirect);
    expect(() => rethrow(new Error("an ordinary failure"))).not.toThrow();
  });

  it("rethrows any other failure to load it rather than falling back", () => {
    const broken = new SyntaxError("Unexpected token");
    expect(() =>
      unstableRethrowFrom(() => {
        throw broken;
      })
    ).toThrow(broken);
  });

  it("refuses a next/navigation without it, naming the supported range", () => {
    expect(() => unstableRethrowFrom(() => ({}))).toThrow(
      expect.objectContaining({ code: "CONFIGURATION_ERROR" })
    );
  });
});
