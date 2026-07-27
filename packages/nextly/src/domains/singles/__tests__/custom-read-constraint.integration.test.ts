/**
 * Proves a Single's stored `custom` read rule is enforced, against a real
 * (in-memory SQLite) database.
 *
 * A custom rule answers with a boolean or with a query constraint. The boolean
 * decides; the constraint is refused. A constraint is the predicate a list read
 * folds into SQL, and a Single's document is assembled from several tables, so
 * no single row remains for the database to test it against. Comparing it in
 * memory instead would mean a second evaluator drifting from the one lists
 * compile, and that drift is itself the security bug.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  checkbox,
  defineCollection,
  defineSingle,
  group,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
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

  it("keeps a rule's writes to its own argument out of the response", async () => {
    // `data` is handed to app code. Passing the response object itself would
    // make a rule that assigns to it a response transformer, able to put back
    // a value a later stage is meant to withhold.
    const entry = await bootWithCustomRule();

    const result = await entry.get("branding", {
      user: { id: "mutating" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("injected");
  });
});

/**
 * A rule is decided on values, not on their absence.
 *
 * The guarded field here is translatable, so it lives only in the companion
 * table and the main row carries no value for it at all; it also has a field
 * read rule, so it is removed from the response. Both are ways for the rule to
 * be shown `undefined` where the document holds something, and a rule written
 * as `data.visibility !== "private"` reads that absence as permission.
 */
describe("Single custom read rules vs the assembled document (integration)", () => {
  /**
   * Boot a localized Single whose guarded field is unreadable to callers, with
   * a different value per language so the main row and the requested
   * translation disagree.
   */
  async function bootLocalized(values: {
    en: string;
    de: string;
  }): Promise<SingleEntryService> {
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
      { siteName: "Acme", visibility: values.en },
      { overrideAccess: true, locale: "en" }
    );
    await entry.update(
      "branding",
      { siteName: "Acme", visibility: values.de },
      { overrideAccess: true, locale: "de" }
    );
    return entry;
  }

  it("denies on a guarded value the caller may not read", async () => {
    // Field-level read access removes the value from the response. Removing it
    // before the decision leaves `data.visibility !== "private"` reading
    // `undefined`, which passes — handing back the rest of a document the rule
    // exists to withhold.
    const entry = await bootLocalized({ en: "public", de: "private" });

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
    const entry = await bootLocalized({ en: "public", de: "private" });

    const result = await entry.get("branding", {
      user: { id: "assembled-aware" },
      locale: "en",
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("visibility");
  });

  it("materializes nothing for a caller its defaults refuse", async () => {
    // A Single that has never been written is created by the first read that
    // reaches it, along with its first version. If the rule is judged with no
    // document, one that refuses on a default value admits that read, the write
    // lands, and only the outgoing check returns 403 — a permanent effect
    // driven by a caller the rule denies.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          fields: [text({ name: "siteName" })],
        }),
      ],
    });
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");

    const result = await entry.get("branding", {
      user: { id: "default-aware" },
      routeAuthorized: true,
    });

    expect(result.statusCode).toBe(403);
    // The refusal is only worth anything if the row was never written.
    expect(await current.adapter.selectOne("single_branding", {})).toBeNull();
  });

  it("shows the rule a related field the response redacts", async () => {
    // Related-row redaction happens while the relationship is expanded, so the
    // rule would be handed the hole it leaves. `data.author.suspended !== true`
    // then reads `undefined` and admits a caller the stored data refuses.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "authors",
          fields: [
            text({ name: "name" }),
            checkbox({ name: "suspended", access: { read: () => false } }),
          ],
        }),
      ],
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({ name: "siteName" }),
            relationship({ name: "author", relationTo: "authors" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A", suspended: true }
    );
    const authorId = (created.data as { id: string }).id;
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      { siteName: "Acme", author: authorId },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "relation-aware" },
      routeAuthorized: true,
      depth: 1,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("keeps a rule's writes deep inside its argument out of the response", async () => {
    // A shallow copy still shares every nested object with the response, so a
    // rule reaching into a component or group could rewrite what is returned.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({ name: "siteName" }),
            group({
              name: "settings",
              fields: [checkbox({ name: "private" })],
            }),
          ],
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
      { siteName: "Acme", settings: { private: false } },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "deep-mutating" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(result.data!.settings).not.toHaveProperty("injected");
  });

  it("hides a draft Single rather than reporting the rule's verdict", async () => {
    // A draft answers 404 to an untrusted caller so its existence stays hidden.
    // Deciding the stored rule first answers 403 instead, which reveals both
    // that the row is there and what the rule made of the caller.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          status: true,
          fields: [text({ name: "siteName" })],
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
      { siteName: "Acme", status: "draft" },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "denied" },
      routeAuthorized: true,
    });

    expect(result.statusCode).toBe(404);
  });

  it("tells the rule the id the document it judges will carry", async () => {
    // The first read of a Single that does not exist is judged against the
    // document it would create. Passing `undefined` for the id while `data`
    // carries one leaves the rule two disagreeing answers to the same question.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          fields: [text({ name: "siteName" })],
        }),
      ],
    });
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");

    const result = await entry.get("branding", {
      user: { id: "id-coherent" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
  });

  it("admits a caller the requested translation authorizes", async () => {
    // The rule grants on the translated value. Judged against the bare main row
    // it reads the default language instead and refuses a caller it admits, so
    // the decision has to be made on the document the caller would receive.
    const entry = await bootLocalized({ en: "internal", de: "public" });

    const result = await entry.get("branding", {
      user: { id: "assembled-grant" },
      locale: "de",
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
  });
});
