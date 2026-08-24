/**
 * The framework-filter exemption must never be something a caller inherits.
 *
 * `frameworkFilter` says "this `where` was built by the framework, not sent by
 * a request", and it exempts the filter from the guard that stops a caller
 * bisecting a field it may not read. That is only sound while it is stated per
 * operation.
 *
 * `mergeConfig` fills anything a nested Direct API call omits from the instance
 * defaults -- the hazard `namespaces/helpers.ts` documents for `overrideAccess`
 * and `trusted`. If this flag could travel that way, a caller-supplied `where`
 * reaching a nested read would acquire the framework's trust and the guard
 * would be bypassed by inheritance rather than by decision.
 *
 * Read from the SOURCE rather than exercised through a call: the property is
 * "no config-shaped path can carry it", and a runtime test can only show that
 * the paths it happened to exercise did not.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8");
}

describe("frameworkFilter is not inheritable", () => {
  it("is absent from the shared config type", () => {
    // `DirectAPIConfig` is what `mergeConfig` fills from instance defaults, so
    // a field declared there is a field a nested call can be handed.
    expect(read("types", "shared.ts")).not.toContain("frameworkFilter");
  });

  it("is absent from the helpers that forward access between operations", () => {
    // `accessOptions` and `callerAccess` exist to keep access-bearing fields
    // travelling together. This one must NOT travel: it belongs to a single
    // call, not to a caller's identity or trust.
    expect(read("namespaces", "helpers.ts")).not.toContain("frameworkFilter");
  });

  it("is declared only on the per-operation argument types", () => {
    // Present where a call site states it, so the guarantee is that it exists
    // AND is confined -- an assertion that only checked absence would pass if
    // the field were deleted entirely.
    const args = read("types", "collections.ts");
    expect(args).toContain("frameworkFilter?: true;");
    expect(args.match(/frameworkFilter\?: true;/g)).toHaveLength(2);
  });
});
