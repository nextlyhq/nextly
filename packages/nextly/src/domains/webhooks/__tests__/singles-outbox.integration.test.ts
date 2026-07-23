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

import { defineSingle, password, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
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
    // assembly used to live only in the versioning branch.
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
    expect(rows[0].resourceCollection).toBeNull();
    expect(rows[0].resourceId).toBeTruthy();

    const envelope = envelopeOf(rows[0]);
    expect((envelope.data as { title?: string }).title).toBe("hello");
    // The single auto-creates a blank default before the first update, so the
    // prior document is that default and `title` reads as a changed field.
    expect(envelope.previous).not.toBeNull();
    expect(envelope.changedFields).toContain("title");
    expect(envelope.resource).toMatchObject({ kind: "single" });
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
    // Regression: a non-default locale with no companion row yet is draft, not
    // the main row's status — so publishing it under an already-published
    // default must still emit single.published for that locale.
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
    const last = envelopeOf(rows[rows.length - 1]);
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
