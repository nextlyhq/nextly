/**
 * The access-bearing fields must travel together, at every namespace operation.
 *
 * A service handed `user` without `authenticatedScope` resolves a scoped API
 * key's permissions from its OWNER, so an update-only key issued by someone who
 * can read is allowed to read. Spreading `accessOptions(config)` keeps the two
 * inseparable; writing them inline is what let three of thirteen operations
 * carry the scope while the rest silently authorized the key as its owner.
 *
 * TypeScript cannot catch the regression: a spread into an object literal is
 * exempt from excess-property checking, and an omitted optional field is not an
 * error either, so both directions of this mistake compile clean.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const NAMESPACE_DIR = join(__dirname, "..", "namespaces");

/**
 * `helpers.ts` sits in this directory but exposes no operations — it is where
 * `accessOptions` reads the config fields, and so the one place the inline pair
 * is the definition rather than a bypass of it.
 */
const SEAM_DEFINITION = "helpers.ts";

function namespaceSources(): { name: string; text: string }[] {
  return readdirSync(NAMESPACE_DIR)
    .filter(
      name =>
        name.endsWith(".ts") &&
        !name.endsWith(".test.ts") &&
        name !== SEAM_DEFINITION
    )
    .map(name => ({
      name,
      text: readFileSync(join(NAMESPACE_DIR, name), "utf8"),
    }));
}

describe("the Direct API access seam", () => {
  it("is exercised — there are namespace sources to scan", () => {
    // Without this the two assertions below pass against an empty list, which
    // is the shape of a guard that reports success because it found nothing.
    const sources = namespaceSources();
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.map(s => s.name)).toContain("collections.ts");
  });

  it("is the only way a namespace forwards the caller's identity", () => {
    const offenders = namespaceSources()
      .filter(({ text }) => /\buser:\s*config\.user\b/.test(text))
      .map(({ name }) => name);

    expect(
      offenders,
      "these namespaces forward `user` inline, so a scoped API key reaches the " +
        "service without its own grants and is judged by its owner's. Spread " +
        "`accessOptions(config)` instead."
    ).toEqual([]);
  });

  it("is the only way a namespace forwards the caller's scope onward", () => {
    // The nested-call direction. One namespace operation calling another must
    // hand over `actor` through `callerAccess`, because a nested call that omits
    // it re-enters `mergeConfig` and inherits `overrideAccess: true` from the
    // instance defaults — discarding the caller's restrictions rather than
    // keeping them.
    const offenders = namespaceSources()
      .filter(({ text }) => /\bactor:\s*config\.actor\b/.test(text))
      .map(({ name }) => name);

    expect(
      offenders,
      "these namespaces forward `actor` inline to a nested Direct API call; " +
        "spread `callerAccess(config)` so the whole caller identity travels."
    ).toEqual([]);
  });

  it("is the only way a namespace forwards the access override", () => {
    const offenders = namespaceSources()
      .filter(({ text }) =>
        /\boverrideAccess:\s*config\.overrideAccess\b/.test(text)
      )
      .map(({ name }) => name);

    expect(
      offenders,
      "these namespaces forward `overrideAccess` inline; it belongs with the " +
        "identity fields in `accessOptions(config)` so the three cannot drift."
    ).toEqual([]);
  });
});
