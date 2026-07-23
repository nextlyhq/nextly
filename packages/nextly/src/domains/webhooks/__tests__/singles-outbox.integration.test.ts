/**
 * Outbox capture on Single writes.
 *
 * Proves the singles mutation seam appends `nextly_events` rows for a content
 * change: `single.updated` on every write (carrying the read-shape document and
 * an accurate prior state), plus `single.published` / `single.unpublished` when
 * the status transitions — independent of whether versioning is enabled, and
 * with secret fields never reaching the payload.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  component,
  defineComponent,
  defineSingle,
  password,
  text,
} from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { getSingleHookCollection } from "../../singles/services/single-query-service";
import type { WebhookEvent } from "../types";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A `nextly_events` row as read back (Drizzle camelCases the columns). */
interface EventRow {
  id: string;
  type: string;
  resourceKind: string;
  resourceCollection: string | null;
  resourceId: string | null;
  payload: unknown;
  actorType: string | null;
  actorId: string | null;
}

/** The stored envelope; the payload comes back parsed on some dialects, a JSON string on others. */
function envelopeOf(row: EventRow): WebhookEvent {
  return (
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  ) as WebhookEvent;
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

function singles(handle: TestNextly): SingleEntryService {
  return handle.getService<SingleEntryService>("singleEntryService");
}

describe("webhook outbox capture — singles (integration)", () => {
  it("records single.updated with the read-shape document and prior state (versioning OFF)", async () => {
    // Versioning off is the case the recording must not depend on: the document
    // assembly must run for a non-versioned single as well.
    current = await createTestNextly({
      singles: [
        // "settings" is a reserved slug; this suite uses "preferences".
        defineSingle({
          slug: "preferences",
          fields: [text({ name: "title" })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hello" },
      { overrideAccess: true }
    );

    const rows = (await events(current)).filter(
      r => r.type === "single.updated"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceKind).toBe("single");
    // The single slug is denormalized into the scope column so the delivery log
    // identifies which single changed.
    expect(rows[0].resourceCollection).toBe("preferences");
    expect(rows[0].resourceId).toBeTruthy();

    const envelope = envelopeOf(rows[0]);
    expect((envelope.data as { title?: string }).title).toBe("hello");
    // The single auto-creates a blank default before the first update, so the
    // prior document is that default and `title` reads as a changed field.
    expect(envelope.previous).not.toBeNull();
    expect(envelope.changedFields).toContain("title");
    // The payload resource carries the slug so a receiver can route the event,
    // but no entry `collection` (which would feed the collections filter).
    expect(envelope.resource).toMatchObject({
      kind: "single",
      slug: "preferences",
    });
    expect(
      (envelope.resource as { collection?: unknown }).collection
    ).toBeUndefined();
  });

  it("emits BOTH single.updated and single.published on a draft→published write", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });

    // Seed content while still a draft (no transition).
    await singles(current).update(
      "preferences",
      { title: "hello" },
      { overrideAccess: true }
    );
    // Publish: draft → published.
    await singles(current).update(
      "preferences",
      { status: "published" },
      { overrideAccess: true }
    );

    const types = (await events(current)).map(r => r.type);
    // Two updates → two single.updated; the publish additionally emits published.
    expect(types.filter(t => t === "single.updated")).toHaveLength(2);
    expect(types.filter(t => t === "single.published")).toHaveLength(1);
    expect(types).not.toContain("single.unpublished");
  });

  it("emits single.unpublished on a published→draft write", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hello", status: "published" },
      { overrideAccess: true }
    );
    await singles(current).update(
      "preferences",
      { status: "draft" },
      { overrideAccess: true }
    );

    const types = (await events(current)).map(r => r.type);
    expect(types.filter(t => t === "single.published")).toHaveLength(1);
    expect(types.filter(t => t === "single.unpublished")).toHaveLength(1);
  });

  it("does not transition on a content-only edit that carries no status", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hello", status: "published" },
      { overrideAccess: true }
    );
    // A later content-only edit must not re-emit a publish event.
    await singles(current).update(
      "preferences",
      { title: "world" },
      { overrideAccess: true }
    );

    const types = (await events(current)).map(r => r.type);
    expect(types.filter(t => t === "single.published")).toHaveLength(1);
    expect(types.filter(t => t === "single.updated")).toHaveLength(2);
  });

  it("never ships a secret field in the payload", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          fields: [text({ name: "title" }), password({ name: "apiKey" })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hello", apiKey: "s3cr3t-value" },
      { overrideAccess: true }
    );

    const row = (await events(current)).find(r => r.type === "single.updated");
    expect(row).toBeDefined();
    const serialized = JSON.stringify(envelopeOf(row!));
    expect(serialized).not.toContain("s3cr3t-value");
  });

  it("attributes the event to the acting user", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          fields: [text({ name: "title" })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hello" },
      { overrideAccess: true, user: { id: "user-123", email: "e@x.c" } }
    );

    const row = (await events(current)).find(r => r.type === "single.updated");
    expect(row).toBeDefined();
    expect(row!.actorType).toBe("user");
    expect(row!.actorId).toBe("user-123");
  });

  it("publishes a single locale: single.published carries that locale and the per-locale status transitions", async () => {
    // A localized single stores each language's draft/publish on the companion
    // `_status`, so the transition is detected from the per-locale status the
    // write assigns, and the event resource names the locale.
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        defineSingle({
          slug: "preferences",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hallo", status: "published" },
      { overrideAccess: true, locale: "de" }
    );

    const rows = await events(current);
    const published = rows.find(r => r.type === "single.published");
    expect(published).toBeDefined();
    expect(envelopeOf(published!).resource).toMatchObject({
      kind: "single",
      locale: "de",
    });
    expect(rows.some(r => r.type === "single.updated")).toBe(true);
  });

  it("fires single.published for a non-default locale even when the default is already published", async () => {
    // A non-default locale with no companion row yet is draft, not the main
    // row's status — so publishing it under an already-published default must
    // still emit single.published for that locale.
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        defineSingle({
          slug: "preferences",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    // Publish the default locale first (status lands on the main row).
    await singles(current).update(
      "preferences",
      { title: "hi", status: "published" },
      { overrideAccess: true, locale: "en" }
    );
    // Now publish German for the first time.
    await singles(current).update(
      "preferences",
      { title: "hallo", status: "published" },
      { overrideAccess: true, locale: "de" }
    );

    const dePublished = (await events(current)).filter(
      r =>
        r.type === "single.published" &&
        (envelopeOf(r).resource as { locale?: string }).locale === "de"
    );
    expect(dePublished).toHaveLength(1);
    // The payload carries this locale's own status, not the main row's.
    expect(
      (envelopeOf(dePublished[0]).data as { status?: string }).status
    ).toBe("published");
  });

  it("does not emit a false single.unpublished for a first draft write on a non-default locale", async () => {
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        defineSingle({
          slug: "preferences",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hi", status: "published" },
      { overrideAccess: true, locale: "en" }
    );
    // German was never published, so drafting it is not an unpublish.
    await singles(current).update(
      "preferences",
      { title: "hallo", status: "draft" },
      { overrideAccess: true, locale: "de" }
    );

    const deUnpublished = (await events(current)).filter(
      r =>
        r.type === "single.unpublished" &&
        (envelopeOf(r).resource as { locale?: string }).locale === "de"
    );
    expect(deUnpublished).toHaveLength(0);
  });

  it("carries untouched translations in the payload after a partial localized edit", async () => {
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        defineSingle({
          slug: "preferences",
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            text({ name: "body", localized: true }),
          ],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hallo", body: "welt" },
      { overrideAccess: true, locale: "de" }
    );
    // Edit only `title`; `body` is untouched but must still appear in data.
    await singles(current).update(
      "preferences",
      { title: "hallo-2" },
      { overrideAccess: true, locale: "de" }
    );

    const rows = (await events(current)).filter(
      r => r.type === "single.updated"
    );
    expect(rows).toHaveLength(2);
    // Select the second edit by its content, not by positional order:
    // `nextly_events` row order is not guaranteed across Postgres/MySQL, so
    // taking the last row would be flaky.
    const second = rows.find(
      r => (envelopeOf(r).data as { title?: string }).title === "hallo-2"
    );
    expect(second).toBeDefined();
    const last = envelopeOf(second!);
    expect((last.data as { title?: string }).title).toBe("hallo-2");
    // The untouched translation is present on both sides of the diff.
    expect((last.data as { body?: string }).body).toBe("welt");
    expect((last.previous as { body?: string } | null)?.body).toBe("welt");
    expect(last.changedFields).toContain("title");
    expect(last.changedFields).not.toContain("body");
  });

  it("omits resource.locale for a non-localized single even when localization is configured", async () => {
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        // Not localized: no `localized: true`, no localized fields.
        defineSingle({
          slug: "preferences",
          fields: [text({ name: "title" })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hello" },
      { overrideAccess: true }
    );

    const row = (await events(current)).find(r => r.type === "single.updated");
    expect(row).toBeDefined();
    expect(
      (envelopeOf(row!).resource as { locale?: string }).locale
    ).toBeUndefined();
  });

  it("keeps the main-row status and omits locale on a shared-field write to a non-default locale", async () => {
    // A non-default-locale edit that touches only a shared (non-localized) field
    // stores no per-locale data, so the event is not locale-specific: it must
    // carry no resource.locale and report the main row's status, not the
    // locale's absent (draft) one.
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        defineSingle({
          slug: "preferences",
          status: true,
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            // Explicitly shared: text defaults to localized in a localized single.
            text({ name: "theme", localized: false }),
          ],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hi", theme: "light", status: "published" },
      { overrideAccess: true, locale: "en" }
    );
    await singles(current).update(
      "preferences",
      { theme: "dark" },
      { overrideAccess: true, locale: "de" }
    );

    const rows = await events(current);
    const deWrite = rows.find(
      r =>
        r.type === "single.updated" &&
        (envelopeOf(r).data as { theme?: string }).theme === "dark"
    );
    expect(deWrite).toBeDefined();
    const env = envelopeOf(deWrite!);
    expect((env.resource as { locale?: string }).locale).toBeUndefined();
    expect((env.data as { status?: string }).status).toBe("published");
    // The shared value the write set is present regardless of locale.
    expect((env.data as { theme?: string }).theme).toBe("dark");
    // The shared-field edit is not a status transition.
    expect(rows.filter(r => r.type === "single.unpublished")).toHaveLength(0);
  });

  it("ships the default view, not the write locale's translations, on a shared-field write", async () => {
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        defineSingle({
          slug: "preferences",
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            text({ name: "theme", localized: false }),
          ],
        }),
      ],
    });

    // Give English (default) and German their own translations, then edit only
    // a shared field at `de`.
    await singles(current).update(
      "preferences",
      { title: "hello" },
      { overrideAccess: true, locale: "en" }
    );
    await singles(current).update(
      "preferences",
      { title: "hallo" },
      { overrideAccess: true, locale: "de" }
    );
    await singles(current).update(
      "preferences",
      { theme: "dark" },
      { overrideAccess: true, locale: "de" }
    );

    const shared = (await events(current)).find(
      r =>
        r.type === "single.updated" &&
        (envelopeOf(r).data as { theme?: string }).theme === "dark"
    );
    expect(shared).toBeDefined();
    const env = envelopeOf(shared!);
    // No locale tag; the payload carries the default (English) view, not the
    // German translation, and not a nulled-out field.
    expect((env.resource as { locale?: string }).locale).toBeUndefined();
    expect((env.data as { title?: string }).title).toBe("hello");
  });

  it("omits resource.locale when only a shared component is written at a non-default locale", async () => {
    // A shared (non-localized) component stores its data on the shared main
    // table, so writing it is not a per-locale write even in a localized app —
    // the event must not be tagged with a language.
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      components: [
        defineComponent({
          slug: "hero",
          localized: false,
          fields: [text({ name: "heading" })],
        }),
      ],
      singles: [
        defineSingle({
          slug: "preferences",
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            component({ name: "hero", component: "hero" }),
          ],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { hero: { heading: "Welcome" } },
      { overrideAccess: true, locale: "de" }
    );

    const row = (await events(current)).find(r => r.type === "single.updated");
    expect(row).toBeDefined();
    expect(
      (envelopeOf(row!).resource as { locale?: string }).locale
    ).toBeUndefined();
  });

  it("tags resource.locale when a localized component is written at a locale", async () => {
    // A localized component routes its translatable fields to a per-locale
    // companion, so writing it IS a per-locale write and the event carries the
    // write locale.
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      components: [
        defineComponent({
          slug: "hero",
          localized: true,
          fields: [text({ name: "heading", localized: true })],
        }),
      ],
      singles: [
        defineSingle({
          slug: "preferences",
          localized: true,
          fields: [component({ name: "hero", component: "hero" })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { hero: { heading: "Willkommen" } },
      { overrideAccess: true, locale: "de" }
    );

    const row = (await events(current)).find(r => r.type === "single.updated");
    expect(row).toBeDefined();
    expect((envelopeOf(row!).resource as { locale?: string }).locale).toBe(
      "de"
    );
  });

  it("tags resource.locale when a localized dynamic-zone component is written", async () => {
    // A dynamic-zone field stores each written block by its `_componentType`.
    // Writing a localized block routes its translatable data to a per-locale
    // companion, so the event must carry the write locale even though the field
    // config names an allow-list rather than a single component slug.
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      components: [
        defineComponent({
          slug: "hero_localized",
          localized: true,
          fields: [text({ name: "heading", localized: true })],
        }),
      ],
      singles: [
        defineSingle({
          slug: "preferences",
          localized: true,
          fields: [
            component({
              name: "blocks",
              components: ["hero_localized"],
              repeatable: true,
            }),
          ],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { blocks: [{ _componentType: "hero_localized", heading: "Willkommen" }] },
      { overrideAccess: true, locale: "de" }
    );

    const row = (await events(current)).find(r => r.type === "single.updated");
    expect(row).toBeDefined();
    expect((envelopeOf(row!).resource as { locale?: string }).locale).toBe(
      "de"
    );
  });

  it("reports eventRecorded when the write commits but a post-commit hook throws", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    // afterUpdate runs after the write transaction commits, so a throw here
    // leaves the entry + outbox event durable while the result reports failure.
    current.hooks.register(
      "afterUpdate",
      getSingleHookCollection("preferences"),
      () => {
        throw NextlyError.internal({
          logContext: { reason: "afterUpdate-observer-failed" },
        });
      }
    );

    const result = await singles(current).update(
      "preferences",
      { title: "hello" },
      { overrideAccess: true }
    );

    expect(result.success).toBe(false);
    expect(result.eventRecorded).toBe(true);
    const rows = (await events(current)).filter(
      r => r.type === "single.updated"
    );
    expect(rows).toHaveLength(1);
  });

  it("emits untouched localized fields as null in a partial translation write", async () => {
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        defineSingle({
          slug: "preferences",
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            text({ name: "body", localized: true }),
          ],
        }),
      ],
    });

    // Write only `title` for German; `body` is untranslated.
    await singles(current).update(
      "preferences",
      { title: "hallo" },
      { overrideAccess: true, locale: "de" }
    );

    const row = (await events(current)).find(r => r.type === "single.updated");
    expect(row).toBeDefined();
    const data = envelopeOf(row!).data as Record<string, unknown>;
    expect(data.title).toBe("hallo");
    // The untouched localized field is present as null (read-shape complete),
    // not omitted — consumers can tell "untranslated" from "not in the schema".
    expect(data).toHaveProperty("body");
    expect(data.body).toBeNull();
  });

  it("records the event AND captures a version when versioning is enabled", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });

    await singles(current).update(
      "preferences",
      { title: "hello" },
      { overrideAccess: true }
    );

    const evRows = (await events(current)).filter(
      r => r.type === "single.updated"
    );
    expect(evRows).toHaveLength(1);
    const versionRows = await current.adapter.select<{ scopeSlug: string }>(
      "nextly_versions"
    );
    expect(
      versionRows.filter(v => v.scopeSlug === "preferences").length
    ).toBeGreaterThanOrEqual(1);
  });
});
