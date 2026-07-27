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
  it.each([["acme"], ["system-column"], ["reads-data"], ["contains-op"]])(
    "refuses a rule that returns a query constraint (%s)",
    async userId => {
      // The authoritative decision is made on the assembled document, which is
      // built from the main row plus companion translations, component tables
      // and whatever a hook changed — so there is no single row left for the
      // database to test a predicate against. A constraint is refused rather
      // than approximated in memory.
      const entry = await bootWithCustomRule();

      const result = await entry.get("branding", {
        user: { id: userId },
        routeAuthorized: true,
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    }
  );

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

  it("gives the rule the read's locale", async () => {
    // A rule keyed on the requested language sees `undefined` unless the read's
    // locale reaches its context, which can turn a check that tolerates absence
    // into an unintended allow.
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "locale-aware" },
      locale: "secret",
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("gives the rule the caller's non-canonical claims", async () => {
    // `UserContext` carries arbitrary extra claims. Rebuilding the object from
    // its canonical fields drops them, so a rule keyed on one sees undefined and
    // can allow a caller it was written to deny.
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "claim-aware", tenantId: "blocked" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("denies a rule that returns no decision", async () => {
    // A non-boolean, non-constraint return used to be read as "allowed, with no
    // predicate" — so a rule that simply fell through admitted the caller and
    // narrowed nothing. A missing verdict is not an authorization.
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "no-verdict" },
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

/**
 * A rule guarding a redacted field is decided on the value, not on its absence.
 *
 * Field-level read access removes fields from the response. Removing them
 * before the document-level decision leaves a rule written as
 * `data.visibility !== "private"` reading `undefined`, which passes — so the
 * caller receives the rest of a document the rule exists to withhold. The
 * guarded value here lives in the companion table, so the earlier gate cannot
 * see it either: the main row carries the default language's value.
 */
describe("Single custom read rules vs field redaction (integration)", () => {
  /** Boot a localized Single whose guarded field is unreadable to callers. */
  async function bootLocalized(): Promise<SingleEntryService> {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          localized: true,
          fields: [
            text({ name: "siteName" }),
            text({ name: "visibility", access: { read: () => false } }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });

    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );

    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      { siteName: "Acme", visibility: "public" },
      { overrideAccess: true, locale: "en" }
    );
    await entry.update(
      "branding",
      { siteName: "Acme", visibility: "private" },
      { overrideAccess: true, locale: "de" }
    );
    return entry;
  }

  it("denies on a guarded value the caller may not read", async () => {
    const entry = await bootLocalized();

    const result = await entry.get("branding", {
      user: { id: "assembled-aware" },
      locale: "de",
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("still redacts the guarded field from an allowed read", async () => {
    // The mirror case: authorizing on the unredacted document must not hand the
    // guarded value back once the read is allowed.
    const entry = await bootLocalized();

    const result = await entry.get("branding", {
      user: { id: "assembled-aware" },
      locale: "en",
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("visibility");
  });
});
