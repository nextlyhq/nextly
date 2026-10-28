// Publishing every language of a Single tells a language's subscribers when
// its live content changes, not only when it first goes live.
//
// A language already live whose pending change is promoted shows new content
// to its readers, exactly as a one-language publish of that change would. The
// plausible broken implementation emits a language's event only on its first
// publication, and builds the event's prior state after the promotion, so the
// "before" a subscriber diffs against already holds the new values.

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { WebhookEvent } from "../../webhooks/types";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "preferences";

async function boot(): Promise<SingleEntryService> {
  current = await createTestNextly({
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "siteName", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
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

/** The `single.published` events tagged with a language. */
async function publishedIn(locale: string): Promise<WebhookEvent[]> {
  const rows = await current!.adapter.select<EventRow>("nextly_events");
  return rows
    .filter(row => row.type === "single.published")
    .map(envelopeOf)
    .filter(event => event.resource.locale === locale);
}

describe("publishing every language of a Single, as its subscribers see it", () => {
  it("tells a live language's subscribers its pending change went live, with what it showed before", async () => {
    const singles = await boot();
    for (const [locale, siteName] of [
      ["en", "Hello"],
      ["de", "Hallo"],
    ] as const) {
      const live = await singles.update(
        SLUG,
        { siteName, status: "published" },
        { locale, overrideAccess: true }
      );
      expect(live.success, JSON.stringify(live)).toBe(true);
    }
    // English's pending change: held, not yet live.
    const held = await singles.update(
      SLUG,
      { siteName: "Hello again" },
      { locale: "en", overrideAccess: true }
    );
    expect(held.success, JSON.stringify(held)).toBe(true);
    const englishBefore = (await publishedIn("en")).length;
    const germanBefore = (await publishedIn("de")).length;

    const published = await singles.publishAllLocales(SLUG, {
      overrideAccess: true,
    });
    expect(published.success, JSON.stringify(published)).toBe(true);

    // English's live content changed: one event, new content after, the
    // content its readers saw before.
    const english = (await publishedIn("en")).slice(englishBefore);
    expect(english).toHaveLength(1);
    expect(english[0]?.data.siteName).toBe("Hello again");
    expect(english[0]?.previous?.siteName).toBe("Hello");
    // German's didn't: nothing to tell its subscribers.
    expect((await publishedIn("de")).length).toBe(germanBefore);
  });
});
