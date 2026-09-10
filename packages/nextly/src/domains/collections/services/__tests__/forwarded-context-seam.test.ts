/**
 * The caller-identity fields must travel together, at every facade method.
 *
 * A service handed `user` without `authenticatedScope` resolves a scoped API
 * key's permissions from its OWNER, so a viewer-scoped key minted by a
 * super-admin is judged as a super-admin. Spreading `forwardedFromContext(context)`
 * keeps the two inseparable; writing them inline is what let every one of the
 * facade's plugin-facing methods forward the account while dropping the grant
 * the request actually arrived with.
 *
 * TypeScript cannot catch the regression: a spread into an object literal is
 * exempt from excess-property checking, and an omitted optional field is not an
 * error either, so both directions of this mistake compile clean. The same
 * reasoning, and the same guard, as `access-options-seam.test.ts` on the Direct
 * API side.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FACADE = join(__dirname, "..", "collection-service.ts");

/**
 * No exemptions left.
 *
 * This was 3. The transaction entry points forwarded `user` alone because their
 * destination params declared no `authenticatedScope` — so a route that NARROWED
 * its scope before a transactional write had that narrowing silently discarded,
 * and the gate judged it on the scope the request arrived with instead.
 *
 * The params now carry it and all three spread the seam like every other method,
 * so the count is zero and stays zero. A new bare forward has to come here and
 * argue for itself rather than joining a list that already had members.
 */
const TRANSACTION_SITES = 0;

function facadeSource(): string {
  return readFileSync(FACADE, "utf8");
}

describe("the collection facade's forwarded-context seam", () => {
  it("is exercised — the facade source is present and forwards a caller", () => {
    // Without this the assertions below pass against an empty or unreadable
    // file, which is the shape of a guard reporting success because it found
    // nothing to examine.
    const text = facadeSource();
    expect(text.length).toBeGreaterThan(1000);
    expect(text).toContain("forwardedFromContext(context)");
  });

  it("is the only way a facade method forwards the caller's identity", () => {
    // `user` paired with `overrideAccess` is the access-bearing forward. Every
    // one of those must go through the seam.
    const inline = facadeSource().match(
      /user:\s*context\.user,\s*\n\s*overrideAccess:\s*context\.overrideAccess/g
    );

    expect(
      inline ?? [],
      "these facade methods forward `user` and `overrideAccess` inline, so a " +
        "scoped API key reaches the entry service without its own grants and " +
        "is judged by its owner's. Spread `forwardedFromContext(context)` instead."
    ).toEqual([]);
  });

  it("accounts for every remaining bare `user` forward", () => {
    // A bare `user: context.user` is legitimate only at the transaction sites
    // above. Pinning the count means a NEW one has to come here and say why,
    // rather than joining an unbounded set that nothing reads.
    const bare = facadeSource().match(/user:\s*context\.user,/g) ?? [];

    expect(
      bare.length,
      "a facade method forwards `user` alone. If it is a new transaction " +
        "entry point whose write params carry no `authenticatedScope`, raise " +
        "TRANSACTION_SITES and say so here. Otherwise spread " +
        "`forwardedFromContext(context)`."
    ).toBe(TRANSACTION_SITES);
  });

  it("would catch a method that dropped the scope — the seam is discriminating", () => {
    // The positive control. The guard above asserts an absence, and an absence
    // is satisfied by a regex that can never match anything. This shows the
    // pattern DOES match the shape it is written to reject, so a green above
    // means the shape is gone rather than that the search was broken.
    const reintroduced = [
      "    const result = await this.entryService.createEntry(",
      "      {",
      "        collectionName,",
      "        user: context.user,",
      "        overrideAccess: context.overrideAccess,",
      "      },",
      "      data",
      "    );",
    ].join("\n");

    expect(
      reintroduced.match(
        /user:\s*context\.user,\s*\n\s*overrideAccess:\s*context\.overrideAccess/g
      )
    ).toHaveLength(1);
  });
});
