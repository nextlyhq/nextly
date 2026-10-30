// Publishing every language of a Single tells each language's subscribers
// what a publish of that one language would have told them.
//
// A language already live whose pending change is promoted shows new content
// to its readers. The expectation is derived from a one-language publish of
// the same change, on a second Single in the same app, so the event's type is
// never hard-coded here. The plausible broken implementations emit a
// language's event only on its first publication, or build an event's prior
// state after the promotion, so the "before" a subscriber diffs against
// already holds the new values.

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { snapshotRecord } from "../../versions/shared-publish-base";
import { VersionsRepository } from "../../versions/versions-repository";
import type { WebhookEvent } from "../../webhooks/types";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Published one language at a time. */
const ONE = "preferences-one";
/** Published every language at once. */
const EVERY = "preferences-every";

function preferences(slug: string) {
  return defineSingle({
    slug,
    localized: true,
    status: true,
    versions: { drafts: true },
    fields: [
      text({ name: "siteName", localized: true }),
      // Shared by every language: kept on the main row.
      text({ name: "tagline", localized: false }),
    ],
  });
}

async function boot(dialect: TestDialect): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    singles: [preferences(ONE), preferences(EVERY)],
    localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

/** A `nextly_events` row as read back. */
interface EventRow {
  id: string;
  type: string;
  payload: unknown;
}

/** The stored envelope; parsed on some dialects, a JSON string on others. */
function envelopeOf(row: EventRow): WebhookEvent {
  return (
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  ) as WebhookEvent;
}

async function eventIds(): Promise<Set<string>> {
  const rows = await current!.adapter.select<EventRow>("nextly_events");
  return new Set(rows.map(row => row.id));
}

/** One event as a subscriber diffs it: its type, language and both sides. */
interface Seen {
  type: string;
  locale: string | undefined;
  data: unknown;
  previous: unknown;
}

/**
 * The events recorded for a Single since `before`, sorted so two publishes
 * compare whatever order the database returns them in. By id, not by
 * position: a select has no order on every dialect.
 */
async function eventsSince(
  before: ReadonlySet<string>,
  slug: string,
  field = "siteName"
): Promise<Seen[]> {
  const rows = await current!.adapter.select<EventRow>("nextly_events");
  return rows
    .filter(row => !before.has(row.id))
    .map(envelopeOf)
    .filter(
      event => event.resource.kind === "single" && event.resource.slug === slug
    )
    .map(event => ({
      type: event.type,
      locale: event.resource.locale,
      data: event.data[field],
      previous: event.previous?.[field],
    }))
    .sort((a, b) =>
      `${a.locale ?? ""}:${a.type}`.localeCompare(`${b.locale ?? ""}:${b.type}`)
    );
}

describe.each(getConfiguredTestDialects())(
  "publishing every language of a Single, as its subscribers see it (integration, %s)",
  dialect => {
    it("tells a live language's subscribers what a publish of that language alone tells them", async () => {
      const singles = await boot(dialect);
      for (const slug of [ONE, EVERY]) {
        for (const [locale, siteName] of [
          ["en", "Hello"],
          ["de", "Hallo"],
        ] as const) {
          const live = await singles.update(
            slug,
            { siteName, status: "published" },
            { locale, overrideAccess: true }
          );
          expect(live.success, JSON.stringify(live)).toBe(true);
        }
        // English's pending change: held, not yet live.
        const held = await singles.update(
          slug,
          { siteName: "Hello again" },
          { locale: "en", overrideAccess: true }
        );
        expect(held.success, JSON.stringify(held)).toBe(true);
      }
      const before = await eventIds();

      const alone = await singles.update(
        ONE,
        { status: "published" },
        { locale: "en", overrideAccess: true }
      );
      expect(alone.success, JSON.stringify(alone)).toBe(true);
      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
      });
      expect(every.success, JSON.stringify(every)).toBe(true);

      // What the one-language publish tells English's subscribers: its new
      // content, against what its readers saw before. German's didn't change.
      const told = (await eventsSince(before, ONE)).filter(
        event => event.locale !== undefined
      );
      expect(told).toContainEqual(
        expect.objectContaining({
          locale: "en",
          data: "Hello again",
          previous: "Hello",
        })
      );
      expect(told.filter(event => event.locale === "de")).toEqual([]);

      const everyEvents = await eventsSince(before, EVERY);
      expect(everyEvents.filter(event => event.locale !== undefined)).toEqual(
        told
      );
      // The untagged event describes the default language, and its prior
      // state is the content readers saw before the publish too.
      const untagged = everyEvents.filter(
        event => event.locale === undefined && event.type === "single.updated"
      );
      expect(untagged).toEqual([
        {
          type: "single.updated",
          locale: undefined,
          data: "Hello again",
          previous: "Hello",
        },
      ]);
    });

    it("tells a language going live for the first time what a publish of that language alone tells it", async () => {
      const singles = await boot(dialect);
      for (const slug of [ONE, EVERY]) {
        const live = await singles.update(
          slug,
          { siteName: "Hello", status: "published" },
          { locale: "en", overrideAccess: true }
        );
        expect(live.success, JSON.stringify(live)).toBe(true);
        // French: saved, never published.
        const saved = await singles.update(
          slug,
          { siteName: "Bonjour" },
          { locale: "fr", overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      const before = await eventIds();

      const alone = await singles.update(
        ONE,
        { status: "published" },
        { locale: "fr", overrideAccess: true }
      );
      expect(alone.success, JSON.stringify(alone)).toBe(true);
      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
      });
      expect(every.success, JSON.stringify(every)).toBe(true);

      const told = (await eventsSince(before, ONE)).filter(
        event => event.locale !== undefined
      );
      expect(told).toContainEqual(
        expect.objectContaining({ locale: "fr", data: "Bonjour" })
      );
      expect(
        (await eventsSince(before, EVERY)).filter(
          event => event.locale !== undefined
        )
      ).toEqual(told);
    });

    it("reports the shared value a pending change put live, in its events and in the published version", async () => {
      const singles = await boot(dialect);
      for (const [locale, data] of [
        ["en", { siteName: "Hello", tagline: "Old" }],
        ["de", { siteName: "Hallo" }],
      ] as const) {
        const live = await singles.update(
          EVERY,
          { ...data, status: "published" },
          { locale, overrideAccess: true }
        );
        expect(live.success, JSON.stringify(live)).toBe(true);
      }
      // German's pending change edits the shared field, held until published.
      const held = await singles.update(
        EVERY,
        { tagline: "New" },
        { locale: "de", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);
      const read = async () => {
        const got = await singles.get(EVERY, {
          locale: "en",
          overrideAccess: true,
        });
        return ((got as { data?: unknown }).data ?? got) as Record<
          string,
          unknown
        >;
      };
      expect((await read()).tagline).toBe("Old");
      const before = await eventIds();

      const every = await singles.publishAllLocales(EVERY, {
        overrideAccess: true,
      });
      expect(every.success, JSON.stringify(every)).toBe(true);
      const live = await read();
      expect(live.tagline).toBe("New");

      // What readers see now, against what they saw before, in every event.
      const events = await eventsSince(before, EVERY, "tagline");
      expect(events.filter(event => event.type === "single.updated")).toEqual([
        {
          type: "single.updated",
          locale: undefined,
          data: "New",
          previous: "Old",
        },
        {
          type: "single.updated",
          locale: "de",
          data: "New",
          previous: "Old",
        },
      ]);
      // The version the publish records holds the content it put live.
      const versions = new VersionsRepository(current!.adapter);
      const ref = {
        scopeKind: "single" as const,
        scopeSlug: EVERY,
        entryId: String(live.id),
      };
      const [newest] = await versions.listByDoc(ref, { limit: 1 });
      expect(newest?.status).toBe("published");
      const published = await versions.findByVersionNo(ref, newest!.versionNo!);
      expect(snapshotRecord(published?.snapshot).tagline).toBe("New");
    });
  }
);
