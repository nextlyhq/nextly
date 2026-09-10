/**
 * An API key's scope is built in ONE place, and the boundary is a lint rule.
 *
 * `AuthenticatedScope` carries the caller's grants twice over: `permissions` in the
 * spelling the database stores, and the rows every rule-facing spelling is DERIVED
 * from. A literal naming only `actorType` and `permissions` compiles clean — the
 * other fields are optional — and produces a scope that passes the coarse grant
 * check and then denies every documented
 * `({ permissions }) => permissions.includes("posts:read")` behind it.
 *
 * Nine such literals existed across the request paths, the last written weeks after
 * the first by someone who had read the file.
 *
 * ## Why this file no longer scans the source
 *
 * It used to, with a regex, and review found three spellings that walked past it:
 * `permissions` before `actorType`, the shorthand `{ actorType, permissions }`, and
 * any nested object between the two keys. A guard asserting "this is the only place
 * a scope is constructed" while three forms evade it is worse than no guard, because
 * the next reader takes the green as coverage.
 *
 * `eslint-api-key-scope-rule.js` reads the AST instead, where all three are one node
 * shape: `:has()` is order-independent, a shorthand property still carries
 * `key.name`, and a nested object is a different `ObjectExpression` the selector does
 * not match. What follows tests THAT — the guard, on inputs whose answers are known,
 * rather than the tree it guards.
 *
 * @module auth/__tests__/api-key-scope-seam.test
 */
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import {
  API_KEY_SCOPE_MESSAGE,
  API_KEY_SCOPE_SELECTOR,
} from "../../../eslint-api-key-scope-rule.js";

const linter = new Linter();

/** How many times the rule fires on a snippet. */
function violations(code: string): number {
  return linter.verify(code, {
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: API_KEY_SCOPE_SELECTOR, message: API_KEY_SCOPE_MESSAGE },
      ],
    },
  }).length;
}

describe("the API-key scope boundary", () => {
  it("rejects the literal every real instance took", () => {
    expect(
      violations(
        'const s = { actorType: "apiKey", permissions: auth.permissions };'
      )
    ).toBe(1);
  });

  // The three the regex missed. Each is asserted on its own rather than in a loop,
  // so a failure names which spelling regressed instead of a count.
  it("rejects it with the keys in the other order", () => {
    expect(
      violations(
        'const s = { permissions: auth.permissions, actorType: "apiKey" };'
      )
    ).toBe(1);
  });

  it("rejects the shorthand form", () => {
    expect(violations("const s = { actorType, permissions };")).toBe(1);
  });

  it("rejects it with a nested object between the keys", () => {
    expect(
      violations(
        'const s = { actorType: "apiKey", meta: { k: 1 }, permissions: p };'
      )
    ).toBe(1);
  });

  // The negative half. A rule that fired on everything would pass every assertion
  // above while making the package unlintable, and these two shapes are the ones
  // that share a field name with a scope and are not one.
  it("leaves the webhook outbox actor alone", () => {
    expect(
      violations(
        "const row = { actorType: envelope.actor.type, actorId: envelope.id };"
      )
    ).toBe(0);
  });

  it("leaves an access-control context alone", () => {
    expect(
      violations(
        "const ctx = { permissions: p, roles: r, operation: op, collection: c };"
      )
    ).toBe(0);
  });

  it("names the constructor to use, so the message is actionable", () => {
    // The remedy is the part a reader acts on, and the previous guard's message
    // recommended a token that silenced it without changing anything.
    expect(API_KEY_SCOPE_MESSAGE).toContain("apiKeyScopeFrom");
    expect(API_KEY_SCOPE_MESSAGE).toContain("narrowScope");
  });
});
