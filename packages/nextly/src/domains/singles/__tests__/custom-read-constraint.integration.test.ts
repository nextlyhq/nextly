/**
 * Proves a Single's stored `custom` read rule is enforced, against a real
 * (in-memory SQLite) database.
 *
 * A custom rule answers with a boolean or with a query constraint. The
 * constraint is the predicate a list read folds into SQL, and a Single has no
 * list to fold it into — so it is handed to the database as the filter on a
 * single-row fetch. Selecting nothing means the row does not satisfy the rule.
 *
 * That is what makes this enforceable at all. Comparing the predicate in memory
 * would mean a second evaluator drifting from the one lists compile, which is
 * why custom rules were previously left unenforced on Singles rather than
 * half-enforced.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const RULE_PATH = new URL(
  "../../collections/__tests__/_fixtures/single-read-rule.ts",
  import.meta.url
).pathname;

/** Boot a Single, attach the stored custom read rule, and seed its row. */
async function bootWithCustomRule(): Promise<SingleEntryService> {
  current = await createTestNextly({
    singles: [
      defineSingle({
        slug: "branding",
        fields: [text({ name: "siteName" }), text({ name: "tenant" })],
      }),
    ],
  });

  await current.adapter.update(
    "dynamic_singles",
    { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
    { and: [{ column: "slug", op: "=", value: "branding" }] }
  );

  const entry = current.getService<SingleEntryService>("singleEntryService");
  await entry.update(
    "branding",
    { siteName: "Acme", tenant: "acme" },
    { overrideAccess: true }
  );
  return entry;
}

describe("Single custom read rules (integration)", () => {
  it("returns the document when the constraint selects it", async () => {
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "acme" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect((result.data as { tenant?: string }).tenant).toBe("acme");
  });

  it("denies when the constraint selects nothing", async () => {
    // The rule narrows to the caller's own tenant. A caller from another tenant
    // matches no row, so the read is refused rather than served.
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "other" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("denies when the rule refuses the caller outright", async () => {
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "denied" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("allows when the rule decides on the caller alone", async () => {
    // A boolean answer carries no predicate, so there is nothing to filter by.
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
  });

  it("refuses a constraint whose shape cannot be translated exactly", async () => {
    // Held to the same shape rules as a collection constraint: a dotted path
    // translates to a comparison against the base column, which is a different
    // predicate than the rule states.
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "dotted" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("lets a trusted read through untouched", async () => {
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", { overrideAccess: true });

    expect(result.success).toBe(true);
  });
});
