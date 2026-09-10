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
 * The selector in `eslint-api-key-scope-rule.js` reads the AST instead, where all
 * three are one node shape: `:has()` is order-independent, a shorthand property
 * still carries `key.name`, and a nested object is a different `ObjectExpression`
 * the selector does not match.
 *
 * What follows lints through the package's REAL configuration rather than
 * re-declaring the selector here. Re-declaring it would prove a string matches a
 * string while the rule sat unmounted — which is precisely what happened once:
 * mounted in its own config block, it replaced the bare-Error selector instead of
 * joining it, because ESLint merges `no-restricted-syntax` by rule name.
 *
 * @module auth/__tests__/api-key-scope-seam.test
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

/**
 * A real production file the rule covers, so the linted text is parsed by the
 * TypeScript project the same way its neighbours are.
 */
const SUBJECT = join(packageRoot, "src", "plugins", "routes", "dispatch.ts");

/** How many times the scope rule fires on `source`, through the package's own config. */
async function scopeViolations(source: string): Promise<number> {
  const [result] = await new ESLint({ cwd: packageRoot }).lintText(source, {
    filePath: SUBJECT,
  });
  return (result?.messages ?? []).filter(
    m =>
      m.ruleId === "no-restricted-syntax" &&
      (m.message ?? "").includes("apiKeyScopeFrom")
  ).length;
}

describe("the API-key scope boundary", () => {
  it("is mounted at all — the rule reaches this package's source", async () => {
    // Without this, every rejection below is equally consistent with a rule that
    // was never configured: an unmounted rule reports nothing, and "nothing" is
    // what a passing negative control looks like too.
    expect(
      await scopeViolations(
        'const s = { actorType: "apiKey", permissions: auth.permissions };'
      )
    ).toBe(1);
  });

  // The three the regex missed. Asserted one at a time so a failure names the
  // spelling that regressed rather than a count.
  it("rejects it with the keys in the other order", async () => {
    expect(
      await scopeViolations(
        'const s = { permissions: auth.permissions, actorType: "apiKey" };'
      )
    ).toBe(1);
  });

  it("rejects the shorthand form", async () => {
    expect(await scopeViolations("const s = { actorType, permissions };")).toBe(
      1
    );
  });

  it("rejects it with a nested object between the keys", async () => {
    expect(
      await scopeViolations(
        'const s = { actorType: "apiKey", meta: { k: 1 }, permissions: p };'
      )
    ).toBe(1);
  });

  // The negative half. A rule that fired on everything would satisfy every
  // rejection above while making the package unlintable, and these are the two
  // shapes that carry one of the field names and are not scopes.
  it("leaves the webhook outbox actor alone", async () => {
    expect(
      await scopeViolations(
        "const row = { actorType: envelope.actor.type, actorId: envelope.id };"
      )
    ).toBe(0);
  });

  it("leaves an access-control context alone", async () => {
    expect(
      await scopeViolations(
        "const ctx = { permissions: p, roles: r, operation: op, collection: c };"
      )
    ).toBe(0);
  });
});
