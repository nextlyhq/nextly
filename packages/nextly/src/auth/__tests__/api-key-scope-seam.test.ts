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
 * ## Why this file does not scan the source
 *
 * A regex over the source cannot refuse the shape. Three spellings walk past a
 * pattern written for one: `permissions` before `actorType`, the shorthand
 * `{ actorType, permissions }`, and any nested object between the two keys. A guard
 * asserting "this is the only place a scope is constructed" while three forms evade
 * it is worse than no guard, because the next reader takes the green as coverage.
 *
 * The selector in `eslint-api-key-scope-rule.js` reads the AST instead, where all
 * three are one node shape: `:has()` is order-independent, a shorthand property
 * still carries `key.name`, and a nested object is a different `ObjectExpression`
 * the selector does not match.
 *
 * What follows lints through the package's REAL configuration rather than
 * re-declaring the selector here. A re-declared selector proves that a string
 * matches a string, and stays green while the rule sits unmounted — which is the
 * state a second config block naming `no-restricted-syntax` produces, since ESLint
 * merges that rule by name and the later block wins outright.
 *
 * @module auth/__tests__/api-key-scope-seam.test
 */
import { readFileSync } from "node:fs";
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

/**
 * How many times a `no-restricted-syntax` selector whose message contains `naming` fires on
 * `source`, linted at `filePath` through the package's own config.
 *
 * The message identifies WHICH selector reported, because both ride in one rule entry and
 * `ruleId` is the same string for either.
 */
async function violations(
  filePath: string,
  source: string,
  naming: string
): Promise<number> {
  const [result] = await new ESLint({ cwd: packageRoot }).lintText(source, {
    filePath,
  });
  const messages = result?.messages ?? [];
  // A parse failure arrives as a fatal message with a null ruleId, and would otherwise read as
  // "the selector did not fire" — the same answer a working exemption gives.
  const fatal = messages.find(message => message.fatal);
  if (fatal) {
    throw new TypeError(`${filePath} failed to parse: ${fatal.message}`);
  }
  return messages.filter(
    m =>
      m.ruleId === "no-restricted-syntax" && (m.message ?? "").includes(naming)
  ).length;
}

/** How many times the scope rule fires on `source`, at a file the rule covers. */
async function scopeViolations(source: string): Promise<number> {
  return violations(SUBJECT, source, "apiKeyScopeFrom");
}

/** The file where a scope literal IS the definition, and so is exempt from the scope selector. */
const SCOPE_DEFINITION = join(
  packageRoot,
  "src",
  "auth",
  "authenticated-scope.ts"
);

/** A bare throw the OTHER selector in the same rule entry must reject. */
const BARE_THROW_PROBE = `
export function __scopeSeamBareThrowProbe(): never {
  throw new Error("probe");
}
`;

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

  // A spread can supply either half of the pair, and only one of the two is decidable here.
  it("rejects a literal whose second half is a spread", async () => {
    expect(
      await scopeViolations('const s = { actorType: "apiKey", ...caller };')
    ).toBe(1);
  });

  it("leaves a config overlay alone, and says where that shape IS refused", async () => {
    // `{ ...base, permissions }` is not decidable from syntax: this is the booted-config merge in
    // `route-handler/auth-handler.ts`, and a selector wide enough to catch a scope narrowed this
    // way reports that file too. `ruleFacingPermissions` refuses the scope case at runtime, where
    // the two halves disagreeing is what decides the answer.
    expect(
      await scopeViolations(
        "const merged = { ...base, plugins: b.plugins, permissions: b.permissions };"
      )
    ).toBe(0);
  });
});

describe("exempting a file from the scope guard", () => {
  it("leaves the bare-Error guard on that file", async () => {
    // Both selectors ride in one `no-restricted-syntax` entry, and a config block's `ignores`
    // drops the whole entry rather than one selector — so a path exempted from the scope guard
    // through a shared ignore list loses the bare-`Error` guard with it, on the strength of not
    // throwing one today.
    const source = readFileSync(SCOPE_DEFINITION, "utf8");

    // The precondition. Without it the assertion below is equally satisfied by a file that was
    // never exempt at all, which is the same green reached for a different reason.
    expect(
      await violations(
        SCOPE_DEFINITION,
        `${source}\nconst s = { actorType: "apiKey", permissions: p };\n`,
        "apiKeyScopeFrom"
      )
    ).toBe(0);

    expect(
      await violations(
        SCOPE_DEFINITION,
        source + BARE_THROW_PROBE,
        "Throw a NextlyError"
      )
    ).toBe(1);
  }, 60_000);
});
