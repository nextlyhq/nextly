/**
 * An API key's scope is built in ONE place, because a hand-written one is
 * short by whatever it does not name.
 *
 * `AuthenticatedScope` carries the caller's grants twice over: `permissions` in
 * the stored spelling a coarse check compares, and the rows every rule-facing
 * spelling is derived from. A literal that names only `actorType` and
 * `permissions` compiles clean — the other fields are optional — and produces a
 * scope that passes the coarse gate and then denies every documented
 * `({ permissions }) => permissions.includes("posts:read")` behind it.
 *
 * That is not hypothetical and it is not one mistake. Eight such literals
 * existed across the request paths: the plugin dispatcher, the REST route
 * middleware, the dispatcher's param decode, `readCaller` (which every
 * authenticated read endpoint goes through), the versions and releases
 * endpoints, and `pluginRouteScope` — the last written weeks after the first,
 * by someone who had read the file. `readCaller`'s carried a docblock
 * protecting the field NAME from a typo with `satisfies`, while the literal
 * beneath it dropped two fields in silence.
 *
 * So the shape is refused rather than corrected again. `apiKeyScopeFrom` takes
 * whatever the caller has and decides once; `apiKeyScope` and `narrowScope`
 * build and re-derive. This test fails the build on a ninth literal.
 *
 * @module auth/__tests__/api-key-scope-seam.test
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

/**
 * The module that DEFINES the scope, where the literal is the definition rather
 * than a bypass of it.
 */
const SEAM_DEFINITION = join(SRC, "auth", "authenticated-scope.ts");

/**
 * The dispatcher's param decode, which rebuilds a scope from strings.
 *
 * A REAL exemption now, unlike the one this file first carried: the widened
 * pattern DOES match it, so excluding it is a decision the guard acts on rather
 * than a note beside a pattern that could never have reached it.
 *
 * Exempt because it has nothing better to build from. Route params carry
 * strings, so there are no permission rows for `apiKeyScopeFrom` to take, and
 * its `actorType` is a variable that may be `user` or `system` — neither of
 * which `apiKeyScopeFrom` produces. Nothing reads its answer while a scope is
 * pinned for the request, which is every request that arrives through the
 * route handler.
 */
const LOSSY_DECODE = join(
  SRC,
  "dispatcher",
  "helpers",
  "authenticated-actor.ts"
);

/** Every product source file — tests excluded, they may model any shape. */
function productSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "node_modules" || name === "__tests__") continue;
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      if (name.endsWith(".test.ts") || name.endsWith(".test-d.ts")) continue;
      if (full === SEAM_DEFINITION || full === LOSSY_DECODE) continue;
      out.push({ path: full, text: readFileSync(full, "utf8") });
    }
  };
  walk(SRC);
  return out;
}

/**
 * An object being built as a scope — matched by its SHAPE, not by its value.
 *
 * `actorType: "apiKey"` was the first version of this, and it missed the ninth
 * instance: `api/singles-detail.ts` wrote
 * `actorType: auth.authMethod === "api-key" ? "apiKey" : "user"`, a conditional
 * no value-matching pattern can see. The guard reported clean while a live
 * defect sat one file away, which is a guard certifying what it cannot examine.
 *
 * `actorType` PAIRED with `permissions` is what a scope is, whatever expression
 * produces either. That distinguishes it from the other things in this codebase
 * that carry an `actorType` and are not scopes — the webhook outbox column and
 * its Drizzle schemas — without naming them in an exemption list that would go
 * stale the moment a third such thing appears.
 */
const HAND_BUILT = /actorType:[^}]*?\bpermissions\s*[:,}]/gs;

describe("the API-key scope seam", () => {
  it("is exercised — the scan reaches the files that once held a literal", () => {
    // Without this the assertion below passes against an empty list, which is
    // the shape of a guard reporting success because it found nothing to read.
    // Naming the files rather than counting them: a walk that silently stopped
    // one directory early still returns plenty of files.
    const sources = productSources();
    expect(sources.length).toBeGreaterThan(200);

    const paths = sources.map(s => s.path);
    for (const known of [
      join(SRC, "plugins", "routes", "route-caller.ts"),
      join(SRC, "api", "authenticated-read.ts"),
      join(SRC, "api", "versions-access.ts"),
      join(SRC, "api", "releases.ts"),
      join(SRC, "routeHandler.ts"),
      join(SRC, "auth", "middleware", "index.ts"),
    ]) {
      expect(paths, `${known} must be scanned`).toContain(known);
    }
  });

  it("is the only place an API-key scope is constructed", () => {
    const offenders = productSources()
      .filter(source => HAND_BUILT.test(source.text))
      .map(source => source.path.slice(SRC.length + 1));
    // `HAND_BUILT` is global, so `.test` advances `lastIndex` between calls.
    HAND_BUILT.lastIndex = 0;

    expect(
      offenders,
      "these build an API-key scope by hand. A literal is short by whatever it " +
        "does not name, and the fields it omits are the ones every rule-facing " +
        "check reads — so the scope passes the coarse gate and denies every " +
        "documented permission predicate behind it. Call `apiKeyScopeFrom` " +
        "with the caller you have, or `narrowScope` to restrict one you hold."
    ).toEqual([]);
  });

  it("would catch a ninth literal — the seam is discriminating", () => {
    // The positive control. The assertion above reports an absence, and an
    // absence is satisfied by a pattern that can never match. This shows the
    // pattern DOES match the shape it rejects, so a green above means the
    // shape is gone rather than that the search was broken.
    const asLiteral = [
      '  return auth.authMethod === "api-key"',
      '    ? { actorType: "apiKey", permissions: auth.permissions }',
      "    : undefined;",
    ].join("\n");
    expect(asLiteral.match(HAND_BUILT)).toHaveLength(1);
    HAND_BUILT.lastIndex = 0;

    // And the CONDITIONAL form, which the first version of this pattern could
    // not see. It is the shape the ninth instance actually took, so a control
    // that only exercised the literal would have certified a guard blind to the
    // very case that motivated widening it.
    const asConditional = [
      "      authenticatedScope: {",
      '        actorType: auth.authMethod === "api-key" ? "apiKey" : "user",',
      "        permissions: auth.permissions,",
      "      },",
    ].join("\n");
    expect(asConditional.match(HAND_BUILT)).toHaveLength(1);
    HAND_BUILT.lastIndex = 0;

    // The negative half: an `actorType` that is NOT a scope must stay unmatched,
    // or the guard reports the webhook outbox column as an authorization defect.
    const outboxColumn = [
      "  await recordEvent({",
      "    actorType: envelope.actor?.type ?? null,",
      "    actorId: envelope.actor?.id ?? null,",
      "  });",
    ].join("\n");
    expect(outboxColumn.match(HAND_BUILT)).toBeNull();
    HAND_BUILT.lastIndex = 0;
  });
});
