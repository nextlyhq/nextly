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

  it("does not let the caller's depth shrink what the rule is shown", async () => {
    // Depth shapes the RESPONSE. Letting it shape the authorization view too
    // hands the caller a way to blind the rule: at `depth: 0` the relationship
    // stays an id, so `data.author?.suspended !== true` reads `undefined` and
    // the Single is served to someone the stored data refuses.
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
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      { siteName: "Acme", author: (created.data as { id: string }).id },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "relation-aware" },
      routeAuthorized: true,
      depth: 0,
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

  it("shows the rule the translation overview the response will carry", async () => {
    // `_translations` is attached only when the read asks for it. Leaving it off
    // the copy the rule is judged on makes the two decisions disagree about
    // what the document contains: the first refuses a read the second allows.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          localized: true,
          fields: [text({ name: "siteName" })],
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
      { siteName: "Acme" },
      { overrideAccess: true, locale: "en" }
    );

    const result = await entry.get("branding", {
      user: { id: "translation-aware" },
      routeAuthorized: true,
      translationStatus: true,
    });

    expect(result.success).toBe(true);
  });

  it("keeps a field rule's writes out of the response", async () => {
    // Field read rules run AFTER the document-level decision, so a callback
    // that mutates its argument changes a document that has already been
    // authorized — and nothing judges it again.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({
              name: "siteName",
              access: {
                read: ({ data }) => {
                  const settings = (
                    data as { settings?: Record<string, unknown> }
                  )?.settings;
                  if (settings) settings.injected = "from-the-field-rule";
                  return true;
                },
              },
            }),
            group({
              name: "settings",
              fields: [checkbox({ name: "private" })],
            }),
          ],
        }),
      ],
    });
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      { siteName: "Acme", settings: { private: false } },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "someone" },
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

  it("authorizes the defaults when the checked row disappears mid-read", async () => {
    // The rule allowed the stored row. A `beforeRead` hook then deletes it, so
    // what the read is about to create is a default document no rule has seen.
    // Creating it and refusing afterwards leaves the row, its localized
    // defaults and its first version behind for a caller who was denied.
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
    await entry.update(
      "branding",
      { siteName: "Acme" },
      { overrideAccess: true }
    );
    // Registered directly: hooks declared on `defineSingle` are never wired up
    // (tracked separately), and this needs a hook that actually runs.
    current.hooks.register("beforeRead", "single:branding", async () => {
      await current!.adapter.delete("single_branding", {});
      return undefined;
    });

    const result = await entry.get("branding", {
      user: { id: "seeded-only" },
      routeAuthorized: true,
    });

    expect(result.statusCode).toBe(403);
    // The refusal is only worth anything if nothing was written.
    expect(await current.adapter.selectOne("single_branding", {})).toBeNull();
  });

  it("refuses the read when the rule's evidence cannot be assembled", async () => {
    // Response assembly is best-effort: a relationship that cannot be expanded
    // comes back as a bare id. For a document being JUDGED that turns a
    // transient failure into missing evidence, and an absence-tolerant rule
    // reads missing evidence as permission.
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
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      { siteName: "Acme", author: (created.data as { id: string }).id },
      { overrideAccess: true }
    );

    // Make expansion fail the way a transient fault would.
    await (
      current.adapter as unknown as {
        executeQuery: (sql: string) => Promise<unknown>;
      }
    ).executeQuery('DROP TABLE "dc_authors"');

    const result = await entry.get("branding", {
      user: { id: "relation-aware" },
      routeAuthorized: true,
      depth: 1,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("refuses when a has-many reference goes missing from the expansion", async () => {
    // A `hasMany` expansion drops the entries it could not fetch, so the list
    // comes back shorter rather than absent. Checking only that each surviving
    // element is a row accepts evidence that quietly went missing — and accepts
    // an empty list vacuously.
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
            relationship({
              name: "author",
              relationTo: "authors",
              hasMany: true,
            }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const kept = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A", suspended: false }
    );
    const removed = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "B", suspended: true }
    );
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      {
        siteName: "Acme",
        author: [
          (kept.data as { id: string }).id,
          (removed.data as { id: string }).id,
        ],
      },
      { overrideAccess: true }
    );
    // The row the rule would refuse on disappears from under the reference,
    // exactly as a failed lookup leaves it: still referenced by the Single,
    // absent from the expansion. Removed at the adapter so the reference is
    // left dangling rather than cleaned up.
    await current.adapter.delete("dc_authors", {
      and: [
        { column: "id", op: "=", value: (removed.data as { id: string }).id },
      ],
    });

    const result = await entry.get("branding", {
      user: { id: "relation-aware" },
      routeAuthorized: true,
      depth: 1,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    // And the refusal says nothing about the schema it failed on.
    expect(result.message).not.toContain("dc_authors");
  });

  it("refuses when a relationship nested in a group cannot be assembled", async () => {
    // Expansion reaches into groups and repeaters, so the same guarantee has
    // to. Checking only top-level fields leaves a rule reading
    // `data.meta.author` deciding on evidence that never arrived.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
      ],
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({ name: "siteName" }),
            group({
              name: "meta",
              fields: [relationship({ name: "author", relationTo: "authors" })],
            }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A" }
    );
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    const authorId = (author.data as { id: string }).id;
    await entry.update(
      "branding",
      { siteName: "Acme", meta: { author: authorId } },
      { overrideAccess: true }
    );
    // Leaves the nested reference dangling, the way a failed lookup does.
    await current.adapter.delete("dc_authors", {
      and: [{ column: "id", op: "=", value: authorId }],
    });

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
      depth: 1,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("expands a relationship that exists only inside a group", async () => {
    // The expansion guard looked at top-level fields only, so a Single whose
    // relationships all live inside a container was returned unexpanded — and
    // the completeness check then refused every read of a perfectly valid
    // document.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
      ],
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({ name: "siteName" }),
            group({
              name: "meta",
              fields: [relationship({ name: "author", relationTo: "authors" })],
            }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A" }
    );
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      {
        siteName: "Acme",
        meta: { author: (author.data as { id: string }).id },
      },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
      depth: 1,
    });

    expect(result.success).toBe(true);
    expect(
      (result.data!.meta as { author?: { id?: string } })?.author?.id
    ).toBe((author.data as { id: string }).id);
  });

  it("checks a localized relationship, which the stored row never carries", async () => {
    // A localized reference lives in the companion table and is overlaid after
    // the main row is read, so comparing the view against the stored row skips
    // the field entirely and a failed expansion goes unnoticed.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
      ],
      singles: [
        defineSingle({
          slug: "branding",
          localized: true,
          fields: [
            text({ name: "siteName" }),
            relationship({
              name: "author",
              relationTo: "authors",
              localized: true,
            }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A" }
    );
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    const authorId = (author.data as { id: string }).id;
    await entry.update(
      "branding",
      { siteName: "Acme", author: authorId },
      { overrideAccess: true, locale: "en" }
    );
    // Leaves the localized reference dangling, as a failed lookup does.
    await current.adapter.delete("dc_authors", {
      and: [{ column: "id", op: "=", value: authorId }],
    });

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
      locale: "en",
      depth: 1,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("reads a Single whose relationship points at several collections", async () => {
    // A polymorphic reference is stored AND served as `{ relationTo, value }` —
    // it is never populated on this path — so the reference is the outcome and
    // demanding a row there would refuse every read of such a Single.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
        defineCollection({ slug: "orgs", fields: [text({ name: "name" })] }),
      ],
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({ name: "siteName" }),
            relationship({ name: "author", relationTo: ["authors", "orgs"] }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A" }
    );
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      {
        siteName: "Acme",
        author: {
          relationTo: "authors",
          value: (author.data as { id: string }).id,
        },
      },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
      depth: 1,
    });

    expect(result.success).toBe(true);
  });

  it("serves a depth-zero read the references it asked for", async () => {
    // `depth: 0` asks for ids and the response gives them, so holding the
    // returned document to "every reference became a document" refuses exactly
    // what was requested. The authorization view has already judged the same
    // relationships at the full read depth.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
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
    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A" }
    );
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    const authorId = (author.data as { id: string }).id;
    await entry.update(
      "branding",
      { siteName: "Acme", author: authorId },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
      depth: 0,
    });

    expect(result.success).toBe(true);
    expect(result.data!.author).toBe(authorId);
  });

  it("refuses when a stored container cannot be read", async () => {
    // A group whose stored JSON is malformed hides whatever relationships it
    // held. Treating it as an empty container walks straight past them, and the
    // rule is judged on a document it could not actually see.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
      ],
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({ name: "siteName" }),
            group({
              name: "meta",
              fields: [relationship({ name: "author", relationTo: "authors" })],
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
      { siteName: "Acme", meta: {} },
      { overrideAccess: true }
    );
    // Corrupt the stored container, the way a truncated or half-written value
    // would arrive.
    await current.adapter.update("single_branding", { meta: "{not json" }, {});

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
      depth: 1,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("lets an afterRead hook drop a relationship without failing the read", async () => {
    // A hook shapes the response and may legitimately remove or replace a
    // relationship. Nothing distinguishes that from an expansion that failed,
    // so checking completeness after hooks run reads a deliberate
    // transformation as a fault and refuses a read that is fine.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
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
    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A" }
    );
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      { siteName: "Acme", author: (author.data as { id: string }).id },
      { overrideAccess: true }
    );
    current.hooks.register(
      "afterRead",
      "single:branding",
      ({ data }: { data: Record<string, unknown> }) => {
        const { author: _dropped, ...rest } = data;
        return rest;
      }
    );

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
      depth: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("author");
  });

  it("leaves a relationship configured not to populate alone", async () => {
    // `maxDepth: 0` asks for the reference itself, so an unexpanded id is the
    // configured outcome. Demanding a row there refuses every read of the
    // Single, whatever the rule says.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
      ],
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({ name: "siteName" }),
            relationship({
              name: "author",
              relationTo: "authors",
              maxDepth: 0,
            }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "A" }
    );
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");
    await entry.update(
      "branding",
      { siteName: "Acme", author: (author.data as { id: string }).id },
      { overrideAccess: true }
    );

    const result = await entry.get("branding", {
      user: { id: "always" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
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
